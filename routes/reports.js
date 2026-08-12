const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { checkRole } = require('../middlewares/auth');

// Exportar reportes
router.get('/excel', checkRole(['admin', 'productor']), reportController.exportExcel);
router.get('/pdf', checkRole(['admin', 'productor']), reportController.exportPdf);

module.exports = router;

