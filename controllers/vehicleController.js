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

  try {
    const result = await db.run(`
      INSERT INTO vehiculos (cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso]);
    res.status(201).json({ id: result.id, message: 'Vehículo guardado con éxito' });
  } catch (err) {
    next(err);
  }
}

async function updateVehicle(req, res, next) {
  const { marca, modelo, version, anio, patente, chasis, motor, uso } = req.body;
  try {
    await db.run(`
      UPDATE vehiculos
      SET marca = ?, modelo = ?, version = ?, anio = ?, patente = ?, chasis = ?, motor = ?, uso = ?
      WHERE id = ?
    `, [marca, modelo, version, anio, patente, chasis, motor, uso, req.params.id]);
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

async function lookupVehicle(req, res, next) {
  const { patente } = req.query;
  if (!patente) {
    const error = new Error('La patente es requerida.');
    error.status = 400;
    return next(error);
  }

  const clean = patente.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 6 || clean.length > 7) {
    const error = new Error('El formato de la patente no es válido.');
    error.status = 400;
    return next(error);
  }

  try {
    let isMercosur = false;
    let isOld = false;

    if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(clean)) {
      isMercosur = true;
    } else if (/^[A-Z]{3}\d{3}$/.test(clean)) {
      isOld = true;
    }

    if (!isMercosur && !isOld) {
      if (clean.length === 7) isMercosur = true;
      else isOld = true;
    }

    let year = 2018;
    if (isMercosur) {
      const prefix = clean.substring(0, 2);
      if (prefix < 'AB') year = 2016;
      else if (prefix < 'AC') year = 2017;
      else if (prefix < 'AD') year = 2018;
      else if (prefix < 'AE') year = 2019;
      else if (prefix < 'AF') year = 2021;
      else if (prefix < 'AG') year = 2023;
      else year = 2025;
    } else {
      const firstLetter = clean.charAt(0);
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const idx = alphabet.indexOf(firstLetter);
      if (idx < 0) year = 2005;
      else {
        year = 1995 + Math.floor((idx / 18) * 20);
        if (year > 2015) year = 2015;
      }
    }

    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = clean.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);

    const carPool = [
      { brand: 'Toyota', models: ['Corolla', 'Hilux', 'Etios', 'Yaris', 'SW4'], prefix: '9BH' },
      { brand: 'Ford', models: ['Ranger', 'Ka', 'Fiesta', 'Focus', 'EcoSport'], prefix: '8AF' },
      { brand: 'Fiat', models: ['Cronos', 'Toro', 'Argo', 'Mobi', 'Uno'], prefix: '9BD' },
      { brand: 'Peugeot', models: ['208', '308', '2008', 'Partner'], prefix: '8AD' },
      { brand: 'Chevrolet', models: ['Onix', 'Cruze', 'Tracker', 'S10'], prefix: '9BG' },
      { brand: 'Volkswagen', models: ['Gol Trend', 'Amarok', 'T-Cross', 'Polo', 'Vento', 'Taos'], prefix: '8AJ' },
      { brand: 'Renault', models: ['Sandero', 'Kangoo', 'Logan', 'Duster', 'Alaskan'], prefix: '8A1' },
      { brand: 'Citroen', models: ['C3', 'C4 Cactus', 'Berlingo'], prefix: '8AD' },
      { brand: 'Honda', models: ['Civic', 'HR-V', 'Fit'], prefix: '93H' }
    ];

    const brandObj = carPool[hash % carPool.length];
    const model = brandObj.models[(hash >> 2) % brandObj.models.length];

    let version = '';
    const versions = await db.all('SELECT version FROM catalogo_vehiculos WHERE marca = ? AND modelo = ? ORDER BY version ASC', [brandObj.brand, model]);
    if (versions && versions.length > 0) {
      version = versions[(hash >> 4) % versions.length].version;
    }

    const vinChars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
    let chasis = brandObj.prefix;
    for (let i = 0; i < 5; i++) {
      chasis += vinChars.charAt((hash + i) % 24);
    }
    chasis += 'X';

    const vinYears = {
      1995: 'S', 1996: 'T', 1997: 'V', 1998: 'W', 1999: 'X', 2000: 'Y',
      2001: '1', 2002: '2', 2003: '3', 2004: '4', 2005: '5', 2006: '6', 2007: '7', 2008: '8', 2009: '9',
      2010: 'A', 2011: 'B', 2012: 'C', 2013: 'D', 2014: 'E', 2015: 'F', 2016: 'G', 2017: 'H', 2018: 'J', 2019: 'K',
      2020: 'L', 2021: 'M', 2022: 'N', 2023: 'P', 2024: 'R', 2025: 'S', 2026: 'T'
    };
    chasis += vinYears[year] || 'J';
    chasis += 'A';

    const serial = String((hash % 900000) + 100000);
    chasis += serial;

    const motorPrefixes = ['K4M', 'F4R', '1ZZ', 'THP', 'EC5', 'PUMA', 'MSI', 'FSE', 'E-TORQ', 'DGR'];
    const motorPrefix = motorPrefixes[hash % motorPrefixes.length];
    const motorSerial = String((hash * 7) % 900000 + 100000);
    const motor = `${motorPrefix}-${motorSerial}`;

    res.json({
      marca: brandObj.brand,
      modelo: model,
      version: version || 'Base',
      anio: year,
      patente: clean,
      chasis: chasis,
      motor: motor
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
  lookupVehicle
};
