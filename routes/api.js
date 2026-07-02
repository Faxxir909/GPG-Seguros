const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const authController = require('../controllers/authController');
const dashboardController = require('../controllers/dashboardController');
const clientController = require('../controllers/clientController');
const vehicleController = require('../controllers/vehicleController');
const policyController = require('../controllers/policyController');
const quoteController = require('../controllers/quoteController');
const claimController = require('../controllers/claimController');
const agendaController = require('../controllers/agendaController');
const commissionController = require('../controllers/commissionController');
const uploadController = require('../controllers/uploadController');

const JWT_SECRET = process.env.JWT_SECRET || 'gpg_seguros_secret_key_12345';

// Middleware para verificar JWT y roles
function checkRole(roles) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado. Falta token de autenticación.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded; // Adjuntar datos de usuario

      if (roles && !roles.includes(decoded.rol)) {
        return res.status(403).json({ error: 'Acceso denegado. Permisos insuficientes.' });
      }
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado.' });
    }
  };
}

// 1. AUTENTICACIÓN
router.post('/auth/login', authController.login);
router.post('/auth/google', authController.googleLogin);
router.get('/auth/google-client-id', (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

// 2. DASHBOARD
router.get('/dashboard', checkRole(['admin', 'productor', 'administrativo']), dashboardController.getDashboard);

// 3. GESTIÓN DE CLIENTES
router.get('/clients', checkRole(['admin', 'productor', 'administrativo']), clientController.getClients);
router.get('/clients/:id', checkRole(['admin', 'productor', 'administrativo']), clientController.getClientById);
router.post('/clients', checkRole(['admin', 'productor']), clientController.createClient);
router.post('/clients/import', checkRole(['admin', 'productor']), clientController.importClients);
router.put('/clients/:id', checkRole(['admin', 'productor']), clientController.updateClient);
router.delete('/clients/:id', checkRole(['admin']), clientController.deleteClient);
router.get('/clients/:id/history', checkRole(['admin', 'productor', 'administrativo']), clientController.getClientHistory);
router.get('/clients/:id/policies', checkRole(['admin', 'productor', 'administrativo']), clientController.getClientPolicies);
router.get('/clients/:id/vehicles', checkRole(['admin', 'productor', 'administrativo']), clientController.getClientVehicles);
router.get('/clients/:id/attachments', checkRole(['admin', 'productor', 'administrativo']), clientController.getClientAttachments);

// 4. GESTIÓN DE VEHÍCULOS
router.get('/vehicles', checkRole(['admin', 'productor', 'administrativo']), vehicleController.getVehicles);
router.post('/vehicles', checkRole(['admin', 'productor']), vehicleController.createVehicle);
router.put('/vehicles/:id', checkRole(['admin', 'productor']), vehicleController.updateVehicle);
router.delete('/vehicles/:id', checkRole(['admin', 'productor']), vehicleController.deleteVehicle);
router.get('/brands', checkRole(['admin', 'productor', 'administrativo']), vehicleController.getBrands);
router.get('/brands/:brand/models', checkRole(['admin', 'productor', 'administrativo']), vehicleController.getModels);
router.get('/brands/:brand/models/:model/versions', checkRole(['admin', 'productor', 'administrativo']), vehicleController.getVersions);
router.get('/vehicles/lookup', checkRole(['admin', 'productor']), vehicleController.lookupVehicle);

// 5. GESTIÓN DE PÓLIZAS
router.get('/policies', checkRole(['admin', 'productor', 'administrativo']), policyController.getPolicies);
router.post('/policies', checkRole(['admin', 'productor']), policyController.createPolicy);
router.put('/policies/:id', checkRole(['admin', 'productor']), policyController.updatePolicy);
router.post('/policies/:id/renew', checkRole(['admin', 'productor']), policyController.renewPolicy);
router.delete('/policies/:id', checkRole(['admin']), policyController.deletePolicy);

// 6. COTIZACIONES
router.get('/quotes', checkRole(['admin', 'productor', 'administrativo']), quoteController.getQuotes);
router.post('/quotes', checkRole(['admin', 'productor']), quoteController.createQuote);
router.put('/quotes/:id', checkRole(['admin', 'productor']), quoteController.updateQuote);
router.post('/quotes/:id/convert', checkRole(['admin', 'productor']), quoteController.convertQuote);
router.delete('/quotes/:id', checkRole(['admin', 'productor']), quoteController.deleteQuote);

// 7. GESTIÓN DE SINIESTROS
router.get('/claims', checkRole(['admin', 'productor', 'administrativo']), claimController.getClaims);
router.post('/claims', checkRole(['admin', 'productor', 'administrativo']), claimController.createClaim);
router.put('/claims/:id', checkRole(['admin', 'productor', 'administrativo']), claimController.updateClaim);
router.delete('/claims/:id', checkRole(['admin']), claimController.deleteClaim);

// 8. AGENDA Y SEGUIMIENTO
router.get('/agenda', checkRole(['admin', 'productor', 'administrativo']), agendaController.getAgenda);
router.post('/agenda', checkRole(['admin', 'productor', 'administrativo']), agendaController.createAgenda);
router.put('/agenda/:id', checkRole(['admin', 'productor', 'administrativo']), agendaController.updateAgenda);
router.delete('/agenda/:id', checkRole(['admin', 'productor', 'administrativo']), agendaController.deleteAgenda);

// 9. CRM COMERCIAL LOGS
router.post('/crm/logs', checkRole(['admin', 'productor']), commissionController.createCrmLog);

// 10. GESTIÓN DE COMISIONES
router.get('/commissions', checkRole(['admin', 'productor']), commissionController.getCommissions);
router.put('/commissions/:id', checkRole(['admin']), commissionController.updateCommission);

// 11. SUBIDA DE ARCHIVOS
router.post('/upload', checkRole(['admin', 'productor', 'administrativo']), uploadController.uploadFile);

module.exports = router;
