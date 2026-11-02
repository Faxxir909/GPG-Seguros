const { getAllowedOrigins } = require('../config/security');

/**
 * Middleware de protección CSRF para peticiones mutables con autenticación basada en cookies.
 *
 * Mecanismo de defensa en profundidad:
 * 1. Peticiones de lectura (GET, HEAD, OPTIONS) están exentas.
 * 2. Peticiones autenticadas por Header Bearer son inmunes al CSRF del browser.
 * 3. Peticiones con header personalizado (X-Requested-With) no pueden ser emitidas por formularios HTML cross-site.
 * 4. Verificación de coincidencia de Origin / Referer contra la allowlist configurada.
 */
function csrfProtection(req, res, next) {
  // 1. Métodos seguros no mutables
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // 2. Si usa Bearer token explícito en headers, no utiliza cookies implícitas
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  // 3. Verificar header personalizado del cliente (nuestra SPA envía X-Requested-With)
  const requestedWith = req.headers['x-requested-with'];
  if (requestedWith && requestedWith.toLowerCase() === 'xmlhttprequest') {
    return next();
  }

  // 4. Verificar Origin o Referer contra la lista de orígenes permitidos
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  let allowedOrigins = [];

  try {
    allowedOrigins = getAllowedOrigins();
  } catch (err) {
    // Si hay error de configuración en producción
    return res.status(500).json({ error: 'Configuración de seguridad incompleta en el servidor.' });
  }

  if (origin) {
    if (allowedOrigins.includes(origin)) {
      return next();
    }
    return res.status(403).json({ error: 'Acceso bloqueado: Origen no autorizado por protección CSRF.' });
  }

  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (allowedOrigins.includes(refererOrigin)) {
        return next();
      }
    } catch {
      // URL de referer malformada
    }
    return res.status(403).json({ error: 'Acceso bloqueado: Referencia no autorizada por protección CSRF.' });
  }

  // Si no hay Authorization header, ni X-Requested-With, ni Origin, ni Referer verificables:
  // en peticiones mutables, rechazar por seguridad
  return res.status(403).json({ error: 'Petición bloqueada por política de protección CSRF (faltan encabezados de verificación).' });
}

module.exports = { csrfProtection };
