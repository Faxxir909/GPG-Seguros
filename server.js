require('dotenv').config();
const { randomUUID } = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const fileUpload = require('express-fileupload');
const db = require('./db');
const { checkRole } = require('./middlewares/auth');
const { requestContextMiddleware } = require('./database/request-context');
const { getAllowedOrigins } = require('./config/security');
const { csrfProtection } = require('./middlewares/csrf');
const { authLimiter, writeLimiter, uploadLimiter, generalLimiter } = require('./middlewares/rateLimiters');
const { logger, requestLoggingMiddleware } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;
let httpServer = null;
let databaseInitPromise = null;

// Confiar en el primer proxy (Vercel, Cloudflare, Nginx) para resolución segura de IPs en rate limit
app.set('trust proxy', 1);

function ensureDatabaseReady() {
  if (!databaseInitPromise) {
    databaseInitPromise = db.initDatabase().catch(error => {
      databaseInitPromise = null;
      throw error;
    });
  }
  return databaseInitPromise;
}

// 1. Cabeceras de seguridad HTTP completas con Helmet y CSP ajustada a la SPA
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Necesario para los controladores dinámicos de la SPA
        "https://accounts.google.com",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net",
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com"
      ],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.gstatic.com",
        "data:"
      ],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://accounts.google.com"],
      frameSrc: ["https://accounts.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true,
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));

// 2. Trazabilidad con Request ID
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);

// 3. Habilitar CORS con lista cerrada de orígenes y credenciales
let allowedOrigins = [];
try {
  allowedOrigins = getAllowedOrigins();
} catch (e) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[CORS Init Error]:', e.message);
  }
}

app.use(cors({
  origin: (origin, callback) => {
    // Peticiones sin origen (ej: same-origin, curl, server-side) o dentro de la allowlist
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Acceso bloqueado por política CORS'));
  },
  credentials: true
}));

// 4. Rate limiters segmentados por criticidad
app.use(generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/upload', uploadLimiter);
app.use(['/api/clients/import', '/api/policies/import'], uploadLimiter);

// 5. Rate limiter de escrituras para /api (POST, PUT, DELETE, PATCH)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  next();
});

// 6. Cookie parser para leer tokens httpOnly
app.use(cookieParser());

// 7. Protección contra CSRF en peticiones mutables
app.use('/api', csrfProtection);

// 8. Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 9. Configurar subida de archivos (límite 10MB)
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 10 * 1024 * 1024 },
  useTempFiles: false,
  abortOnLimit: true
}));

// 10. Protección de acceso a la interfaz principal (requiere sesión activa)
app.get(['/dashboard.html', '/dashboard'], (req, res) => {
  let token = req.cookies?.gpg_token;
  if (!token) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.redirect('/index.html');
  }

  try {
    const jwt = require('jsonwebtoken');
    const { getJwtSecret, getClearCookieOptions } = require('./config/security');
    jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'gpg-seguros',
      audience: 'gpg-seguros-crm'
    });
    return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } catch {
    const { getClearCookieOptions } = require('./config/security');
    res.clearCookie('gpg_token', getClearCookieOptions());
    return res.redirect('/index.html');
  }
});

// 11. Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// 11. Servir archivos cargados de documentación digital mediante RUTA PROTEGIDA (requiere autenticación)
app.use('/uploads', checkRole(['admin', 'productor', 'administrativo']), (req, res) => {
  const safeFilename = path.basename(req.path);
  const filePath = path.join(__dirname, 'uploads', safeFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo adjunto no encontrado.' });
  }
  res.sendFile(filePath);
});

// 12. Enrutador API y verificación de disponibilidad de DB
const apiRouter = require('./routes/api');

app.use('/api', async (req, res, next) => {
  try {
    await ensureDatabaseReady();
    next();
  } catch (error) {
    res.status(503).json({ error: 'Base de datos no disponible. El servicio no está listo.' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const health = await db.healthCheck();
    res.json({
      status: 'ok',
      database: 'postgresql',
      timezone: health.timezone,
      serverTime: health.server_time
    });
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'postgresql' });
  }
});

app.use('/api', apiRouter);

// Asegurar que exista la carpeta local de uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 13. Fallback para SPA o 404
app.use((req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint no encontrado' });
  }
});

// 14. Middleware global de manejo y sanitización de errores (ÚLTIMO)
app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;

  logger.error(`[Error]: ${err.message}`, err);

  if (status >= 500) {
    return res.status(500).json({
      error: 'Error interno del servidor. Por favor intente nuevamente más tarde.',
      requestId: req.id
    });
  }

  res.status(status).json({
    error: err.message,
    requestId: req.id
  });
});

async function start() {
  await ensureDatabaseReady();
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(` CRM GPG SEGUROS - Productor Asesor de Seguros (PAS)`);
    console.log(` Servidor corriendo en puerto: ${PORT}`);
    console.log(`==================================================`);
  });
  return httpServer;
}

async function shutdown(signal) {
  console.log(`[Shutdown]: recibido ${signal}`);
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
  }
  await db.close();
}

if (require.main === module) {
  start().catch(error => {
    console.error('[Startup Fatal]:', error.message);
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdown(signal)
        .then(() => process.exit(0))
        .catch(error => {
          console.error('[Shutdown Error]:', error.message);
          process.exit(1);
        });
    });
  }
}

module.exports = app;
