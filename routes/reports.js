const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'gpg_seguros_secret_key_12345';

// Middleware para verificar JWT y roles
function checkRole(roles) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado. Falta token.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded; // Inyectar datos de usuario

      if (roles && !roles.includes(decoded.rol)) {
        return res.status(403).json({ error: 'Acceso denegado. Permisos insuficientes.' });
      }
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado.' });
    }
  };
}

// Exportar reportes
router.get('/excel', checkRole(['admin', 'productor']), reportController.exportExcel);
router.get('/pdf', checkRole(['admin', 'productor']), reportController.exportPdf);

module.exports = router;
