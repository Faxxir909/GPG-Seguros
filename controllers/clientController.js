const db = require('../db');
const { findRowValue, parseExcelBuffer } = require('../services/importerService');
const { isValidDniCuit, isValidEmail } = require('../utils/validation');

// Listar clientes con paginación y búsqueda opcional en servidor
async function getClients(req, res, next) {
  const { limit, page, search, estado } = req.query;
  try {
    let sql = 'SELECT * FROM clientes WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (nombre ILIKE ? OR dni_cuit ILIKE ? OR email ILIKE ? OR telefono ILIKE ? OR localidad ILIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (estado) {
      sql += ' AND estado = ?';
      params.push(estado);
    }

    sql += ' ORDER BY nombre ASC';
    
    if (limit) {
      const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 15));
      const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
      const offset = (parsedPage - 1) * parsedLimit;

      const countSql = `SELECT COUNT(*) as count FROM (` + sql + `) as count_q`;
      const countRes = await db.get(countSql, params);
      const total = parseInt(countRes?.count || 0);

      sql += ' LIMIT ? OFFSET ?';
      params.push(parsedLimit, offset);

      const clients = await db.all(sql, params);
      return res.json({
        data: clients,
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit) || 1
      });
    }
    
    const clients = await db.all(sql, params);
    res.json(clients);
  } catch (err) {
    next(err);
  }
}

// Obtener cliente por ID
async function getClientById(req, res, next) {
  try {
    const client = await db.get('SELECT * FROM clientes WHERE id = ?', [req.params.id]);
    if (!client) {
      const error = new Error('Cliente no encontrado');
      error.status = 404;
      return next(error);
    }
    res.json(client);
  } catch (err) {
    next(err);
  }
}

// Crear cliente
async function createClient(req, res, next) {
  const { nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja } = req.body;
  
  if (!nombre || !dni_cuit) {
    const error = new Error('Nombre y DNI/CUIT son obligatorios.');
    error.status = 400;
    return next(error);
  }

  if (!isValidDniCuit(dni_cuit)) {
    const error = new Error('El formato o dígito verificador del DNI/CUIT no es válido.');
    error.status = 400;
    return next(error);
  }

  if (email && !isValidEmail(email)) {
    const error = new Error('El formato de correo electrónico no es válido.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO clientes (nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado || 'activo', Boolean(riesgo_baja)]);
    res.status(201).json({ id: result.id, message: 'Cliente creado con éxito' });
  } catch (err) {
    next(err);
  }
}

// Actualizar cliente
async function updateClient(req, res, next) {
  const { nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja } = req.body;

  if (!nombre || !dni_cuit) {
    const error = new Error('Nombre y DNI/CUIT son obligatorios.');
    error.status = 400;
    return next(error);
  }

  if (!isValidDniCuit(dni_cuit)) {
    const error = new Error('El formato o dígito verificador del DNI/CUIT no es válido.');
    error.status = 400;
    return next(error);
  }

  if (email && !isValidEmail(email)) {
    const error = new Error('El formato de correo electrónico no es válido.');
    error.status = 400;
    return next(error);
  }

  try {
    await db.run(`
      UPDATE clientes
      SET nombre = ?, dni_cuit = ?, fecha_nacimiento = ?, telefono = ?, email = ?, direccion = ?, localidad = ?, provincia = ?, observaciones = ?, estado = ?, riesgo_baja = ?
      WHERE id = ?
    `, [nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, Boolean(riesgo_baja), req.params.id]);
    res.json({ message: 'Cliente actualizado con éxito' });
  } catch (err) {
    next(err);
  }
}

// Eliminar cliente
async function deleteClient(req, res, next) {
  try {
    const result = await db.run("UPDATE clientes SET estado = 'inactivo' WHERE id = ? AND estado <> 'inactivo'", [req.params.id]);
    if (!result.changes) {
      const error = new Error('Cliente no encontrado o ya inactivo');
      error.status = 404;
      return next(error);
    }
    res.json({ message: 'Cliente archivado con éxito; se conservó su historial.' });
  } catch (err) {
    next(err);
  }
}

// Importar clientes desde Excel
async function importClients(req, res, next) {
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
    const jsonData = parseExcelBuffer(archivo.data);

    let insertados = 0;
    let actualizados = 0;
    let omitidos = 0;

    for (const row of jsonData) {
      let rawNombre = findRowValue(row, [
        /^Nombre(\s+y\s+Apellido)?$/i,
        /^Nombre\s+Completo$/i,
        /^Cliente$/i,
        /^Tomador$/i,
        /^Asegurado$/i,
        /^Raz[óo]n\s+Social$/i,
        /nombre/i,
        /cliente/i,
        /tomador/i
      ]);

      let dni_cuit = findRowValue(row, [
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

      let nombre = String(rawNombre || 'Cliente S/N').trim();
      let dniStr = dni_cuit ? String(dni_cuit).trim().replace(/[^0-9-]/g, '') : null;

      // Si el nombre viene en formato "1116571 - BERGIA, JORGE FABIAN"
      if (nombre.includes(' - ')) {
        const parts = nombre.split(' - ');
        let rawName = parts.slice(1).join(' - ').trim();
        if (rawName.includes(',')) {
          const nameParts = rawName.split(',');
          rawName = `${nameParts[1].trim()} ${nameParts[0].trim()}`;
        }
        nombre = rawName || nombre;
      } else if (nombre.includes(',')) {
        const nameParts = nombre.split(',');
        nombre = `${nameParts[1].trim()} ${nameParts[0].trim()}`;
      }

      if (!dniStr) {
        dniStr = `CLI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      }

      const fecha_nacimiento = findRowValue(row, [/^Fecha(\s+de)?\s*Nacimiento$/i, /^Nacimiento$/i]);
      const telefono = findRowValue(row, [/^Tel[ée]fonos?$/i, /^Celular$/i, /^M[óo]vil$/i, /^Tel$/i]);
      const email = findRowValue(row, [/^E-?mail$/i, /^Correo(\s*Electr[óo]nico)?$/i]);
      const direccion = findRowValue(row, [/^Direcci[óo]n$/i, /^Domicilio$/i, /^Calle$/i]);
      const localidad = findRowValue(row, [/^Localidad$/i, /^Ciudad$/i, /^Pueblo$/i]);
      const provincia = findRowValue(row, [/^Provincia$/i]) || 'Córdoba';
      const observaciones = findRowValue(row, [/^Observaciones$/i, /^Notas$/i]);

      const existe = await db.get('SELECT id FROM clientes WHERE dni_cuit = ?', [dniStr]);

      if (existe) {
        await db.run(`
          UPDATE clientes SET
            nombre = ?,
            fecha_nacimiento = COALESCE(?, fecha_nacimiento),
            telefono = COALESCE(?, telefono),
            email = COALESCE(?, email),
            direccion = COALESCE(?, direccion),
            localidad = COALESCE(?, localidad),
            provincia = COALESCE(?, provincia),
            observaciones = COALESCE(?, observaciones)
          WHERE id = ?
        `, [
          String(nombre),
          fecha_nacimiento ? String(fecha_nacimiento) : null,
          telefono ? String(telefono) : null,
          email ? String(email) : null,
          direccion ? String(direccion) : null,
          localidad ? String(localidad) : null,
          provincia ? String(provincia) : null,
          observaciones ? String(observaciones) : null,
          existe.id
        ]);
        actualizados++;
      } else {
        await db.run(`
          INSERT INTO clientes (nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          String(nombre),
          dniStr,
          fecha_nacimiento ? String(fecha_nacimiento) : null,
          telefono ? String(telefono) : null,
          email ? String(email) : null,
          direccion ? String(direccion) : null,
          localidad ? String(localidad) : null,
          provincia ? String(provincia) : null,
          observaciones ? String(observaciones) : null,
          'activo',
          false
        ]);
        insertados++;
      }
    }

    res.json({
      message: 'Proceso de importación finalizado con éxito.',
      insertados,
      actualizados,
      omitidos
    });
  } catch (err) {
    next(err);
  }
}

// Historial CRM del cliente
async function getClientHistory(req, res, next) {
  try {
    const history = await db.all('SELECT * FROM crm_logs WHERE cliente_id = ? ORDER BY fecha_creacion DESC', [req.params.id]);
    res.json(history);
  } catch (err) {
    next(err);
  }
}

// Pólizas del cliente
async function getClientPolicies(req, res, next) {
  try {
    const policies = await db.all(`
      SELECT p.*, v.marca, v.modelo, v.patente
      FROM polizas p
      LEFT JOIN vehiculos v ON p.vehiculo_id = v.id
      WHERE p.cliente_id = ?
      ORDER BY p.fecha_vencimiento DESC
    `, [req.params.id]);
    res.json(policies);
  } catch (err) {
    next(err);
  }
}

// Vehículos del cliente
async function getClientVehicles(req, res, next) {
  try {
    const vehicles = await db.all('SELECT * FROM vehiculos WHERE cliente_id = ?', [req.params.id]);
    res.json(vehicles);
  } catch (err) {
    next(err);
  }
}

// Adjuntos del cliente
async function getClientAttachments(req, res, next) {
  try {
    const attachments = await db.all('SELECT * FROM adjuntos WHERE cliente_id = ? ORDER BY fecha_subida DESC', [req.params.id]);
    res.json(attachments);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  importClients,
  getClientHistory,
  getClientPolicies,
  getClientVehicles,
  getClientAttachments
};
