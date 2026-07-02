const db = require('../db');

// Validar DNI (7-8 dígitos) o CUIT/CUIL (11 dígitos con dígito verificador de AFIP)
function validateDniOrCuit(val) {
  if (!val) return false;
  const clean = val.replace(/[^0-9]/g, '');
  
  if (clean.length === 7 || clean.length === 8) {
    return true;
  }
  
  if (clean.length === 11) {
    const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(clean[i]) * multipliers[i];
    }
    const mod = sum % 11;
    let checkDigit = 11 - mod;
    if (checkDigit === 11) checkDigit = 0;
    if (checkDigit === 10) checkDigit = 9;
    return checkDigit === parseInt(clean[10]);
  }
  
  return false;
}

// Validar formato de correo electrónico
function validateEmail(email) {
  if (!email) return true; // Campo opcional
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Listar clientes con paginación opcional
async function getClients(req, res, next) {
  const { limit, page } = req.query;
  try {
    let sql = 'SELECT * FROM clientes ORDER BY nombre ASC';
    const params = [];
    
    if (limit) {
      const parsedLimit = parseInt(limit);
      const parsedPage = page ? parseInt(page) : 1;
      const offset = (parsedPage - 1) * parsedLimit;
      sql += ' LIMIT ? OFFSET ?';
      params.push(parsedLimit, offset);
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

  if (!validateDniOrCuit(dni_cuit)) {
    const error = new Error('El formato o dígito verificador del DNI/CUIT no es válido.');
    error.status = 400;
    return next(error);
  }

  if (!validateEmail(email)) {
    const error = new Error('El formato de correo electrónico no es válido.');
    error.status = 400;
    return next(error);
  }

  try {
    const result = await db.run(`
      INSERT INTO clientes (nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado || 'activo', riesgo_baja || 0]);
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

  if (!validateDniOrCuit(dni_cuit)) {
    const error = new Error('El formato o dígito verificador del DNI/CUIT no es válido.');
    error.status = 400;
    return next(error);
  }

  if (!validateEmail(email)) {
    const error = new Error('El formato de correo electrónico no es válido.');
    error.status = 400;
    return next(error);
  }

  try {
    await db.run(`
      UPDATE clientes
      SET nombre = ?, dni_cuit = ?, fecha_nacimiento = ?, telefono = ?, email = ?, direccion = ?, localidad = ?, provincia = ?, observaciones = ?, estado = ?, riesgo_baja = ?
      WHERE id = ?
    `, [nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja, req.params.id]);
    res.json({ message: 'Cliente actualizado con éxito' });
  } catch (err) {
    next(err);
  }
}

// Eliminar cliente
async function deleteClient(req, res, next) {
  try {
    await db.run('DELETE FROM clientes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Cliente eliminado con éxito' });
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
  const XLSX = require('xlsx');

  try {
    const workbook = XLSX.read(archivo.data, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (!jsonData.length) {
      const error = new Error('El archivo Excel está vacío.');
      error.status = 400;
      return next(error);
    }

    let insertados = 0;
    let actualizados = 0;
    let omitidos = 0;

    for (const row of jsonData) {
      const nombre = row['Nombre'] || row['Nombre y Apellido'] || row['nombre'] || row['Nombre Completo'];
      let dni_cuit = row['DNI/CUIT'] || row['DNI'] || row['CUIT'] || row['dni'] || row['cuit'] || row['Documento'] || row['documento'];

      if (!nombre || !dni_cuit) {
        omitidos++;
        continue;
      }

      dni_cuit = String(dni_cuit).trim();

      // Omitir filas con CUITs/DNIs de formato inválido en importación
      if (!validateDniOrCuit(dni_cuit)) {
        omitidos++;
        continue;
      }

      const fecha_nacimiento = row['Fecha de Nacimiento'] || row['Fecha Nacimiento'] || row['fecha_nacimiento'] || null;
      const telefono = row['Teléfono'] || row['Telefono'] || row['telefono'] || row['Tel'] || row['tel'] || null;
      const email = row['Email'] || row['email'] || row['Correo'] || row['correo'] || null;
      const direccion = row['Dirección'] || row['Direccion'] || row['direccion'] || null;
      const localidad = row['Localidad'] || row['localidad'] || row['Ciudad'] || row['ciudad'] || null;
      const provincia = row['Provincia'] || row['provincia'] || null;
      const observaciones = row['Observaciones'] || row['observaciones'] || row['Notas'] || row['notas'] || null;

      const existe = await db.get('SELECT id FROM clientes WHERE dni_cuit = ?', [dni_cuit]);

      const query = `
        INSERT INTO clientes (nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', 0)
        ON CONFLICT(dni_cuit) DO UPDATE SET
          nombre = excluded.nombre,
          fecha_nacimiento = COALESCE(excluded.fecha_nacimiento, clientes.fecha_nacimiento),
          telefono = COALESCE(excluded.telefono, clientes.telefono),
          email = COALESCE(excluded.email, clientes.email),
          direccion = COALESCE(excluded.direccion, clientes.direccion),
          localidad = COALESCE(excluded.localidad, clientes.localidad),
          provincia = COALESCE(excluded.provincia, clientes.provincia),
          observaciones = COALESCE(excluded.observaciones, clientes.observaciones)
      `;

      await db.run(query, [
        nombre,
        dni_cuit,
        fecha_nacimiento ? String(fecha_nacimiento) : null,
        telefono ? String(telefono) : null,
        email ? String(email) : null,
        direccion ? String(direccion) : null,
        localidad ? String(localidad) : null,
        provincia ? String(provincia) : null,
        observaciones ? String(observaciones) : null
      ]);

      if (existe) {
        actualizados++;
      } else {
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
