const db = require('../db');
const { getCommissionRate } = require('../services/commissionService');

async function getPolicies(req, res, next) {
  try {
    const policies = await db.all(`
      SELECT p.*, c.nombre as cliente_nombre, v.marca, v.modelo, v.patente, v.motor, v.chasis
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
    const cuotaVal = parseFloat(valor_cuota || monto_total || 0);
    const tasa = await getCommissionRate(compania, cobertura);
    const montoComision = cuotaVal * tasa;
    const periodo = fecha_inicio.substring(0, 7);
    await db.run(`
      INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [result.id, compania, parseFloat(monto_total || cuotaVal || 0), tasa, montoComision, 'pendiente', periodo]);

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
  const { numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, vehiculo_id, motor, chasis } = req.body;
  
  try {
    const valCuota = parseFloat(valor_cuota || 0);
    const montoTot = parseFloat(monto_total || 0) || valCuota;

    await db.run(`
      UPDATE polizas
      SET numero_poliza = ?, fecha_inicio = ?, fecha_vencimiento = ?, cobertura = ?, estado = ?, monto_total = ?, valor_cuota = ?, forma_pago = ?, compania = ?
      WHERE id = ?
    `, [numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, montoTot, valCuota, forma_pago, compania, req.params.id]);

    const pol = await db.get('SELECT vehiculo_id FROM polizas WHERE id = ?', [req.params.id]);
    const targetVehId = vehiculo_id || (pol ? pol.vehiculo_id : null);

    if (targetVehId && (motor !== undefined || chasis !== undefined)) {
      await db.run(`
        UPDATE vehiculos
        SET motor = COALESCE(?, motor), chasis = COALESCE(?, chasis)
        WHERE id = ?
      `, [motor ? String(motor).trim() : null, chasis ? String(chasis).trim() : null, targetVehId]);
    }

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
      VALUES (?, ?, ?, ?, ?, 'vigente', ?, ?, ?, ?, ?, ?)
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

function parseExcelDate(val) {
  if (!val) return new Date().toISOString().substring(0, 10);
  if (val instanceof Date) {
    return val.toISOString().substring(0, 10);
  }
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - (25567 + 2)) * 86400 * 1000));
    return date.toISOString().substring(0, 10);
  }
  const str = String(val).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(str)) {
    const parts = str.split('-');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  return str;
}

function parseExcelMoney(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).trim();
  if (!str) return 0;

  // Remover todo excepto dígitos, puntos, comas y signo menos
  str = str.replace(/[^0-9.,-]/g, '');
  if (!str || str === '-') return 0;

  // Si tiene puntos y comas: ej '125.450,50' o '125,450.50'
  if (str.includes('.') && str.includes(',')) {
    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');
    if (lastComma > lastDot) {
      // 125.450,50 -> punto es miles, coma es decimal
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // 125,450.50 -> coma es miles, punto es decimal
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Solo tiene coma: ej '125450,50' o '150,00' o '1,250'
    const parts = str.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Coma decimal (ej: 125,50 o 1500,0)
      str = str.replace(',', '.');
    } else if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      // Coma de miles (ej: 1,250 o 1,250,000)
      str = str.replace(/,/g, '');
    } else {
      str = str.replace(',', '.');
    }
  } else if (str.includes('.')) {
    // Solo tiene punto: ej '15.000' o '125.450' o '15.5'
    const parts = str.split('.');
    if (parts.length === 2 && parts[1].length === 3 && parseInt(parts[0]) > 0) {
      // Punto de miles argentino típico (ej: 15.000, 85.500)
      str = str.replace(/\./g, '');
    } else if (parts.length > 2) {
      // Múltiples puntos de miles (ej: 1.250.000)
      str = str.replace(/\./g, '');
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function findRowValue(row, patterns) {
  const keys = Object.keys(row);
  for (const pattern of patterns) {
    const key = keys.find(k => {
      const trimmed = k.trim();
      const withSpaces = trimmed.replace(/_/g, ' ');
      const withUnderscores = trimmed.replace(/\s+/g, '_');
      const collapsed = trimmed.replace(/[\s_.]+/g, '');
      return pattern.test(trimmed) || pattern.test(withSpaces) || pattern.test(withUnderscores) || pattern.test(collapsed);
    });
    if (key && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return undefined;
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

  const XLSX = require('xlsx');

  try {
    const workbook = XLSX.read(archivo.data, { type: 'buffer' });
    if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
      const error = new Error('El archivo Excel no contiene hojas válidas.');
      error.status = 400;
      return next(error);
    }

    let allRows = [];
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      let sheetData = XLSX.utils.sheet_to_json(worksheet);

      // Auto-detectar la fila de encabezados si hay filas de título arriba
      if (sheetData.length === 0 || !sheetData.some(row => findRowValue(row, [/p[oó]liza/i, /tomador/i, /asegurado/i, /cliente/i, /patente/i, /dominio/i, /seccion/i, /ramo/i]))) {
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const headerIndex = rawRows.findIndex(r => Array.isArray(r) && r.length >= 2 && r.some(cell => typeof cell === 'string' && /^(Póliza|Nº Póliza|Poliza|Nro Póliza|Nro_Poliza|Tomador|Cliente|Rama|Ramo|Seccion|Sección|Asegurado|Patente|Dominio)$/i.test(cell.trim())));
        if (headerIndex !== -1) {
          const headers = rawRows[headerIndex];
          sheetData = rawRows.slice(headerIndex + 1).filter(r => r && r.length > 1).map(r => {
            const obj = {};
            headers.forEach((h, i) => {
              if (h && r[i] !== undefined) obj[String(h).trim()] = r[i];
            });
            return obj;
          });
        }
      }

      if (sheetData && sheetData.length > 0) {
        allRows.push(...sheetData);
      }
    }

    if (!allRows || !allRows.length) {
      const error = new Error('El archivo Excel está vacío o no tiene un formato reconocido.');
      error.status = 400;
      return next(error);
    }

    let insertadas = 0;
    let actualizadas = 0;
    let omitidas = 0;

    const seccionMap = {
      '1': 'Automotores',
      '01': 'Automotores',
      '2': 'Motovehículos',
      '02': 'Motovehículos',
      '3': 'Incendio',
      '03': 'Incendio',
      '4': 'Cristales',
      '04': 'Cristales',
      '5': 'Transporte',
      '05': 'Transporte',
      '6': 'Responsabilidad Civil',
      '06': 'Responsabilidad Civil',
      '8': 'Combinado Familiar',
      '08': 'Combinado Familiar',
      '9': 'Integral de Comercio',
      '09': 'Integral de Comercio',
      '10': 'Accidentes Personales',
      '11': 'Vida Colectivo',
      '14': 'Seguro Técnico',
      '18': 'Vida Individual',
      '19': 'Sepelio',
      '21': 'Caución'
    };

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

      const fecha_inicio = parseExcelDate(fecha_inicio_raw);
      let fecha_vencimiento = parseExcelDate(fecha_vencimiento_raw);

      if (!fecha_vencimiento_raw) {
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
