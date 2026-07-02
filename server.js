const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fileUpload = require('express-fileupload');
const morgan = require('morgan');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Registrar logger HTTP
app.use(morgan('dev'));

// Habilitar CORS
app.use(cors());

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

// Servir archivos cargados de documentación digital
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Middleware global de manejo de errores
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]:', err.stack || err.message || err);
  const status = err.status || 500;
  const message = err.message || 'Error interno del servidor';
  res.status(status).json({ error: message });
});

// Middleware de fallback para servir la SPA o error 404
app.use((req, res) => {
  // Si solicitan algo que no es API, devolver el index.html principal
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint no encontrado' });
  }
});

// Inicializar base de datos y levantar servidor
async function start() {
  await db.initDatabase();
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` CRM GPG SEGUROS - Productor Asesor de Seguros (PAS)`);
    console.log(` Servidor corriendo en: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
}

start();
