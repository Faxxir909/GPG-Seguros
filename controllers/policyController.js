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

const fs = require('fs');

// Parsear PDF de póliza y extraer datos estructurados
async function parsePolicyPdf(req, res, next) {
  try {
    if (!req.files || (!req.files.archivo && !req.files.pdf)) {
      return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });
    }

    const file = req.files.archivo || req.files.pdf;
    const fileBuffer = file.data || (file.tempFilePath ? fs.readFileSync(file.tempFilePath) : null);

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ error: 'El archivo PDF subido está vacío.' });
    }

    const extracted = await parsePolicyPdfBuffer(fileBuffer);
    res.json({ success: true, extracted });
  } catch (err) {
    console.error('[parsePolicyPdf Error]:', err.stack || err.message || err);
    res.status(500).json({ error: 'Error al procesar el archivo PDF: ' + err.message });
  }
}

// Carga Inteligente en 1 clic (Crea/Actualiza Cliente, Vehículo y Póliza)
async function smartCreatePolicy(req, res, next) {
  const { cliente, vehiculo, poliza } = req.body;
  if (!cliente || !cliente.nombre || !poliza || !poliza.numero_poliza) {
    return res.status(400).json({ error: 'Los datos del cliente y de la póliza son obligatorios.' });
  }

  try {
    // 1. Obtener o crear Cliente por DNI/CUIT
    let clienteId = null;
    if (cliente.dni_cuit) {
      const existingClient = await db.get('SELECT id FROM clientes WHERE dni_cuit = ?', [cliente.dni_cuit.trim()]);
      if (existingClient && existingClient.id) {
        clienteId = existingClient.id;
        // Actualizar datos de contacto si viene info nueva
        await db.run(`
          UPDATE clientes 
          SET nombre = ?, telefono = COALESCE(?, telefono), email = COALESCE(?, email),
              direccion = COALESCE(?, direccion), localidad = COALESCE(?, localidad), provincia = COALESCE(?, provincia)
          WHERE id = ?
        `, [
          cliente.nombre,
          cliente.telefono || null,
          cliente.email || null,
          cliente.direccion || null,
          cliente.localidad || null,
          cliente.provincia || null,
          clienteId
        ]);
      }
    }

    if (!clienteId) {
      const newClientRes = await db.run(`
        INSERT INTO clientes (nombre, dni_cuit, telefono, email, direccion, localidad, provincia, estado, riesgo_baja)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'activo', 0)
      `, [
        cliente.nombre,
        cliente.dni_cuit ? cliente.dni_cuit.trim() : `TEMP-${Date.now()}`,
        cliente.telefono || null,
        cliente.email || null,
        cliente.direccion || null,
        cliente.localidad || null,
        cliente.provincia || 'Córdoba'
      ]);
      clienteId = newClientRes.id;
    }

    // 2. Obtener o crear Vehículo si viene info
    let vehiculoId = null;
    if (vehiculo && (vehiculo.patente || vehiculo.marca)) {
      if (vehiculo.patente) {
        const cleanPat = vehiculo.patente.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const existingVeh = await db.get('SELECT id FROM vehiculos WHERE patente = ?', [cleanPat]);
        if (existingVeh && existingVeh.id) {
          vehiculoId = existingVeh.id;
        } else {
          const newVehRes = await db.run(`
            INSERT INTO vehiculos (cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          vehiculoId = newVehRes.id;
        }
      }
    }

    // 3. Crear la Póliza
    const polRes = await db.run(`
      INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
      VALUES (?, 0, ?, ?, ?, 'vigente', ?, ?, ?, ?, ?, ?)
    `, [
      poliza.numero_poliza,
      poliza.fecha_inicio,
      poliza.fecha_vencimiento,
      poliza.cobertura || 'Cobertura Completa',
      parseFloat(poliza.monto_total || 0),
      parseFloat(poliza.valor_cuota || 0),
      poliza.forma_pago || 'debito_automatico',
      poliza.compania || 'El Norte Seguros',
      clienteId,
      vehiculoId
    ]);

    const polizaId = polRes.id;

    // 4. Calcular e insertar comisión dinámica
    const tasa = await getCommissionRate(poliza.compania, poliza.cobertura);
    const montoComision = parseFloat(poliza.valor_cuota || 0) * tasa;
    const periodo = (poliza.fecha_inicio || '').substring(0, 7) || new Date().toISOString().substring(0, 7);
    
    await db.run(`
      INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
      VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
    `, [polizaId, poliza.compania, parseFloat(poliza.monto_total || 0), tasa, montoComision, periodo]);

    // 5. Historial CRM
    await db.run(`
      INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
      VALUES (?, 'nota', ?)
    `, [clienteId, `Carga Inteligente: Se emitió póliza Nº ${poliza.numero_poliza} (${poliza.compania}) desde lectura automática de PDF.`]);

    res.status(201).json({
      success: true,
      poliza_id: polizaId,
      cliente_id: clienteId,
      vehiculo_id: vehiculoId,
      message: '¡Póliza, Cliente y Vehículo registrados exitosamente con Carga Inteligente!'
    });
  } catch (err) {
    console.error('[smartCreatePolicy Error]:', err.stack || err.message || err);
    res.status(500).json({ error: 'Error al registrar la póliza: ' + err.message });
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
