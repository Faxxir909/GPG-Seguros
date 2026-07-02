const db = require('../db');

async function getAgenda(req, res, next) {
  try {
    const agenda = await db.all(`
      SELECT a.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono
      FROM agenda a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      ORDER BY a.fecha_vencimiento ASC
    `);
    res.json(agenda);
  } catch (err) {
    next(err);
  }
}

async function createAgenda(req, res, next) {
  const { cliente_id, titulo, descripcion, fecha_vencimiento, tipo } = req.body;
  if (!titulo || !fecha_vencimiento) {
    const error = new Error('Título y fecha de vencimiento son requeridos.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO agenda (cliente_id, titulo, descripcion, fecha_vencimiento, tipo, completado)
      VALUES (?, ?, ?, ?, ?, 0)
    `, [cliente_id, titulo, descripcion, fecha_vencimiento, tipo]);
    res.status(201).json({ id: result.id, message: 'Tarea programada en agenda' });
  } catch (err) {
    next(err);
  }
}

async function updateAgenda(req, res, next) {
  const { titulo, descripcion, fecha_vencimiento, tipo, completado } = req.body;
  try {
    await db.run(`
      UPDATE agenda
      SET titulo = ?, descripcion = ?, fecha_vencimiento = ?, tipo = ?, completado = ?
      WHERE id = ?
    `, [titulo, descripcion, fecha_vencimiento, tipo, completado, req.params.id]);
    res.json({ message: 'Tarea de agenda actualizada' });
  } catch (err) {
    next(err);
  }
}

async function deleteAgenda(req, res, next) {
  try {
    await db.run('DELETE FROM agenda WHERE id = ?', [req.params.id]);
    res.json({ message: 'Tarea eliminada de la agenda' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAgenda,
  createAgenda,
  updateAgenda,
  deleteAgenda
};
