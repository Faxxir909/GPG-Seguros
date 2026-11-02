const rateLimit = require('express-rate-limit');

/**
 * Limitadores de tasa por nivel de riesgo y consumo de recursos.
 *
 * NOTA DE ARQUITECTURA:
 * express-rate-limit utiliza un almacén en memoria local a cada proceso.
 * En arquitecturas serverless efímeras o clusters multinodo, este limitador
 * provee protección por instancia frente a ráfagas rápidas de fuerza bruta y DoS.
 * Para una limitación global compartida entre réplicas sin añadir dependencias pesadas,
 * se debe complementar con las reglas de WAF/Rate Limiting del proveedor de borde (Cloudflare, Vercel Firewall, AWS WAF).
 */

// 1. Autenticación: estricto (protección contra fuerza bruta y enumeración de cuentas)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // 20 intentos por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Por favor intente nuevamente en 15 minutos.' }
});

// 2. Operaciones de escritura (POST, PUT, DELETE)
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 120, // 120 peticiones de mutación por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de operaciones alcanzado. Por favor aguarde unos instantes.' }
});

// 3. Subida de archivos e importaciones pesadas
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30, // 30 subidas cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de subidas de archivos excedido. Intente nuevamente en unos minutos.' }
});

// 4. Operaciones generales de lectura
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 600, // 600 peticiones por minuto (suficiente para navegación fluida de la SPA)
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health', // Health check exento de penalización
  message: { error: 'Demasiadas solicitudes. Por favor aguarde un momento.' }
});

module.exports = {
  authLimiter,
  writeLimiter,
  uploadLimiter,
  generalLimiter
};
