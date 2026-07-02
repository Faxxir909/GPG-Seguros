const db = require('../db');

async function getQuotes(req, res, next) {
  try {
    const quotes = await db.all(`
      SELECT q.*, c.nombre as cliente_nombre, v.marca, v.modelo, v.patente
      FROM cotizaciones q
      JOIN clientes c ON q.cliente_id = c.id
      LEFT JOIN vehiculos v ON q.vehiculo_id = v.id
      ORDER BY q.fecha_creacion DESC
    `);
    res.json(quotes);
  } catch (err) {
    next(err);
  }
}

async function createQuote(req, res, next) {
  const { cliente_id, vehiculo_id, compania, cobertura, monto_total, valor_cuota, estado, notas } = req.body;
  if (!cliente_id || !compania || !cobertura) {
    const error = new Error('Cliente, compañía y cobertura son requeridos.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO cotizaciones (cliente_id, vehiculo_id, compania, cobertura, monto_total, valor_cuota, estado, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [cliente_id, vehiculo_id, compania, cobertura, monto_total, valor_cuota, estado || 'pendiente', notas]);

    // Historial
    await db.run(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES (?, 'whatsapp', ?)
    `, [cliente_id, `Se generó presupuesto de cotización para ${compania} (${cobertura}).`]);

    res.status(201).json({ id: result.id, message: 'Cotización guardada con éxito' });
  } catch (err) {
    next(err);
  }
}

async function updateQuote(req, res, next) {
  const { compania, cobertura, monto_total, valor_cuota, estado, notas } = req.body;
  try {
    await db.run(`
      UPDATE cotizaciones
      SET compania = ?, cobertura = ?, monto_total = ?, valor_cuota = ?, estado = ?, notas = ?
      WHERE id = ?
    `, [compania, cobertura, monto_total, valor_cuota, estado, notas, req.params.id]);
    res.json({ message: 'Cotización actualizada con éxito' });
  } catch (err) {
    next(err);
  }
}

async function convertQuote(req, res, next) {
  const { numero_poliza, fecha_inicio, fecha_vencimiento, forma_pago } = req.body;
  if (!numero_poliza || !fecha_inicio || !fecha_vencimiento || !forma_pago) {
    const error = new Error('Número de póliza, fecha de inicio, fecha de vencimiento y forma de pago son requeridos.');
    error.status = 400;
    return next(error);
  }

  try {
    const quote = await db.get('SELECT * FROM cotizaciones WHERE id = ?', [req.params.id]);
    if (!quote) {
      const error = new Error('Cotización no encontrada');
      error.status = 404;
      return next(error);
    }

    // Insertar póliza
    const result = await db.run(`
      INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
      VALUES (?, 0, ?, ?, ?, 'vigente', ?, ?, ?, ?, ?, ?)
    `, [
      numero_poliza,
      fecha_inicio,
      fecha_vencimiento,
      quote.cobertura,
      quote.monto_total,
      quote.valor_cuota,
      forma_pago,
      quote.compania,
      quote.cliente_id,
      quote.vehiculo_id
    ]);

    // Actualizar cotización a aceptada
    await db.run("UPDATE cotizaciones SET estado = 'aceptada' WHERE id = ?", [quote.id]);

    // Comisión
    const tasa = 0.15;
    const montoComision = quote.valor_cuota * tasa;
    const periodo = fecha_inicio.substring(0, 7);
    await db.run(`
      INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
      VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
    `, [result.id, quote.compania, quote.monto_total, tasa, montoComision, periodo]);

    // Historial
    await db.run(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES (?, 'nota', ?)
    `, [quote.cliente_id, `Cotización aceptada y convertida a Póliza Nº ${numero_poliza} (${quote.compania}).`]);

    res.json({ id: result.id, message: 'Cotización convertida en póliza con éxito' });
  } catch (err) {
    next(err);
  }
}

async function deleteQuote(req, res, next) {
  try {
    await db.run('DELETE FROM cotizaciones WHERE id = ?', [req.params.id]);
    res.json({ message: 'Cotización eliminada con éxito' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getQuotes,
  createQuote,
  updateQuote,
  convertQuote,
  deleteQuote
};
