const db = require('../db');
const { getCommissionRate } = require('../services/commissionService');
const { ensurePolicyInstallments } = require('./paymentController');

async function getQuotes(req, res, next) {
  const { page, limit, search, estado } = req.query || {};
  try {
    let sql = `
      SELECT q.*, c.nombre as cliente_nombre, v.marca, v.modelo, v.patente
      FROM cotizaciones q
      JOIN clientes c ON q.cliente_id = c.id
      LEFT JOIN vehiculos v ON q.vehiculo_id = v.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (c.nombre ILIKE ? OR q.compania ILIKE ? OR q.cobertura ILIKE ? OR v.patente ILIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (estado) {
      sql += ` AND q.estado = ?`;
      params.push(estado);
    }

    sql += ` ORDER BY q.fecha_creacion DESC, q.id DESC`;

    if (limit) {
      const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 15));
      const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
      const offset = (parsedPage - 1) * parsedLimit;

      const countSql = `SELECT COUNT(*) as count FROM (${sql}) as count_q`;
      const countRes = await db.get(countSql, params);
      const total = Number.parseInt(countRes?.count || 0, 10);

      sql += ` LIMIT ? OFFSET ?`;
      params.push(parsedLimit, offset);

      const quotes = await db.all(sql, params);
      return res.json({
        data: quotes,
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit) || 1
      });
    }

    const quotes = await db.all(sql, params);
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
    const result = await db.withTransaction(async trx => {
      const quote = await trx.run(`
        INSERT INTO cotizaciones (cliente_id, vehiculo_id, compania, cobertura, monto_total, valor_cuota, estado, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [cliente_id, vehiculo_id, compania, cobertura, monto_total, valor_cuota, estado || 'pendiente', notas]);

      await trx.run(`
        INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
        VALUES (?, 'whatsapp', ?)
      `, [cliente_id, `Se generó presupuesto de cotización para ${compania} (${cobertura}).`]);
      return quote;
    }, { userId: req.user?.id, requestId: req.id });

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
    const result = await db.withTransaction(async trx => {
      const quote = await trx.get('SELECT * FROM cotizaciones WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!quote) {
        const error = new Error('Cotización no encontrada');
        error.status = 404;
        throw error;
      }
      if (quote.estado === 'aceptada') {
        const error = new Error('La cotización ya fue convertida anteriormente.');
        error.status = 409;
        throw error;
      }

      const policy = await trx.run(`
        INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
        VALUES (?, 0, ?, ?, ?, 'vigente', ?, ?, ?, ?, ?, ?)
      `, [numero_poliza, fecha_inicio, fecha_vencimiento, quote.cobertura, quote.monto_total,
        quote.valor_cuota, forma_pago, quote.compania, quote.cliente_id, quote.vehiculo_id]);

      await trx.run("UPDATE cotizaciones SET estado = 'aceptada' WHERE id = ?", [quote.id]);

      const cuotaVal = Number.parseFloat(quote.valor_cuota || quote.monto_total || 0);
      const tasa = await getCommissionRate(quote.compania, quote.cobertura, trx);
      await trx.run(`
        INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
        VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
      `, [policy.id, quote.compania, Number.parseFloat(quote.monto_total || cuotaVal || 0),
        tasa, cuotaVal * tasa, fecha_inicio.substring(0, 7)]);

      await trx.run(`
        INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
        VALUES (?, 'nota', ?)
      `, [quote.cliente_id, `Cotización aceptada y convertida a Póliza Nº ${numero_poliza} (${quote.compania}).`]);

      await ensurePolicyInstallments(policy.id, trx);

      return policy;
    }, { userId: req.user?.id, requestId: req.id });

    res.json({ id: result.id, message: 'Cotización convertida en póliza con éxito' });
  } catch (err) {
    next(err);
  }
}

async function deleteQuote(req, res, next) {
  try {
    const result = await db.run("UPDATE cotizaciones SET estado = 'rechazada' WHERE id = ? AND estado <> 'rechazada'", [req.params.id]);
    if (!result.changes) {
      const error = new Error('Cotización no encontrada o ya rechazada');
      error.status = 404;
      return next(error);
    }
    res.json({ message: 'Cotización archivada como rechazada.' });
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
