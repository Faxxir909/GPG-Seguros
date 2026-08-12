const db = require('../db');

// Registrar CRM log
async function createCrmLog(req, res, next) {
  const { cliente_id, tipo_contacto, descripcion } = req.body;
  if (!cliente_id || !tipo_contacto || !descripcion) {
    const error = new Error('Cliente, tipo de contacto y descripción son requeridos.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES (?, ?, ?)
    `, [cliente_id, tipo_contacto, descripcion]);
    res.status(201).json({ id: result.id, message: 'Contacto registrado en bitácora' });
  } catch (err) {
    next(err);
  }
}

// Obtener comisiones con filtros opcionales
async function getCommissions(req, res, next) {
  const { periodo, compania } = req.query;
  let sql = `
    SELECT com.*, p.numero_poliza, c.nombre as cliente_nombre
    FROM comisiones com
    JOIN polizas p ON com.poliza_id = p.id
    JOIN clientes c ON p.cliente_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (periodo) {
    sql += ' AND com.periodo = ?';
    params.push(periodo);
  }
  if (compania) {
    sql += ' AND com.compania = ?';
    params.push(compania);
  }
  sql += ' ORDER BY com.periodo DESC';

  try {
    const list = await db.all(sql, params);
    res.json(list);
  } catch (err) {
    next(err);
  }
}

// Actualizar estado de pago de comisión
async function updateCommission(req, res, next) {
  const { estado_pago } = req.body;
  if (!estado_pago) {
    const error = new Error('El estado de pago es requerido.');
    error.status = 400;
    return next(error);
  }

  try {
    await db.run('UPDATE comisiones SET estado_pago = ? WHERE id = ?', [estado_pago, req.params.id]);
    res.json({ message: 'Estado de comisión actualizado' });
  } catch (err) {
    next(err);
  }
}

// Obtener tasas de comisión configuradas
async function getCommissionRates(req, res, next) {
  try {
    const rates = await db.all('SELECT * FROM tasas_comision ORDER BY compania ASC');
    res.json(rates);
  } catch (err) {
    next(err);
  }
}

// Crear o actualizar tasa de comisión
async function upsertCommissionRate(req, res, next) {
  const { compania, tipo_cobertura, tasa, descripcion, activa } = req.body;
  if (!compania || tasa === undefined) {
    const error = new Error('Compañía y tasa son requeridas.');
    error.status = 400;
    return next(error);
  }

  try {
    const query = `
      INSERT INTO tasas_comision (compania, tipo_cobertura, tasa, descripcion, activa)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (compania, tipo_cobertura) DO UPDATE SET
        tasa = EXCLUDED.tasa,
        descripcion = COALESCE(EXCLUDED.descripcion, tasas_comision.descripcion),
        activa = EXCLUDED.activa
    `;
    await db.run(query, [
      compania,
      tipo_cobertura || '*',
      parseFloat(tasa),
      descripcion || null,
      activa !== undefined ? Boolean(activa) : true
    ]);

    res.json({ message: 'Tasa de comisión guardada con éxito' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCrmLog,
  getCommissions,
  updateCommission,
  getCommissionRates,
  upsertCommissionRate
};
