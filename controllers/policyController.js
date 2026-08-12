const db = require('../db');
const { getCommissionRate } = require('../services/commissionService');

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

    // Crear registro automático de comisión según la tasa configurada para la compañía
    const tasa = await getCommissionRate(compania, cobertura);
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

    const tasa = await getCommissionRate(oldPolicy.compania, oldPolicy.cobertura);
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

const { parsePolicyPdfBuffer } = require('../services/pdfParserService');

// Parsear PDF de póliza y extraer datos estructurados
async function parsePolicyPdf(req, res, next) {
  if (!req.files || (!req.files.archivo && !req.files.pdf)) {
    const error = new Error('No se subió ningún archivo PDF.');
    error.status = 400;
    return next(error);
  }

  const file = req.files.archivo || req.files.pdf;
  try {
    const extracted = await parsePolicyPdfBuffer(file.data);
    res.json({ success: true, extracted });
  } catch (err) {
    console.error('[parsePolicyPdf Error]:', err);
    next(new Error('Error al procesar el archivo PDF: ' + err.message));
  }
}

// Carga Inteligente en 1 clic (Crea/Actualiza Cliente, Vehículo y Póliza en transacción)
async function smartCreatePolicy(req, res, next) {
  const { cliente, vehiculo, poliza } = req.body;
  if (!cliente || !cliente.nombre || !poliza || !poliza.numero_poliza) {
    const error = new Error('Los datos del cliente y la póliza son obligatorios.');
    error.status = 400;
    return next(error);
  }

  const { pool } = require('../db');
  const clientConn = await pool.connect();

  try {
    await clientConn.query('BEGIN');

    // 1. Obtener o crear Cliente por DNI/CUIT
    let clienteId = null;
    if (cliente.dni_cuit) {
      const existingClient = await clientConn.query('SELECT id FROM clientes WHERE dni_cuit = $1', [cliente.dni_cuit.trim()]);
      if (existingClient.rows.length > 0) {
        clienteId = existingClient.rows[0].id;
        // Actualizar datos de contacto si viene info nueva
        await clientConn.query(`
          UPDATE clientes 
          SET nombre = $1, telefono = COALESCE($2, telefono), email = COALESCE($3, email),
              direccion = COALESCE($4, direccion), localidad = COALESCE($5, localidad), provincia = COALESCE($6, provincia)
          WHERE id = $7
        `, [cliente.nombre, cliente.telefono || null, cliente.email || null, cliente.direccion || null, cliente.localidad || null, cliente.provincia || null, clienteId]);
      }
    }

    if (!clienteId) {
      const newClientRes = await clientConn.query(`
        INSERT INTO clientes (nombre, dni_cuit, telefono, email, direccion, localidad, provincia, estado, riesgo_baja)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'activo', 0)
        RETURNING id
      `, [
        cliente.nombre,
        cliente.dni_cuit ? cliente.dni_cuit.trim() : `TEMP-${Date.now()}`,
        cliente.telefono || null,
        cliente.email || null,
        cliente.direccion || null,
        cliente.localidad || null,
        cliente.provincia || 'Córdoba'
      ]);
      clienteId = newClientRes.rows[0].id;
    }

    // 2. Obtener o crear Vehículo si viene info
    let vehiculoId = null;
    if (vehiculo && (vehiculo.patente || vehiculo.marca)) {
      if (vehiculo.patente) {
        const cleanPat = vehiculo.patente.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const existingVeh = await clientConn.query('SELECT id FROM vehiculos WHERE patente = $1', [cleanPat]);
        if (existingVeh.rows.length > 0) {
          vehiculoId = existingVeh.rows[0].id;
        } else {
          const newVehRes = await clientConn.query(`
            INSERT INTO vehiculos (cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
          `, [
            clienteId,
            vehiculo.marca || 'Chevrolet',
            vehiculo.modelo || 'S-10',
            vehiculo.version || null,
            vehiculo.anio ? parseInt(vehiculo.anio) : 2020,
            cleanPat,
            vehiculo.chasis || null,
            vehiculo.motor || null,
            vehiculo.uso || 'particular'
          ]);
          vehiculoId = newVehRes.rows[0].id;
        }
      }
    }

    // 3. Crear la Póliza
    const polRes = await clientConn.query(`
      INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
      VALUES ($1, 0, $2, $3, $4, 'vigente', $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      poliza.numero_poliza,
      poliza.fecha_inicio,
      poliza.fecha_vencimiento,
      poliza.cobertura || 'Cobertura Completa',
      parseFloat(poliza.monto_total || 0),
      parseFloat(poliza.valor_cuota || 0),
      poliza.forma_pago || 'efectivo',
      poliza.compania || 'El Norte Seguros',
      clienteId,
      vehiculoId
    ]);

    const polizaId = polRes.rows[0].id;

    // 4. Calcular e insertar comisión dinámica
    const tasa = await getCommissionRate(poliza.compania, poliza.cobertura);
    const montoComision = parseFloat(poliza.valor_cuota || 0) * tasa;
    const periodo = poliza.fecha_inicio.substring(0, 7);
    await clientConn.query(`
      INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
      VALUES ($1, $2, $3, $4, $5, 'pendiente', $6)
    `, [polizaId, poliza.compania, parseFloat(poliza.monto_total || 0), tasa, montoComision, periodo]);

    // 5. Historial CRM
    await clientConn.query(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES ($1, 'nota', $2)
    `, [clienteId, `Carga Inteligente: Se emitió póliza Nº ${poliza.numero_poliza} (${poliza.compania}) desde lectura automática de PDF.`]);

    await clientConn.query('COMMIT');

    res.status(201).json({
      success: true,
      poliza_id: polizaId,
      cliente_id: clienteId,
      vehiculo_id: vehiculoId,
      message: '¡Póliza, Cliente y Vehículo registrados exitosamente con Carga Inteligente!'
    });
  } catch (err) {
    await clientConn.query('ROLLBACK');
    next(err);
  } finally {
    clientConn.release();
  }
}

module.exports = {
  getPolicies,
  createPolicy,
  updatePolicy,
  renewPolicy,
  deletePolicy,
  parsePolicyPdf,
  smartCreatePolicy
};
