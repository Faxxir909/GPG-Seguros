const db = require('../db');

const TIPOS_VALIDOS = ['llamada', 'reunion', 'recordatorio', 'renovacion'];

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

  const cleanTipo = tipo ? String(tipo).toLowerCase().trim() : 'recordatorio';
  if (!TIPOS_VALIDOS.includes(cleanTipo)) {
    const error = new Error(`Tipo de tarea inválido. Opciones permitidas: ${TIPOS_VALIDOS.join(', ')}.`);
    error.status = 400;
    return next(error);
  }

  const cId = (cliente_id !== undefined && cliente_id !== null && cliente_id !== '') ? parseInt(cliente_id, 10) : null;
  if (cId !== null && (isNaN(cId) || cId <= 0)) {
    const error = new Error('ID de cliente inválido.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO agenda (cliente_id, titulo, descripcion, fecha_vencimiento, tipo, completado)
      VALUES (?, ?, ?, ?, ?, false)
    `, [cId, String(titulo).trim(), descripcion ? String(descripcion).trim() : null, fecha_vencimiento, cleanTipo]);
    res.status(201).json({ id: result.id, message: 'Tarea programada en agenda' });
  } catch (err) {
    next(err);
  }
}

async function updateAgenda(req, res, next) {
  const id = parseInt(req.params.id, 10);
  if (!id || id <= 0) {
    return res.status(400).json({ error: 'ID de tarea inválido.' });
  }

  const { titulo, descripcion, fecha_vencimiento, tipo, completado } = req.body;

  let cleanTipo = null;
  if (tipo !== undefined) {
    cleanTipo = String(tipo).toLowerCase().trim();
    if (!TIPOS_VALIDOS.includes(cleanTipo)) {
      return res.status(400).json({ error: `Tipo de tarea inválido. Opciones permitidas: ${TIPOS_VALIDOS.join(', ')}.` });
    }
  }

  const isCompletado = completado !== undefined ? Boolean(completado) : null;

  try {
    const existing = await db.get('SELECT * FROM agenda WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Tarea no encontrada en la agenda.' });
    }

    const nuevoTitulo = titulo !== undefined ? String(titulo).trim() : existing.titulo;
    const nuevaDesc = descripcion !== undefined ? (descripcion ? String(descripcion).trim() : null) : existing.descripcion;
    const nuevoVenc = fecha_vencimiento !== undefined ? fecha_vencimiento : existing.fecha_vencimiento;
    const nuevoTipo = cleanTipo || existing.tipo;
    const nuevoCompletado = isCompletado !== null ? isCompletado : existing.completado;

    await db.run(`
      UPDATE agenda
      SET titulo = ?, descripcion = ?, fecha_vencimiento = ?, tipo = ?, completado = ?
      WHERE id = ?
    `, [nuevoTitulo, nuevaDesc, nuevoVenc, nuevoTipo, nuevoCompletado, id]);

    res.json({ message: 'Tarea de agenda actualizada' });
  } catch (err) {
    next(err);
  }
}

async function deleteAgenda(req, res, next) {
  const id = parseInt(req.params.id, 10);
  if (!id || id <= 0) {
    return res.status(400).json({ error: 'ID de tarea inválido.' });
  }

  try {
    const result = await db.run('DELETE FROM agenda WHERE id = ?', [id]);
    if (!result.changes) {
      return res.status(404).json({ error: 'Tarea no encontrada en la agenda.' });
    }
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

