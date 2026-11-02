const db = require('../db');
const { getCommissionRate } = require('../services/commissionService');
const { parseExcelBuffer, findRowValue, cleanMoney, parseExcelMoney, parseExcelDate, SECCION_MAP } = require('../services/importerService');
const { ensurePolicyInstallments } = require('./paymentController');

async function getPolicies(req, res, next) {
  const { page, limit, search, estado, compania, vencimiento } = req.query;
  try {
    let sql = `
      SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono, v.marca, v.modelo, v.patente, v.motor, v.chasis
      FROM polizas p
      JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN vehiculos v ON p.vehiculo_id = v.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (p.numero_poliza ILIKE ? OR c.nombre ILIKE ? OR v.patente ILIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (estado) {
      sql += ` AND p.estado = ?`;
      params.push(estado);
    }
    if (compania) {
      sql += ` AND p.compania = ?`;
      params.push(compania);
    }
    if (vencimiento) {
      if (vencimiento === 'vencidas') {
        sql += ` AND (p.fecha_vencimiento < CURRENT_DATE OR p.estado = 'vencida')`;
      } else if (vencimiento === '7d') {
        sql += ` AND p.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`;
      } else if (vencimiento === '30d') {
        sql += ` AND p.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`;
      } else if (vencimiento === '60d') {
        sql += ` AND p.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 60`;
      } else if (vencimiento === 'vigentes') {
        sql += ` AND p.fecha_vencimiento > CURRENT_DATE + 60 AND p.estado = 'vigente'`;
      }
    }

    sql += ` ORDER BY p.fecha_vencimiento ASC`;

    if (limit) {
      const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 15));
      const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
      const offset = (parsedPage - 1) * parsedLimit;

      const countSql = `SELECT COUNT(*) as count FROM (` + sql + `) as count_q`;
      const countRes = await db.get(countSql, params);
      const total = parseInt(countRes?.count || 0);

      sql += ` LIMIT ? OFFSET ?`;
      params.push(parsedLimit, offset);

      const policies = await db.all(sql, params);
      return res.json({
        data: policies,
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit) || 1
      });
    }

    const policies = await db.all(sql, params);
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
    const cuotaVal = parseFloat(valor_cuota || monto_total || 0);
    const periodo = fecha_inicio.substring(0, 7);

    // Ejecutar creación de póliza, comisión y registro histórico dentro de una transacción ACID atómica
    const result = await db.withTransaction(async (trx) => {
      const tasa = await getCommissionRate(compania, cobertura, trx);
      const montoComision = cuotaVal * tasa;
      const polRes = await trx.run(`
        INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [numero_poliza, numRen, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id]);

      await trx.run(`
        INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [polRes.id, compania, parseFloat(monto_total || cuotaVal || 0), tasa, montoComision, 'pendiente', periodo]);

      await trx.run(`
        INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
        VALUES (?, 'nota', ?)
      `, [cliente_id, `Se emitió la póliza Nº ${numero_poliza} (${compania}) para el vehículo.`]);

      await ensurePolicyInstallments(polRes.id, trx);

      return polRes;
    }, { userId: req.user?.id, requestId: req.id });

    res.status(201).json({ id: result.id, message: 'Póliza emitida con éxito' });
  } catch (err) {
    next(err);
  }
}

async function updatePolicy(req, res, next) {
  const { numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, vehiculo_id, motor, chasis } = req.body;
  
  try {
    const valCuota = parseFloat(valor_cuota || 0);
    const montoTot = parseFloat(monto_total || 0) || valCuota;

    await db.withTransaction(async (trx) => {
      await trx.run(`
        UPDATE polizas
        SET numero_poliza = ?, fecha_inicio = ?, fecha_vencimiento = ?, cobertura = ?, estado = ?, monto_total = ?, valor_cuota = ?, forma_pago = ?, compania = ?
        WHERE id = ?
      `, [numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, montoTot, valCuota, forma_pago, compania, req.params.id]);

      const pol = await trx.get('SELECT vehiculo_id FROM polizas WHERE id = ?', [req.params.id]);
      const targetVehId = vehiculo_id || (pol ? pol.vehiculo_id : null);

      if (targetVehId && (motor !== undefined || chasis !== undefined)) {
        await trx.run(`
          UPDATE vehiculos
          SET motor = COALESCE(?, motor), chasis = COALESCE(?, chasis)
          WHERE id = ?
        `, [motor ? String(motor).trim() : null, chasis ? String(chasis).trim() : null, targetVehId]);
      }
    }, { userId: req.user?.id, requestId: req.id });

    res.json({ message: 'Póliza actualizada con éxito' });
  } catch (err) {
    next(err);
  }
}

async function renewPolicy(req, res, next) {
  const policyId = parseInt(req.params.id, 10);
  if (!policyId || policyId <= 0) {
    return res.status(400).json({ error: 'ID de póliza inválido. Debe ser un entero positivo.' });
  }

  const { tipo, numero_poliza, monto_total, valor_cuota } = req.body;
  const tipoRenovacion = (tipo || 'cuatrimestral').toLowerCase().trim();

  if (!['cuatrimestral', 'anual'].includes(tipoRenovacion)) {
    return res.status(400).json({ error: 'Tipo de renovación inválido. Debe ser cuatrimestral o anual.' });
  }

  try {
    const result = await db.withTransaction(async (trx) => {
      // 1. Bloqueo de fila para evitar que dos peticiones simultáneas renueven la misma póliza
      const oldPolicy = await trx.get('SELECT * FROM polizas WHERE id = ? FOR UPDATE', [policyId]);
      if (!oldPolicy) {
        const error = new Error('Póliza no encontrada.');
        error.status = 404;
        throw error;
      }

      // 2. Verificar que no exista ya una renovación para esta póliza
      const existingRenewal = await trx.get(
        'SELECT id FROM polizas WHERE numero_poliza = ? AND numero_renovacion > ? LIMIT 1',
        [oldPolicy.numero_poliza, oldPolicy.numero_renovacion]
      );
      if (existingRenewal) {
        const error = new Error('Esta póliza ya cuenta con una renovación registrada.');
        error.status = 409;
        throw error;
      }

      const format = (d) => d.toISOString().split('T')[0];
      const nuevaFechaInicio = new Date(oldPolicy.fecha_vencimiento);
      const nuevaFechaVencimiento = new Date(oldPolicy.fecha_vencimiento);

      let nuevoNumero = oldPolicy.numero_poliza;
      let nuevoNumRen = oldPolicy.numero_renovacion || 0;

      if (tipoRenovacion === 'cuatrimestral') {
        nuevaFechaVencimiento.setMonth(nuevaFechaVencimiento.getMonth() + 4);
        nuevoNumRen += 1;
      } else {
        nuevaFechaVencimiento.setFullYear(nuevaFechaVencimiento.getFullYear() + 1);
        nuevoNumero = numero_poliza ? String(numero_poliza).trim() : `${oldPolicy.numero_poliza}-REN`;
        nuevoNumRen = 0;

        // Comprobar si el nuevo número ya está en uso
        const duplicate = await trx.get('SELECT id FROM polizas WHERE numero_poliza = ? AND numero_renovacion = 0', [nuevoNumero]);
        if (duplicate) {
          const error = new Error(`Ya existe una póliza registrada con el número ${nuevoNumero}.`);
          error.status = 409;
          throw error;
        }
      }

      const factorInflacion = tipoRenovacion === 'cuatrimestral' ? 1.15 : 1.30;
      const parsedMonto = monto_total !== undefined && monto_total !== null && monto_total !== '' ? parseFloat(monto_total) : NaN;
      const parsedCuota = valor_cuota !== undefined && valor_cuota !== null && valor_cuota !== '' ? parseFloat(valor_cuota) : NaN;

      const nuevoMontoTotal = (!isNaN(parsedMonto) && parsedMonto > 0)
        ? Number(parsedMonto.toFixed(2))
        : Number((oldPolicy.monto_total * factorInflacion).toFixed(2));
      const nuevoValorCuota = (!isNaN(parsedCuota) && parsedCuota > 0)
        ? Number(parsedCuota.toFixed(2))
        : Number((oldPolicy.valor_cuota * factorInflacion).toFixed(2));

      const fechaInicioIso = nuevaFechaInicio.toISOString().substring(0, 10);
      const fechaVencimientoIso = nuevaFechaVencimiento.toISOString().substring(0, 10);
      const periodo = fechaInicioIso.substring(0, 7);

      const descripcionLog = tipoRenovacion === 'cuatrimestral'
        ? `Renovación cuatrimestral de póliza Nº ${oldPolicy.numero_poliza} (Ren. ${nuevoNumRen}).`
        : `Renovación anual de póliza Nº ${oldPolicy.numero_poliza}. Nueva póliza emitida: ${nuevoNumero}`;

      const newPolRes = await trx.run(`
        INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
        VALUES (?, ?, ?, ?, ?, 'vigente', ?, ?, ?, ?, ?, ?)
      `, [
        nuevoNumero,
        nuevoNumRen,
        fechaInicioIso,
        fechaVencimientoIso,
        oldPolicy.cobertura,
        nuevoMontoTotal,
        nuevoValorCuota,
        oldPolicy.forma_pago,
        oldPolicy.compania,
        oldPolicy.cliente_id,
        oldPolicy.vehiculo_id
      ]);

      await trx.run("UPDATE polizas SET estado = 'vencida' WHERE id = ?", [oldPolicy.id]);

      const tasa = await getCommissionRate(oldPolicy.compania, oldPolicy.cobertura, trx);
      const montoComision = Number((nuevoValorCuota * tasa).toFixed(2));

      await trx.run(`
        INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
        VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
      `, [newPolRes.id, oldPolicy.compania, nuevoMontoTotal, tasa, montoComision, periodo]);

      await trx.run(`
        INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion)
        VALUES (?, 'nota', ?)
      `, [oldPolicy.cliente_id, descripcionLog]);

      await ensurePolicyInstallments(newPolRes.id, trx);

      return newPolRes;
    }, { userId: req.user?.id, requestId: req.id });

    res.json({ id: result.id, message: 'Póliza renovada con éxito' });
  } catch (err) {
    next(err);
  }
}

async function deletePolicy(req, res, next) {
  try {
    const result = await db.run("UPDATE polizas SET estado = 'suspendida' WHERE id = ? AND estado <> 'suspendida'", [req.params.id]);
    if (!result.changes) {
      const error = new Error('Póliza no encontrada o ya suspendida');
      error.status = 404;
      return next(error);
    }
    res.json({ message: 'Póliza archivada con éxito; se conservó su historial contable.' });
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
        VALUES (?, ?, ?, ?, ?, ?, ?, 'activo', false)
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

    await ensurePolicyInstallments(polizaId);

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

// Importar pólizas desde Excel
async function importPolicies(req, res, next) {
  if (!req.files || Object.keys(req.files).length === 0) {
    const error = new Error('No se subió ningún archivo Excel.');
    error.status = 400;
    return next(error);
  }

  const archivo = req.files.archivo;
  if (!archivo) {
    const error = new Error('No se encontró el archivo subido.');
    error.status = 400;
    return next(error);
  }

  try {
    const allRows = parseExcelBuffer(archivo.data);

    let insertadas = 0;
    let actualizadas = 0;
    let omitidas = 0;

    const seccionMap = SECCION_MAP;

    for (const row of allRows) {
      const numero_poliza = findRowValue(row, [
        /^N[º°o\._]?\s*P[óo]liza$/i,
        /^P[óo]liza$/i,
        /^Nro_?Poliza$/i,
        /^Certificado$/i,
        /^Nro_?Certificado$/i,
        /^Propuesta$/i,
        /^Nro_?Propuesta$/i,
        /p[oó]liza/i
      ]);

      let cliente_nombre = findRowValue(row, [
        /^Asegurado$/i,
        /^Tomador$/i,
        /^Nombre_?Asegurado$/i,
        /^Cliente$/i,
        /^Nombre(\s+y\s+Apellido)?$/i,
        /^Nombre_?Completo$/i,
        /^Razon_?Social$/i,
        /^Razón_?Social$/i,
        /asegurado/i,
        /tomador/i,
        /cliente/i
      ]);

      if (!numero_poliza || !cliente_nombre) {
        omitidas++;
        continue;
      }

      const numPolStr = String(numero_poliza).trim();
      let nombreStr = String(cliente_nombre).trim();
      // Si el tomador viene en formato "1116571 - BERGIA, JORGE FABIAN" o "BERGIA, JORGE FABIAN"
      if (nombreStr.includes(' - ')) {
        const parts = nombreStr.split(' - ');
        let rawName = parts.slice(1).join(' - ').trim();
        if (rawName.includes(',')) {
          const nameParts = rawName.split(',');
          rawName = `${nameParts[1].trim()} ${nameParts[0].trim()}`;
        }
        nombreStr = rawName || nombreStr;
      } else if (nombreStr.includes(',')) {
        const nameParts = nombreStr.split(',');
        nombreStr = `${nameParts[1].trim()} ${nameParts[0].trim()}`;
      }

      // Buscar columna explícita de DNI / CUIT / Documento
      const dniCol = findRowValue(row, [
        /^Nro[\s_\.]*Doc(umento)?$/i,
        /^N[º°o\.]?[\s_\.]*Doc(umento)?$/i,
        /^N[úu]m(ero)?[\s_\.]*Doc(umento)?$/i,
        /^Doc(umento)?[\s_\.]*Nro$/i,
        /^Documento$/i,
        /^Doc$/i,
        /^DNI$/i,
        /^D\.N\.I\.?$/i,
        /^CUIT$/i,
        /^C\.U\.I\.T\.?$/i,
        /^CUIL$/i,
        /^C\.U\.I\.L\.?$/i,
        /^DNI[\/\s_\.-]*CUIT$/i,
        /^CUIT[\/\s_\.-]*DNI$/i,
        /^CUIT[\/\s_\.-]*CUIL$/i,
        /^CUIL[\/\s_\.-]*CUIT$/i,
        /^Identificaci[óo]n$/i,
        /^Nro[\s_\.]*Identificaci[óo]n$/i,
        /^Tomador[\s_\.]*Doc$/i,
        /^Asegurado[\s_\.]*Doc$/i,
        /cuit/i,
        /cuil/i,
        /dni/i,
        /documento/i,
        /doc/i
      ]);

      if (dniCol) {
        dniStr = String(dniCol).trim().replace(/[^0-9-]/g, '');
      }

      const companiaRaw = findRowValue(row, [
        /^Compa[ñn][íi]a$/i,
        /^Aseguradora$/i,
        /^Entidad$/i,
        /compa[ñn][íi]a/i,
        /aseguradora/i
      ]);
      let compania = 'El Norte Seguros';
      if (companiaRaw) {
        const cStr = String(companiaRaw).trim();
        if (/norte/i.test(cStr)) compania = 'El Norte Seguros';
        else if (/sancor/i.test(cStr)) compania = 'Sancor Seguros';
        else if (/federaci[oó]n|patronal/i.test(cStr)) compania = 'Federación Patronal';
        else if (/segunda/i.test(cStr)) compania = 'La Segunda';
        else if (/zurich/i.test(cStr)) compania = 'Zurich';
        else if (/rivadavia/i.test(cStr)) compania = 'Rivadavia';
        else if (/crist[oó]bal/i.test(cStr)) compania = 'San Cristóbal';
        else if (/allianz/i.test(cStr)) compania = 'Allianz';
        else if (/mercantil/i.test(cStr)) compania = 'Mercantil Andina';
        else if (/mapfre/i.test(cStr)) compania = 'Mapfre';
        else if (/berkley/i.test(cStr)) compania = 'Berkley';
        else compania = cStr;
      }

      const coberturaRaw = findRowValue(row, [
        /^Cobertura$/i,
        /^Detalle_?Cobertura$/i,
        /^Plan$/i,
        /^Seccion$/i,
        /^Sección$/i,
        /^Ramo$/i,
        /^Rama$/i,
        /^Tipo\s*(de\s*)?Cobertura$/i,
        /cobertura/i,
        /seccion/i,
        /ramo/i
      ]);
      let cobertura = String(coberturaRaw || 'Cobertura Completa').trim();
      if (seccionMap[cobertura]) {
        cobertura = seccionMap[cobertura];
      } else if (cobertura.toLowerCase() === 'automotores') {
        cobertura = 'Automotores';
      }

      const fecha_inicio_raw = findRowValue(row, [
        /^Vig_?Desde$/i,
        /^Vigencia_?Desde$/i,
        /^Fec_?Desde$/i,
        /^Fecha_?Desde$/i,
        /^Fecha\s*Inicio$/i,
        /^Inicio\s*(Vigencia(\s*P[óo]liza)?)?$/i,
        /^Desde$/i,
        /^Fec_?Emisi[óo]n$/i,
        /^Fecha\s*Emisi[óo]n$/i,
        /inicio/i,
        /desde/i
      ]);

      const fecha_vencimiento_raw = findRowValue(row, [
        /^Vig_?Hasta$/i,
        /^Vigencia_?Hasta$/i,
        /^Fec_?Hasta$/i,
        /^Fecha_?Hasta$/i,
        /^Fecha\s*Vencimiento$/i,
        /^Fin\s*(Vigencia(\s*P[óo]liza)?)?$/i,
        /^Hasta$/i,
        /^Vencimiento$/i,
        /vencimiento/i,
        /hasta/i,
        /fin/i
      ]);

      const fecha_inicio = parseExcelDate(fecha_inicio_raw, true);
      let fecha_vencimiento = parseExcelDate(fecha_vencimiento_raw);

      if (!fecha_vencimiento) {
        const d = new Date(fecha_inicio);
        d.setFullYear(d.getFullYear() + 1);
        fecha_vencimiento = d.toISOString().substring(0, 10);
      }

      // Extracción de montos (Premio Total, Prima, Cuota, etc.)
      const montoTotalRaw = findRowValue(row, [
        /^Premio_?Total$/i,
        /^Premio_?Pesos$/i,
        /^Premio_?Emitido$/i,
        /^Premio_?Final$/i,
        /^Premio(\s*\$)?$/i,
        /^Prima_?Total$/i,
        /^Prima_?Pura$/i,
        /^Prima_?Emitida$/i,
        /^Prima$/i,
        /^Monto_?Total$/i,
        /^Monto$/i,
        /^Importe_?Total$/i,
        /^Importe$/i,
        /^Total(\s*\$)?$/i,
        /premio/i,
        /monto/i
      ]);

      const valorCuotaRaw = findRowValue(row, [
        /^Imp_?Cuota$/i,
        /^Importe_?Cuota$/i,
        /^Valor_?Cuota$/i,
        /^Cuota_?Actual$/i,
        /^Cuota_?1$/i,
        /^Cuota(\s*Mensual|\s*Total|\s*Actual|\s*\$)?$/i,
        /^Valor\s*(de\s*)?Cuota$/i,
        /^Imp\.?\s*Cuota$/i,
        /cuota/i
      ]);

      const cantCuotasRaw = findRowValue(row, [
        /^Cant_?Cuotas$/i,
        /^Cantidad_?Cuotas$/i,
        /^Cant_?Cuota$/i,
        /^Cuotas$/i,
        /^Plan_?Pago$/i,
        /^Plan_?Cuotas$/i
      ]);
      const cantCuotas = cantCuotasRaw ? parseInt(String(cantCuotasRaw).replace(/[^0-9]/g, '')) || 0 : 0;

      let monto_total = parseExcelMoney(montoTotalRaw);
      let valor_cuota = parseExcelMoney(valorCuotaRaw);

      if (valor_cuota === 0 && monto_total > 0) {
        if (cantCuotas > 1) {
          valor_cuota = Math.round((monto_total / cantCuotas) * 100) / 100;
        } else {
          valor_cuota = monto_total;
        }
      }
      if (monto_total === 0 && valor_cuota > 0) {
        monto_total = valor_cuota * (cantCuotas > 0 ? cantCuotas : 1);
      }

      let forma_pago = String(findRowValue(row, [/^Forma_?Pago$/i, /^Medio_?Pago$/i, /^Tipo_?Cobranza$/i, /^Cobranza$/i, /^CBU$/i, /^Tarjeta$/i, /^Tipo_?Pago$/i]) || 'debito_automatico').trim();
      if (forma_pago.toLowerCase().includes('débito') || forma_pago.toLowerCase().includes('debito') || forma_pago.toLowerCase().includes('cbu') || forma_pago.toLowerCase().includes('ahorro')) {
        forma_pago = 'debito_automatico';
      } else if (forma_pago.toLowerCase().includes('cupon') || forma_pago.toLowerCase().includes('efectivo') || forma_pago.toLowerCase().includes('rapipago') || forma_pago.toLowerCase().includes('pagofacil')) {
        forma_pago = 'efectivo';
      } else if (forma_pago.toLowerCase().includes('credito') || forma_pago.toLowerCase().includes('crédito') || forma_pago.toLowerCase().includes('tarjeta') || forma_pago.toLowerCase().includes('visa') || forma_pago.toLowerCase().includes('master')) {
        forma_pago = 'tarjeta_credito';
      } else if (forma_pago.toLowerCase().includes('transfer')) {
        forma_pago = 'transferencia';
      }

      const estadoRaw = findRowValue(row, [/^Estado_?Poliza$/i, /^Estado$/i, /^Situacion$/i, /^Situación$/i]);
      let estadoPoliza = 'vigente';
      if (estadoRaw && /vencid|anulad|baja|cancelad/i.test(String(estadoRaw))) {
        estadoPoliza = /anulad|baja/i.test(String(estadoRaw)) ? 'anulada' : 'vencida';
      }

      const telefono = findRowValue(row, [/^Tel[ée]fonos?$/i, /^Celular$/i, /^M[óo]vil$/i, /^Tel$/i, /^Contacto$/i]);
      const email = findRowValue(row, [/^Mail$/i, /^E-?mail$/i, /^Correo(\s*Electr[óo]nico)?$/i]);
      const direccion = findRowValue(row, [/^Direcci[óo]n$/i, /^Domicilio$/i, /^Calle$/i]);
      const localidad = findRowValue(row, [/^Localidad$/i, /^Ciudad$/i, /^Pueblo$/i]);
      const provincia = findRowValue(row, [/^Provincia$/i]) || 'Córdoba';

      let motor = findRowValue(row, [/^Nro_?Motor$/i, /^N[º°o\.]?\s*Motor$/i, /^Motor$/i]);
      let chasis = findRowValue(row, [/^Nro_?Chasis$/i, /^N[º°o\.]?\s*Chasis$/i, /^Chasis$/i]);

      // 1. Buscar o crear cliente
      let clienteId = null;
      if (dniStr) {
        const existingClient = await db.get('SELECT id FROM clientes WHERE dni_cuit = ?', [dniStr]);
        if (existingClient) {
          clienteId = existingClient.id;
          // Actualizar datos de contacto si vinieron en el Excel
          await db.run(`
            UPDATE clientes SET
              telefono = COALESCE(?, telefono),
              email = COALESCE(?, email),
              direccion = COALESCE(?, direccion),
              localidad = COALESCE(?, localidad),
              provincia = COALESCE(?, provincia)
            WHERE id = ?
          `, [
            telefono ? String(telefono).trim() : null,
            email ? String(email).trim() : null,
            direccion ? String(direccion).trim() : null,
            localidad ? String(localidad).trim() : null,
            provincia ? String(provincia).trim() : null,
            clienteId
          ]);
        }
      }

      if (!clienteId) {
        const existingByName = await db.get('SELECT id FROM clientes WHERE LOWER(nombre) = LOWER(?)', [nombreStr]);
        if (existingByName) {
          clienteId = existingByName.id;
          if (dniStr && !existingByName.dni_cuit.startsWith('TEMP-')) {
            await db.run('UPDATE clientes SET dni_cuit = COALESCE(?, dni_cuit) WHERE id = ?', [dniStr, clienteId]);
          }
        }
      }

      if (!clienteId) {
        const newClientRes = await db.run(`
          INSERT INTO clientes (nombre, dni_cuit, telefono, email, direccion, localidad, provincia, estado, riesgo_baja)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'activo', false)
        `, [
          nombreStr,
          dniStr || `CLI-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          telefono ? String(telefono).trim() : null,
          email ? String(email).trim() : null,
          direccion ? String(direccion).trim() : null,
          localidad ? String(localidad).trim() : null,
          provincia ? String(provincia).trim() : 'Córdoba'
        ]);
        clienteId = newClientRes.id;
      }

      // 2. Vehículo opcional
      let vehiculoId = null;
      let patente = findRowValue(row, [/^Dominio$/i, /^Nro_?Dominio$/i, /^Patente$/i]);
      let marca = findRowValue(row, [/^Marca$/i]);
      let modelo = findRowValue(row, [/^Modelo$/i, /^Modelo\/Versi[óo]n$/i, /^Descripcion_?Vehiculo$/i, /^Descripción_?Vehículo$/i, /^Vehiculo$/i, /^Vehículo$/i]);
      let anio = findRowValue(row, [/^A[ñn]o$/i, /^Modelo_?A[ñn]o$/i, /^Anio$/i, /^Ano$/i]);

      const bienAsegurado = findRowValue(row, [/^Bien\s*Asegurado$/i, /^Veh[íi]culo$/i, /^Unidad$/i]);
      if (bienAsegurado && typeof bienAsegurado === 'string') {
        if (bienAsegurado.includes('|')) {
          const bParts = bienAsegurado.split('|');
          const vehDesc = bParts[0].trim();
          patente = bParts[1].trim();
          const vehWords = vehDesc.split(' ');
          marca = vehWords[0];
          modelo = vehWords.slice(1).join(' ');
        } else if (!patente) {
          modelo = bienAsegurado;
          marca = 'General';
        }

        const mMot = bienAsegurado.match(/\b(?:Motor|Nro\.?\s*Motor|MOT)\s*[:#]?\s*([A-Z0-9-]+)/i);
        if (mMot && !motor) motor = mMot[1];
        const mCha = bienAsegurado.match(/\b(?:Chasis|Nro\.?\s*Chasis|VIN)\s*[:#]?\s*([A-Z0-9]{8,20})/i);
        if (mCha && !chasis) chasis = mCha[1];
      }

      if (patente || marca || modelo) {
        const cleanPat = patente ? String(patente).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
        if (cleanPat) {
          const existingVeh = await db.get('SELECT id FROM vehiculos WHERE patente = ?', [cleanPat]);
          if (existingVeh) {
            vehiculoId = existingVeh.id;
            await db.run(`
              UPDATE vehiculos SET
                marca = COALESCE(?, marca),
                modelo = COALESCE(?, modelo),
                motor = COALESCE(?, motor),
                chasis = COALESCE(?, chasis),
                anio = COALESCE(?, anio)
              WHERE id = ?
            `, [
              marca ? String(marca).trim() : null,
              modelo ? String(modelo).trim() : null,
              motor ? String(motor).trim() : null,
              chasis ? String(chasis).trim() : null,
              anio ? parseInt(anio) : null,
              vehiculoId
            ]);
          }
        }
        if (!vehiculoId) {
          const newVehRes = await db.run(`
            INSERT INTO vehiculos (cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'particular')
          `, [
            clienteId,
            marca ? String(marca).trim() : 'Marca General',
            modelo ? String(modelo).trim() : 'Modelo General',
            null,
            anio ? parseInt(anio) : 2020,
            cleanPat || null,
            chasis ? String(chasis).trim() : null,
            motor ? String(motor).trim() : null
          ]);
          vehiculoId = newVehRes.id;
        }
      }

      // 3. Crear o actualizar póliza
      const existingPol = await db.get('SELECT id FROM polizas WHERE numero_poliza = ?', [numPolStr]);

      if (existingPol) {
        await db.run(`
          UPDATE polizas SET
            fecha_inicio = ?,
            fecha_vencimiento = ?,
            cobertura = ?,
            estado = ?,
            monto_total = ?,
            valor_cuota = ?,
            forma_pago = ?,
            compania = ?,
            cliente_id = ?,
            vehiculo_id = COALESCE(?, vehiculo_id)
          WHERE id = ?
        `, [
          fecha_inicio,
          fecha_vencimiento,
          cobertura,
          estadoPoliza,
          monto_total,
          valor_cuota,
          forma_pago,
          compania,
          clienteId,
          vehiculoId,
          existingPol.id
        ]);
        actualizadas++;

        const tasa = await getCommissionRate(compania, cobertura);
        const baseMonto = valor_cuota > 0 ? valor_cuota : monto_total;
        const montoComision = Math.round((baseMonto * tasa) * 100) / 100;
        const periodo = fecha_inicio.substring(0, 7);

        const existingCom = await db.get('SELECT id FROM comisiones WHERE poliza_id = ?', [existingPol.id]);
        if (existingCom) {
          await db.run(`
            UPDATE comisiones SET
              compania = ?, monto_poliza = ?, tasa_comision = ?, monto_comision = ?, periodo = ?
            WHERE id = ?
          `, [compania, monto_total || valor_cuota, tasa, montoComision, periodo, existingCom.id]);
        } else {
          await db.run(`
            INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
            VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
          `, [existingPol.id, compania, monto_total || valor_cuota, tasa, montoComision, periodo]);
        }
      } else {
        const polRes = await db.run(`
          INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
          VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          numPolStr,
          fecha_inicio,
          fecha_vencimiento,
          cobertura,
          estadoPoliza,
          monto_total,
          valor_cuota,
          forma_pago,
          compania,
          clienteId,
          vehiculoId
        ]);
        insertadas++;

        const tasa = await getCommissionRate(compania, cobertura);
        const baseMonto = valor_cuota > 0 ? valor_cuota : monto_total;
        const montoComision = Math.round((baseMonto * tasa) * 100) / 100;
        const periodo = fecha_inicio.substring(0, 7);

        await db.run(`
          INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
          VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
        `, [polRes.id, compania, monto_total || valor_cuota, tasa, montoComision, periodo]);

        await ensurePolicyInstallments(polRes.id);
      }
    }

    res.json({
      message: 'Proceso de importación de pólizas finalizado con éxito.',
      insertadas,
      actualizadas,
      omitidas
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPolicies,
  createPolicy,
  updatePolicy,
  renewPolicy,
  deletePolicy,
  parsePolicyPdf,
  smartCreatePolicy,
  importPolicies
};
