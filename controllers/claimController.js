const db = require('../db');

async function getClaims(req, res, next) {
  const { page, limit, search, estado } = req.query || {};
  try {
    let sql = `
      SELECT s.*, c.nombre as cliente_nombre, v.marca, v.modelo, v.patente, p.numero_poliza, p.compania
      FROM siniestros s
      JOIN clientes c ON s.cliente_id = c.id
      LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
      LEFT JOIN polizas p ON s.poliza_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (s.numero_siniestro ILIKE ? OR c.nombre ILIKE ? OR v.patente ILIKE ? OR s.descripcion ILIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (estado) {
      sql += ` AND s.estado = ?`;
      params.push(estado);
    }

    sql += ` ORDER BY s.fecha DESC, s.id DESC`;

    if (limit) {
      const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 15));
      const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
      const offset = (parsedPage - 1) * parsedLimit;

      const countSql = `SELECT COUNT(*) as count FROM (${sql}) as count_q`;
      const countRes = await db.get(countSql, params);
      const total = Number.parseInt(countRes?.count || 0, 10);

      sql += ` LIMIT ? OFFSET ?`;
      params.push(parsedLimit, offset);

      const claims = await db.all(sql, params);
      return res.json({
        data: claims,
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit) || 1
      });
    }

    const claims = await db.all(sql, params);
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

async function getClaimsByClient(req, res, next) {
  try {
    const claims = await db.all(`
      SELECT s.*, c.nombre as cliente_nombre, v.marca, v.modelo, v.patente, p.numero_poliza, p.compania
      FROM siniestros s
      JOIN clientes c ON s.cliente_id = c.id
      LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
      LEFT JOIN polizas p ON s.poliza_id = p.id
      WHERE s.cliente_id = ?
      ORDER BY s.fecha DESC
    `, [req.params.id]);
    res.json(claims);
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
  getClaimsByClient,
  createClaim,
  updateClaim,
  deleteClaim
};
