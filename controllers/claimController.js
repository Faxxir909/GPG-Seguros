const db = require('../db');

async function getClaims(req, res, next) {
  try {
    const claims = await db.all(`
      SELECT s.*, c.nombre as cliente_nombre, v.marca, v.modelo, v.patente, p.numero_poliza, p.compania
      FROM siniestros s
      JOIN clientes c ON s.cliente_id = c.id
      LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
      LEFT JOIN polizas p ON s.poliza_id = p.id
      ORDER BY s.fecha DESC
    `);
    res.json(claims);
  } catch (err) {
    next(err);
  }
}

async function createClaim(req, res, next) {
  const { numero_siniestro, cliente_id, vehiculo_id, poliza_id, fecha, descripcion, estado } = req.body;
  if (!numero_siniestro || !cliente_id || !descripcion) {
    const error = new Error('Número de siniestro, cliente y descripción son requeridos.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO siniestros (numero_siniestro, cliente_id, vehiculo_id, poliza_id, fecha, descripcion, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [numero_siniestro, cliente_id, vehiculo_id, poliza_id, fecha, descripcion, estado || 'denunciado']);

    // Historial
    await db.run(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES (?, 'nota', ?)
    `, [cliente_id, `Siniestro denunciado Nº ${numero_siniestro}. Desc: ${descripcion.substring(0, 50)}...`]);

    res.status(201).json({ id: result.id, message: 'Siniestro registrado con éxito' });
  } catch (err) {
    next(err);
  }
}

async function updateClaim(req, res, next) {
  const { numero_siniestro, fecha, descripcion, estado } = req.body;
  try {
    const oldClaim = await db.get('SELECT * FROM siniestros WHERE id = ?', [req.params.id]);
    await db.run(`
      UPDATE siniestros
      SET numero_siniestro = ?, fecha = ?, descripcion = ?, estado = ?
      WHERE id = ?
    `, [numero_siniestro, fecha, descripcion, estado, req.params.id]);

    if (oldClaim && oldClaim.estado !== estado) {
      await db.run(`
        INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
        VALUES (?, 'nota', ?)
      `, [oldClaim.cliente_id, `Siniestro Nº ${numero_siniestro} cambió su estado a: ${estado}`]);
    }

    res.json({ message: 'Siniestro actualizado con éxito' });
  } catch (err) {
    next(err);
  }
}

async function deleteClaim(req, res, next) {
  try {
    await db.run('DELETE FROM siniestros WHERE id = ?', [req.params.id]);
    res.json({ message: 'Siniestro eliminado con éxito' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getClaims,
  createClaim,
  updateClaim,
  deleteClaim
};
