const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');
const { setCurrentUser } = require('../database/request-context');

/**
 * Middleware de autenticación y autorización por roles.
 * Lee el JWT desde:
 *   1. Cookie httpOnly 'gpg_token' (método principal y seguro)
 *   2. Header Authorization: Bearer <token> (fallback para API/Postman)
 *
 * @param {string[]} roles - Roles permitidos (e.g. ['admin', 'productor'])
 */
function checkRole(roles) {
  return (req, res, next) => {
    // 1. Leer desde cookie httpOnly (método seguro — principal)
    let token = req.cookies?.gpg_token;

    // 2. Fallback: Authorization header (para clientes API/Postman)
    if (!token) {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'No autorizado. Inicie sesión para continuar.' });
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
        issuer: 'gpg-seguros',
        audience: 'gpg-seguros-crm'
      });
      req.user = decoded;
      setCurrentUser(decoded.id);

      if (roles && !roles.includes(decoded.rol)) {
        return res.status(403).json({ error: 'Acceso denegado. Permisos insuficientes.' });
      }
      next();
    } catch (err) {
      // Cookie expirada o inválida: borrarla y devolver 401
      res.clearCookie('gpg_token');
      return res.status(401).json({ error: 'Sesión expirada. Por favor inicie sesión nuevamente.' });
    }
  };
}

module.exports = { checkRole };
