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
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  return str;
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

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    let jsonData = XLSX.utils.sheet_to_json(worksheet);

    // Auto-detectar la fila de encabezados si hay filas de título arriba
    if (jsonData.length === 0 || !jsonData.some(row => row['Póliza'] || row['Nº Póliza'] || row['numero_poliza'] || row['Tomador'] || row['Cliente'])) {
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const headerIndex = rawRows.findIndex(r => Array.isArray(r) && r.length >= 3 && r.some(cell => typeof cell === 'string' && /^(Póliza|Nº Póliza|Poliza|Nro Póliza|Tomador|Cliente|Rama)$/i.test(cell.trim())));
      if (headerIndex !== -1) {
        const headers = rawRows[headerIndex];
        jsonData = rawRows.slice(headerIndex + 1).filter(r => r && r.length > 1).map(r => {
          const obj = {};
          headers.forEach((h, i) => {
            if (h && r[i] !== undefined) obj[h] = r[i];
          });
          return obj;
        });
      }
    }

    if (!jsonData || !jsonData.length) {
      const error = new Error('El archivo Excel está vacío o no tiene un formato válido.');
      error.status = 400;
      return next(error);
    }

    let insertadas = 0;
    let actualizadas = 0;
    let omitidas = 0;

    for (const row of jsonData) {
      const numero_poliza = row['Nº Póliza'] || row['Póliza'] || row['Poliza'] || row['Nro Póliza'] || row['Nro Poliza'] || row['Número de Póliza'] || row['numero_poliza'] || row['PÓLIZA'];
      let cliente_nombre = row['Cliente'] || row['Nombre'] || row['Tomador'] || row['Asegurado'] || row['cliente'] || row['Nombre y Apellido'];

      if (!numero_poliza || !cliente_nombre) {
        omitidas++;
        continue;
      }

      const numPolStr = String(numero_poliza).trim();
      let nombreStr = String(cliente_nombre).trim();
      let dniStr = null;

      // Si el tomador viene en formato "1116571 - BERGIA, JORGE FABIAN"
      if (nombreStr.includes(' - ')) {
        const parts = nombreStr.split(' - ');
        dniStr = parts[0].trim();
        let rawName = parts.slice(1).join(' - ').trim();
        if (rawName.includes(',')) {
          const nameParts = rawName.split(',');
          rawName = `${nameParts[1].trim()} ${nameParts[0].trim()}`;
        }
        nombreStr = rawName;
      }

      if (!dniStr) {
        let dni_cuit = row['DNI/CUIT'] || row['DNI'] || row['CUIT'] || row['Documento'] || row['dni_cuit'] || row['dni'] || row['cuit'] || null;
        dniStr = dni_cuit ? String(dni_cuit).trim() : null;
      }

      const compania = String(row['Compañía'] || row['Compañia'] || row['Aseguradora'] || row['compania'] || row['COMPAÑÍA'] || 'Sancor Seguros').trim();
      const cobertura = String(row['Cobertura'] || row['Plan'] || row['Ramo'] || row['cobertura'] || 'Cobertura Completa').trim();
      
      const fecha_inicio_raw = row['Fecha Inicio'] || row['Inicio vigencia póliza'] || row['Vigencia Desde'] || row['Desde'] || row['fecha_inicio'] || null;
      const fecha_vencimiento_raw = row['Fecha Vencimiento'] || row['Fin vigencia póliza'] || row['Vigencia Hasta'] || row['Hasta'] || row['Vencimiento'] || row['fecha_vencimiento'] || null;
      
      const fecha_inicio = parseExcelDate(fecha_inicio_raw);
      let fecha_vencimiento = parseExcelDate(fecha_vencimiento_raw);
      
      if (!fecha_vencimiento_raw) {
        const d = new Date(fecha_inicio);
        d.setFullYear(d.getFullYear() + 1);
        fecha_vencimiento = d.toISOString().substring(0, 10);
      }

      let monto_total = parseFloat(String(row['Monto Total'] || row['Premio Total'] || row['Premio'] || row['Monto'] || row['monto_total'] || row['Importe Total'] || row['Importe'] || 0).replace(/[^0-9\.]/g, '')) || 0;
      let valor_cuota = parseFloat(String(row['Valor Cuota'] || row['Cuota'] || row['Importe Cuota'] || row['valor_cuota'] || row['Cuota Mensual'] || row['Valor de Cuota'] || 0).replace(/[^0-9\.]/g, '')) || 0;

      if (valor_cuota === 0 && monto_total > 0) {
        valor_cuota = monto_total;
      }
      if (monto_total === 0 && valor_cuota > 0) {
        monto_total = valor_cuota;
      }

      let forma_pago = String(row['Medio de Pago'] || row['Forma de Pago'] || row['Pago'] || row['forma_pago'] || 'debito_automatico').trim();
      if (forma_pago.toLowerCase().includes('débito') || forma_pago.toLowerCase().includes('debito')) {
        forma_pago = 'debito_automatico';
      } else if (forma_pago.toLowerCase().includes('cupon') || forma_pago.toLowerCase().includes('efectivo')) {
        forma_pago = 'efectivo';
      } else if (forma_pago.toLowerCase().includes('credito') || forma_pago.toLowerCase().includes('crédito')) {
        forma_pago = 'tarjeta_credito';
      }

      const telefono = row['Teléfonos'] || row['Teléfono'] || row['Telefono'] || row['telefono'] || row['Tel'] || null;
      const email = row['Email'] || row['email'] || row['Correo'] || null;
      const direccion = row['Domicilio'] || row['Dirección'] || row['Direccion'] || row['direccion'] || null;
      const localidad = row['Localidad'] || row['localidad'] || row['Ciudad'] || null;
      const provincia = row['Provincia'] || row['provincia'] || 'Córdoba';

      let motor = row['Motor'] || row['Nº Motor'] || row['N° Motor'] || row['Número de Motor'] || row['Numero Motor'] || row['motor'] || row['Nro Motor'] || null;
      let chasis = row['Chasis'] || row['Nº Chasis'] || row['N° Chasis'] || row['Número de Chasis'] || row['Numero Chasis'] || row['chasis'] || row['Nro Chasis'] || null;

      // 1. Buscar o crear cliente
      let clienteId = null;
      if (dniStr) {
        const existingClient = await db.get('SELECT id FROM clientes WHERE dni_cuit = ?', [dniStr]);
        if (existingClient) {
          clienteId = existingClient.id;
        }
      }

      if (!clienteId) {
        const existingByName = await db.get('SELECT id FROM clientes WHERE LOWER(nombre) = LOWER(?)', [nombreStr]);
        if (existingByName) {
          clienteId = existingByName.id;
        }
      }

      if (!clienteId) {
        const newClientRes = await db.run(`
          INSERT INTO clientes (nombre, dni_cuit, telefono, email, direccion, localidad, provincia, estado, riesgo_baja)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'activo', 0)
        `, [
          nombreStr,
          dniStr || `TEMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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
      let patente = row['Patente'] || row['Dominio'] || row['patente'] || null;
      let marca = row['Marca'] || row['marca'] || null;
      let modelo = row['Modelo'] || row['modelo'] || null;
      let anio = row['Año'] || row['Anio'] || row['anio'] || null;

      const bienAsegurado = row['Bien Asegurado'] || row['Vehículo'] || row['Vehiculo'] || null;
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

        const mMot = bienAsegurado.match(/(?:Motor|MOT|M)\s*:?\s*([A-Z0-9-]+)/i);
        if (mMot && !motor) motor = mMot[1];
        const mCha = bienAsegurado.match(/(?:Chasis|CHA|C)\s*:?\s*([A-Z0-9]{8,20})/i);
        if (mCha && !chasis) chasis = mCha[1];
      }

      if (patente || marca || modelo) {
        const cleanPat = patente ? String(patente).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
        if (cleanPat) {
          const existingVeh = await db.get('SELECT id FROM vehiculos WHERE patente = ?', [cleanPat]);
          if (existingVeh) {
            vehiculoId = existingVeh.id;
            if (motor || chasis) {
              await db.run(`
                UPDATE vehiculos SET motor = COALESCE(?, motor), chasis = COALESCE(?, chasis) WHERE id = ?
              `, [motor ? String(motor).trim() : null, chasis ? String(chasis).trim() : null, vehiculoId]);
            }
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
            estado = 'vigente',
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
        const montoComision = valor_cuota * tasa;
        const periodo = fecha_inicio.substring(0, 7);

        const existingCom = await db.get('SELECT id FROM comisiones WHERE poliza_id = ?', [existingPol.id]);
        if (existingCom) {
          await db.run(`
            UPDATE comisiones SET
              compania = ?, monto_poliza = ?, tasa_comision = ?, monto_comision = ?, periodo = ?
            WHERE id = ?
          `, [compania, monto_total, tasa, montoComision, periodo, existingCom.id]);
        } else {
          await db.run(`
            INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
            VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
          `, [existingPol.id, compania, monto_total, tasa, montoComision, periodo]);
        }
      } else {
        const polRes = await db.run(`
          INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id)
          VALUES (?, 0, ?, ?, ?, 'vigente', ?, ?, ?, ?, ?, ?)
        `, [
          numPolStr,
          fecha_inicio,
          fecha_vencimiento,
          cobertura,
          monto_total,
          valor_cuota,
          forma_pago,
          compania,
          clienteId,
          vehiculoId
        ]);
        insertadas++;

        const tasa = await getCommissionRate(compania, cobertura);
        const montoComision = valor_cuota * tasa;
        const periodo = fecha_inicio.substring(0, 7);

        await db.run(`
          INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo)
          VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
        `, [polRes.id, compania, monto_total, tasa, montoComision, periodo]);
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
