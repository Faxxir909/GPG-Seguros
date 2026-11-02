const db = require('../db');

async function getVehicles(req, res, next) {
  try {
    const vehicles = await db.all(`
      SELECT v.*, c.nombre as cliente_nombre
      FROM vehiculos v
      JOIN clientes c ON v.cliente_id = c.id
    `);
    res.json(vehicles);
  } catch (err) {
    next(err);
  }
}

async function createVehicle(req, res, next) {
  const { cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso } = req.body;
  if (!cliente_id || !marca || !modelo || !patente) {
    const error = new Error('Cliente, marca, modelo y patente son requeridos.');
    error.status = 400;
    return next(error);
  }

  const cleanPatente = String(patente).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  try {
    const result = await db.run(`
      INSERT INTO vehiculos (cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [cliente_id, marca, modelo, version, anio, cleanPatente, chasis, motor, uso]);
    res.status(201).json({ id: result.id, message: 'Vehículo guardado con éxito' });
  } catch (err) {
    next(err);
  }
}

async function updateVehicle(req, res, next) {
  const { marca, modelo, version, anio, patente, chasis, motor, uso } = req.body;
  const cleanPatente = patente ? String(patente).trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
  try {
    await db.run(`
      UPDATE vehiculos
      SET marca = ?, modelo = ?, version = ?, anio = ?, patente = COALESCE(?, patente), chasis = ?, motor = ?, uso = ?
      WHERE id = ?
    `, [marca, modelo, version, anio, cleanPatente, chasis, motor, uso, req.params.id]);
    res.json({ message: 'Vehículo actualizado con éxito' });
  } catch (err) {
    next(err);
  }
}

async function deleteVehicle(req, res, next) {
  try {
    await db.run('DELETE FROM vehiculos WHERE id = ?', [req.params.id]);
    res.json({ message: 'Vehículo eliminado con éxito' });
  } catch (err) {
    next(err);
  }
}

async function getBrands(req, res, next) {
  try {
    const brands = await db.all('SELECT DISTINCT marca FROM catalogo_vehiculos ORDER BY marca ASC');
    res.json(brands.map(b => b.marca));
  } catch (err) {
    next(err);
  }
}

async function getModels(req, res, next) {
  try {
    const models = await db.all('SELECT DISTINCT modelo FROM catalogo_vehiculos WHERE marca = ? ORDER BY modelo ASC', [req.params.brand]);
    res.json(models.map(m => m.modelo));
  } catch (err) {
    next(err);
  }
}

async function getVersions(req, res, next) {
  try {
    const versions = await db.all(
      'SELECT version FROM catalogo_vehiculos WHERE marca = ? AND modelo = ? ORDER BY version ASC',
      [req.params.brand, req.params.model]
    );
    res.json(versions.map(v => v.version));
  } catch (err) {
    next(err);
  }
}

function normalizeAndValidatePlate(rawPlate) {
  if (!rawPlate || typeof rawPlate !== 'string') {
    const error = new Error('La patente es requerida.');
    error.status = 400;
    throw error;
  }

  const clean = rawPlate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  let formato = null;
  let tipoVehiculo = 'auto';

  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean)) {
    formato = 'mercosur_auto';
    tipoVehiculo = 'automotor';
  } else if (/^[A-Z]{3}\d{3}$/.test(clean)) {
    formato = 'tradicional_auto';
    tipoVehiculo = 'automotor';
  } else if (/^[A-Z]\d{3}[A-Z]{3}$/.test(clean)) {
    formato = 'mercosur_moto';
    tipoVehiculo = 'motovehiculo';
  } else if (/^\d{3}[A-Z]{3}$/.test(clean)) {
    formato = 'tradicional_moto';
    tipoVehiculo = 'motovehiculo';
  }

  if (!formato) {
    const error = new Error('El formato de la patente no es válido. Formatos admitidos: Mercosur (ej: AA123BB, A123BCD) o tradicional (ej: ABC123, 123ABC).');
    error.status = 400;
    throw error;
  }

  return {
    patente: clean,
    formato,
    tipoVehiculo
  };
}

async function lookupVehicle(req, res, next) {
  try {
    const { patente } = req.query;
    const validated = normalizeAndValidatePlate(patente);

    // 1. Buscar si la patente ya existe en la base de datos local
    const existingVehicle = await db.get(`
      SELECT v.id, v.marca, v.modelo, v.version, v.anio, v.patente, v.chasis, v.motor, v.uso,
             c.id as cliente_id, c.nombre as cliente_nombre
      FROM vehiculos v
      JOIN clientes c ON v.cliente_id = c.id
      WHERE UPPER(REGEXP_REPLACE(v.patente, '[^A-Za-z0-9]', '', 'g')) = ?
      ORDER BY v.id DESC LIMIT 1
    `, [validated.patente]);

    if (existingVehicle) {
      return res.json({
        patente: validated.patente,
        formato: validated.formato,
        tipo_vehiculo: validated.tipoVehiculo,
        fuente: 'base_local',
        requiere_carga_manual: false,
        datos_registrales: {
          marca: existingVehicle.marca,
          modelo: existingVehicle.modelo,
          version: existingVehicle.version,
          anio: existingVehicle.anio,
          chasis: existingVehicle.chasis || null,
          motor: existingVehicle.motor || null,
          uso: existingVehicle.uso || 'particular'
        },
        vehiculo_id: existingVehicle.id,
        cliente_asociado: {
          id: existingVehicle.cliente_id,
          nombre: existingVehicle.cliente_nombre
        },
        sugerencias_catalogo: []
      });
    }

    // 2. Si no existe en la base local y no hay proveedor externo integrado (DNRPA/InfoAuto),
    // devolver únicamente la patente normalizada y estado claro de carga manual requerida.
    // NUNCA inventar números de chasis, motor o marcas sintéticas.
    const catalogBrands = await db.all('SELECT DISTINCT marca FROM catalogo_vehiculos ORDER BY marca ASC LIMIT 15');

    res.json({
      patente: validated.patente,
      formato: validated.formato,
      tipo_vehiculo: validated.tipoVehiculo,
      fuente: 'ninguna',
      requiere_carga_manual: true,
      mensaje: 'No hay proveedor registral externo configurado. Por favor ingrese los datos del vehículo manualmente.',
      datos_registrales: null,
      sugerencias_catalogo: {
        marcas_disponibles: catalogBrands.map(b => b.marca)
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getBrands,
  getModels,
  getVersions,
  lookupVehicle,
  normalizeAndValidatePlate
};
