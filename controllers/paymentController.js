// =========================================================================
// paymentController.js — Módulo de Cobranzas y Gestión de Cuotas
// =========================================================================
const db = require('../db');

/** Helper para generar cuotas automáticamente si la póliza no tiene */
async function ensurePolicyInstallments(policyId, dbExecutor = db) {
  const existing = await dbExecutor.all('SELECT * FROM cuotas_cobranza WHERE poliza_id = ? ORDER BY numero_cuota ASC', [policyId]);
  if (existing && existing.length > 0) {
    return existing;
  }

  const policy = await dbExecutor.get('SELECT * FROM polizas WHERE id = ?', [policyId]);
  if (!policy) return [];

  const totalCuotas = (policy.valor_cuota && parseFloat(policy.valor_cuota) > 0 && policy.monto_total)
    ? Math.max(1, Math.min(12, Math.round(parseFloat(policy.monto_total) / parseFloat(policy.valor_cuota))))
    : 12;

  const montoCuota = (policy.valor_cuota && parseFloat(policy.valor_cuota) > 0)
    ? parseFloat(policy.valor_cuota)
    : (parseFloat(policy.monto_total || 0) / totalCuotas);

  const dateStr = String(policy.fecha_inicio || '').split('T')[0];
  const parts = dateStr.split('-');
  const startYear = parts.length === 3 ? parseInt(parts[0], 10) : new Date().getFullYear();
  const startMonth = parts.length === 3 ? parseInt(parts[1], 10) - 1 : new Date().getMonth();
  const startDay = parts.length === 3 ? parseInt(parts[2], 10) : new Date().getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i <= totalCuotas; i++) {
    // Cálculo seguro de fecha evitando el month-rollover bug de JavaScript
    const targetMonth = startMonth + (i - 1);
    const tempDate = new Date(startYear, targetMonth, 1);
    const maxDaysInMonth = new Date(tempDate.getFullYear(), tempDate.getMonth() + 1, 0).getDate();
    const effectiveDay = Math.min(startDay, maxDaysInMonth);
    const dueDate = new Date(tempDate.getFullYear(), tempDate.getMonth(), effectiveDay);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    // Determinar estado inicial
    let estado = 'pendiente';
    let fechaPago = null;
    if (dueDate.getTime() < today.getTime()) {
      estado = 'pendiente';
    }

    await dbExecutor.run(
      `INSERT INTO cuotas_cobranza (poliza_id, numero_cuota, total_cuotas, fecha_vencimiento, monto, estado, fecha_pago, forma_pago)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (poliza_id, numero_cuota) DO NOTHING`,
      [policyId, i, totalCuotas, dueDateStr, montoCuota, estado, fechaPago, policy.forma_pago || 'Efectivo / Transferencia']
    );
  }

  return dbExecutor.all('SELECT * FROM cuotas_cobranza WHERE poliza_id = ? ORDER BY numero_cuota ASC', [policyId]);
}

/** Obtener el plan de cuotas de una póliza */
async function getPolicyInstallments(req, res) {
  try {
    const policyId = parseInt(req.params.id);
    if (!policyId) return res.status(400).json({ error: 'ID de póliza inválido' });

    const cuotas = await ensurePolicyInstallments(policyId);
    const policy = await db.get(
      `SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono, c.email as cliente_email
       FROM polizas p
       JOIN clientes c ON p.cliente_id = c.id
       WHERE p.id = ?`,
      [policyId]
    );

    res.json({ policy, cuotas });
  } catch (error) {
    console.error('Error al obtener cuotas de póliza:', error);
    res.status(500).json({ error: 'Error al obtener cuotas de la póliza' });
  }
}

/** Marcar o actualizar el estado de una cuota */
async function updateInstallment(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) {
      return res.status(400).json({ error: 'ID de cuota inválido. Debe ser un entero positivo.' });
    }

    const { estado, fecha_pago, forma_pago, notas } = req.body;

    const estadosValidos = ['pendiente', 'pagada', 'en_mora', 'vencida', 'anulada'];
    if (estado && !estadosValidos.includes(estado.toLowerCase().trim())) {
      return res.status(400).json({
        error: `Estado inválido. Opciones permitidas: ${estadosValidos.join(', ')}.`
      });
    }

    const result = await db.withTransaction(async trx => {
      const cuota = await trx.get('SELECT * FROM cuotas_cobranza WHERE id = ? FOR UPDATE', [id]);
      if (!cuota) {
        const err = new Error('Cuota no encontrada');
        err.status = 404;
        throw err;
      }

      const nuevoEstado = estado ? estado.toLowerCase().trim() : cuota.estado;
      const nuevaFechaPago = nuevoEstado === 'pagada' ? (fecha_pago || null) : null;
      const nuevaFormaPago = forma_pago ? String(forma_pago).trim() : cuota.forma_pago;
      const nuevasNotas = notas !== undefined ? (notas ? String(notas).trim() : null) : cuota.notas;

      await trx.run(
        `UPDATE cuotas_cobranza
         SET estado = ?, fecha_pago = CASE WHEN ? = 'pagada' THEN COALESCE(?::date, CURRENT_DATE) ELSE NULL END,
             forma_pago = ?, notas = ?
         WHERE id = ?`,
        [nuevoEstado, nuevoEstado, nuevaFechaPago, nuevaFormaPago, nuevasNotas, id]
      );

      return { cuotaId: id, estado: nuevoEstado };
    }, { userId: req.user?.id, requestId: req.id });

    res.json({ message: 'Cuota actualizada exitosamente', ...result });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error al actualizar cuota:', error.message);
    res.status(500).json({ error: 'Error interno al actualizar la cuota.' });
  }
}

/** Resumen global de cobranzas */
async function getCollectionSummary(req, res) {
  try {
    const stats = await db.get(`
      SELECT 
        COUNT(CASE WHEN estado = 'pagada' THEN 1 END) as cuotas_cobradas,
        COALESCE(SUM(CASE WHEN estado = 'pagada' THEN monto END), 0) as total_cobrado,
        COUNT(CASE WHEN estado = 'pendiente' AND fecha_vencimiento >= CURRENT_DATE THEN 1 END) as cuotas_pendientes,
        COALESCE(SUM(CASE WHEN estado = 'pendiente' AND fecha_vencimiento >= CURRENT_DATE THEN monto END), 0) as total_pendiente,
        COUNT(CASE WHEN (estado = 'en_mora' OR (estado = 'pendiente' AND fecha_vencimiento < CURRENT_DATE)) THEN 1 END) as cuotas_mora,
        COALESCE(SUM(CASE WHEN (estado = 'en_mora' OR (estado = 'pendiente' AND fecha_vencimiento < CURRENT_DATE)) THEN monto END), 0) as total_mora
      FROM cuotas_cobranza
    `);

    res.json(stats || { cuotas_cobradas: 0, total_cobrado: 0, cuotas_pendientes: 0, total_pendiente: 0, cuotas_mora: 0, total_mora: 0 });
  } catch (error) {
    console.error('Error en resumen de cobranzas:', error);
    res.status(500).json({ error: 'Error al obtener resumen de cobranzas' });
  }
}

module.exports = {
  ensurePolicyInstallments,
  getPolicyInstallments,
  updateInstallment,
  getCollectionSummary
};

