const db = require('../db');

async function getPolicies(req, res, next) {
  try {
    const policies = await db.all(`
      SELECT p.*, c.nombre as cliente_nombre, v.marca, v.modelo, v.patente
      FROM polizas p
      JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN vehiculos v ON p.vehiculo_id = v.id
      ORDER BY p.fecha_vencimiento ASC
    `);
    res.json(policies);
  } catch (err) {
    next(err);
  }
}

async function createPolicy(req, res, next) {
  const { numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id } = req.body;
  const numRen = numero_renovacion !== undefined ? parseInt(numero_renovacion) : 0;
  
  if (!numero_poliza || !fecha_inicio || !fecha_vencimiento || !cliente_id) {
    const error = new Error('Número de póliza, fecha de inicio, fecha de vencimiento y cliente son requeridos.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [numero_poliza, numRen, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id]);

    // Crear registro automático de comisión (por defecto 15%)
    const tasa = 0.15;
    const montoComision = valor_cuota * tasa;
    const periodo = fecha_inicio.substring(0, 7);
    await db.run(`
      INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [result.id, compania, monto_total, tasa, montoComision, 'pendiente', periodo]);

    // Agregar registro histórico al cliente
    await db.run(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES (?, 'nota', ?)
    `, [cliente_id, `Se emitió la póliza Nº ${numero_poliza} (${compania}) para el vehículo.`]);

    res.status(201).json({ id: result.id, message: 'Póliza emitida con éxito' });
  } catch (err) {
    next(err);
  }
}

async function updatePolicy(req, res, next) {
  const { numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, vehiculo_id } = req.body;
  
  try {
    await db.run(`
      UPDATE polizas
      SET numero_poliza = ?, fecha_inicio = ?, fecha_vencimiento = ?, cobertura = ?, estado = ?, monto_total = ?, valor_cuota = ?, forma_pago = ?, compania = ?, vehiculo_id = ?
      WHERE id = ?
    `, [numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, vehiculo_id, req.params.id]);
    res.json({ message: 'Póliza actualizada con éxito' });
  } catch (err) {
    next(err);
  }
}

async function renewPolicy(req, res, next) {
  const { tipo, numero_poliza } = req.body;
  try {
    const oldPolicy = await db.get('SELECT * FROM polizas WHERE id = ?', [req.params.id]);
    if (!oldPolicy) {
      const error = new Error('Póliza no encontrada');
      error.status = 404;
      return next(error);
    }

    const format = (d) => d.toISOString().split('T')[0];
    let nuevaFechaInicio = new Date(oldPolicy.fecha_vencimiento);
    let nuevaFechaVencimiento = new Date(oldPolicy.fecha_vencimiento);
    
    let nuevoNumero = oldPolicy.numero_poliza;
    let nuevoNumRen = oldPolicy.numero_renovacion || 0;

    if (tipo === 'cuatrimestral') {
      nuevaFechaVencimiento.setMonth(nuevaFechaVencimiento.getMonth() + 4);
      nuevoNumRen += 1;
    } else {
      nuevaFechaVencimiento.setFullYear(nuevaFechaVencimiento.getFullYear() + 1);
      nuevoNumero = numero_poliza || (oldPolicy.numero_poliza + '-REN');
      nuevoNumRen = 0;
    }

    const factorInflacion = tipo === 'cuatrimestral' ? 1.15 : 1.30;
    const nuevoMontoTotal = oldPolicy.monto_total * factorInflacion;
    const nuevoValorCuota = oldPolicy.valor_cuota * factorInflacion;

    const result = await db.run(`
      INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
      VALUES (?, ?, ?, ?, 'vigente', ?, ?, ?, ?, ?, ?, ?)
    `, [
      nuevoNumero,
      nuevoNumRen,
      format(nuevaFechaInicio),
      format(nuevaFechaVencimiento),
      oldPolicy.cobertura,
      nuevoMontoTotal,
      nuevoValorCuota,
      oldPolicy.forma_pago,
      oldPolicy.compania,
      oldPolicy.cliente_id,
      oldPolicy.vehiculo_id
    ]);

    await db.run("UPDATE polizas SET estado = 'vencida' WHERE id = ?", [oldPolicy.id]);

    const tasa = 0.15;
    const montoComision = nuevoValorCuota * tasa;
    const periodo = format(nuevaFechaInicio).substring(0, 7);
    await db.run(`
      INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
      VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
    `, [result.id, oldPolicy.compania, nuevoMontoTotal, tasa, montoComision, periodo]);

    const descripcionLog = tipo === 'cuatrimestral' 
      ? `Renovación cuatrimestral de póliza Nº ${oldPolicy.numero_poliza} (Ren. ${nuevoNumRen}).`
      : `Renovación anual de póliza Nº ${oldPolicy.numero_poliza}. Nueva póliza emitida: ${nuevoNumero}`;

    await db.run(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES (?, 'nota', ?)
    `, [oldPolicy.cliente_id, descripcionLog]);

    res.json({ id: result.id, message: 'Póliza renovada con éxito' });
  } catch (err) {
    next(err);
  }
}

async function deletePolicy(req, res, next) {
  try {
    await db.run('DELETE FROM polizas WHERE id = ?', [req.params.id]);
    res.json({ message: 'Póliza eliminada con éxito' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPolicies,
  createPolicy,
  updatePolicy,
  renewPolicy,
  deletePolicy
};
