require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const fileUpload = require('express-fileupload');
const morgan = require('morgan');
const db = require('./db');
const { checkRole } = require('./middlewares/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Cabeceras de seguridad HTTP con Helmet (permitiendo CDNs externos para estilos/scripts)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Registrar logger HTTP
app.use(morgan('dev'));

// Habilitar CORS con lista cerrada de orígenes y credenciales
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) 
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    callback(new Error('Acceso bloqueado por política CORS'));
  },
  credentials: true
}));

// Limitador de intentos de login para proteger contra ataques de fuerza bruta
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // Máximo 20 intentos por IP en 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Por favor intente nuevamente en 15 minutos.' }
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/google', authLimiter);

// Cookie parser (para leer httpOnly cookies del JWT)
app.use(cookieParser());

// Middleware para procesar JSON y datos de formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar subida de archivos
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 10 * 1024 * 1024 }, // Límite de 10MB
  useTempFiles: false
}));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Servir archivos cargados de documentación digital mediante RUTA PROTEGIDA (requiere autenticación)
app.use('/uploads', checkRole(['admin', 'productor', 'administrativo']), (req, res) => {
  const safeFilename = path.basename(req.path);
  const filePath = path.join(__dirname, 'uploads', safeFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo adjunto no encontrado.' });
  }
  res.sendFile(filePath);
});

// Rutas de la API
const apiRouter = require('./routes/api');
const reportsRouter = require('./routes/reports');

app.use('/api', apiRouter);
app.use('/api/reports', reportsRouter);

// Asegurar que exista la carpeta de cargas (uploads)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Middleware de fallback para servir la SPA o error 404
app.use((req, res, next) => {
  // Si solicitan algo que no es API, devolver el index.html principal
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint no encontrado' });
  }
});

// Middleware global de manejo de errores (debe ir ÚLTIMO)
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]:', err.stack || err.message || err);
  const status = err.status || 500;
  const message = err.message || 'Error interno del servidor';
  res.status(status).json({ error: message });
});

// Inicializar base de datos y levantar servidor
async function start() {
  try {
    await db.initDatabase();
  } catch (err) {
    console.error('[Database Init Warning]:', err.message);
  }
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(` CRM GPG SEGUROS - Productor Asesor de Seguros (PAS)`);
    console.log(` Servidor corriendo en puerto: ${PORT}`);
    console.log(`==================================================`);
  });
}

start();
