// =========================================================================
// paymentController.js — Módulo de Cobranzas y Gestión de Cuotas
// =========================================================================
const db = require('../db');

/** Helper para generar cuotas automáticamente si la póliza no tiene */
async function ensurePolicyInstallments(policyId) {
  const existing = await db.all('SELECT * FROM cuotas_cobranza WHERE poliza_id = ? ORDER BY numero_cuota ASC', [policyId]);
  if (existing && existing.length > 0) {
    return existing;
  }

  const policy = await db.get('SELECT * FROM polizas WHERE id = ?', [policyId]);
  if (!policy) return [];

  const totalCuotas = (policy.valor_cuota && parseFloat(policy.valor_cuota) > 0 && policy.monto_total)
    ? Math.max(1, Math.min(12, Math.round(parseFloat(policy.monto_total) / parseFloat(policy.valor_cuota))))
    : 12;

  const montoCuota = (policy.valor_cuota && parseFloat(policy.valor_cuota) > 0)
    ? parseFloat(policy.valor_cuota)
    : (parseFloat(policy.monto_total || 0) / totalCuotas);

  const startDate = new Date(policy.fecha_inicio || new Date());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const createdCuotas = [];

  for (let i = 1; i <= totalCuotas; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(startDate.getMonth() + (i - 1));
    const dueDateStr = dueDate.toISOString().split('T')[0];

    // Determinar estado inicial
    let estado = 'pendiente';
    let fechaPago = null;
    if (dueDate.getTime() < today.getTime()) {
      // Si la fecha ya pasó, marcar como pagada las primeras cuotas o pendiente
      // Por defecto, si es anterior a hoy, podemos considerarla pagada si la póliza está activa o pendiente
      estado = 'pendiente';
    }

    await db.run(
      `INSERT INTO cuotas_cobranza (poliza_id, numero_cuota, total_cuotas, fecha_vencimiento, monto, estado, fecha_pago, forma_pago)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (poliza_id, numero_cuota) DO NOTHING`,
      [policyId, i, totalCuotas, dueDateStr, montoCuota, estado, fechaPago, policy.forma_pago || 'Efectivo / Transferencia']
    ).catch(async () => {
      // Fallback SQLite insert or ignore
      await db.run(
        `INSERT OR IGNORE INTO cuotas_cobranza (poliza_id, numero_cuota, total_cuotas, fecha_vencimiento, monto, estado, fecha_pago, forma_pago)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [policyId, i, totalCuotas, dueDateStr, montoCuota, estado, fechaPago, policy.forma_pago || 'Efectivo / Transferencia']
      );
    });
  }

  return db.all('SELECT * FROM cuotas_cobranza WHERE poliza_id = ? ORDER BY numero_cuota ASC', [policyId]);
}

/** Obtener el plan de cuotas de una póliza */
exports.getPolicyInstallments = async (req, res) => {
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
};

/** Marcar o actualizar el estado de una cuota */
exports.updateInstallment = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { estado, fecha_pago, forma_pago, notas } = req.body;

    const cuota = await db.get('SELECT * FROM cuotas_cobranza WHERE id = ?', [id]);
    if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });

    const nuevoEstado = estado || cuota.estado;
    const nuevaFechaPago = nuevoEstado === 'pagada' ? (fecha_pago || new Date().toISOString().split('T')[0]) : null;
    const nuevaFormaPago = forma_pago || cuota.forma_pago;
    const nuevasNotas = notas !== undefined ? notas : cuota.notas;

    await db.run(
      `UPDATE cuotas_cobranza 
       SET estado = ?, fecha_pago = ?, forma_pago = ?, notas = ?
       WHERE id = ?`,
      [nuevoEstado, nuevaFechaPago, nuevaFormaPago, nuevasNotas, id]
    );

    res.json({ message: 'Cuota actualizada exitosamente', cuotaId: id, estado: nuevoEstado });
  } catch (error) {
    console.error('Error al actualizar cuota:', error);
    res.status(500).json({ error: 'Error al actualizar la cuota' });
  }
};

/** Resumen global de cobranzas */
exports.getCollectionSummary = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const stats = await db.get(`
      SELECT 
        COUNT(CASE WHEN estado = 'pagada' THEN 1 END) as cuotas_cobradas,
        COALESCE(SUM(CASE WHEN estado = 'pagada' THEN monto END), 0) as total_cobrado,
        COUNT(CASE WHEN estado = 'pendiente' AND fecha_vencimiento >= ? THEN 1 END) as cuotas_pendientes,
        COALESCE(SUM(CASE WHEN estado = 'pendiente' AND fecha_vencimiento >= ? THEN monto END), 0) as total_pendiente,
        COUNT(CASE WHEN (estado = 'en_mora' OR (estado = 'pendiente' AND fecha_vencimiento < ?)) THEN 1 END) as cuotas_mora,
        COALESCE(SUM(CASE WHEN (estado = 'en_mora' OR (estado = 'pendiente' AND fecha_vencimiento < ?)) THEN monto END), 0) as total_mora
      FROM cuotas_cobranza
    `, [today, today, today, today]);

    res.json(stats || { cuotas_cobradas: 0, total_cobrado: 0, cuotas_pendientes: 0, total_pendiente: 0, cuotas_mora: 0, total_mora: 0 });
  } catch (error) {
    console.error('Error en resumen de cobranzas:', error);
    res.status(500).json({ error: 'Error al obtener resumen de cobranzas' });
  }
};
