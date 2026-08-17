require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbUrl = process.env.DATABASE_URL || 
              process.env.INTERNAL_DATABASE_URL || 
              process.env.EXTERNAL_DATABASE_URL || 
              process.env.POSTGRES_URL || 
              process.env.POSTGRESQL_URL;

const pgHost = process.env.PGHOST || process.env.PG_HOST;
const isPgEnv = Boolean(dbUrl || (pgHost && pgHost !== 'localhost' && pgHost !== '127.0.0.1'));

let isPg = false;
let pool = null;
let sqliteDb = null;

if (isPgEnv) {
  const { Pool } = require('pg');
  const poolConfig = { max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };
  const isLocalHost = (dbUrl && (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1'))) || (pgHost === 'localhost' || pgHost === '127.0.0.1');

  if (dbUrl) {
    poolConfig.connectionString = dbUrl;
    if (!isLocalHost) {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
  } else {
    poolConfig.host = pgHost;
    poolConfig.port = parseInt(process.env.PGPORT || process.env.PG_PORT || '5432');
    poolConfig.user = process.env.PGUSER || process.env.PG_USER || 'postgres';
    poolConfig.password = process.env.PGPASSWORD || process.env.PG_PASSWORD || '';
    poolConfig.database = process.env.PGDATABASE || process.env.PG_DATABASE || 'gpg_seguros';
    if (!isLocalHost) {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
  }
  pool = new Pool(poolConfig);
  pool.on('error', (err) => console.error('PostgreSQL pool error:', err));
}

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function run(sql, params = []) {
  if (isPg) {
    const query = convertPlaceholders(sql);
    const isInsert = /^\s*INSERT/i.test(sql);
    if (isInsert && !/RETURNING/i.test(sql)) {
      const result = await pool.query(query + ' RETURNING id', params);
      return { id: result.rows[0]?.id ?? 0, changes: result.rowCount ?? 0 };
    }
    const result = await pool.query(query, params);
    return { id: 0, changes: result.rowCount ?? 0 };
  } else {
    return new Promise((resolve, reject) => {
      // Reemplazar sintaxis RETURNING o EXCLUDED de Postgres si se usa en SQLite
      let cleanSql = sql
        .replace(/EXCLUDED\./gi, 'excluded.')
        .replace(/RETURNING\s+id/gi, '');

      sqliteDb.run(cleanSql, params, function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }
}

async function get(sql, params = []) {
  if (isPg) {
    const query = convertPlaceholders(sql);
    const result = await pool.query(query, params);
    return result.rows[0];
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }
}

async function all(sql, params = []) {
  if (isPg) {
    const query = convertPlaceholders(sql);
    const result = await pool.query(query, params);
    return result.rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
}

async function initDatabase() {
  if (isPgEnv) {
    try {
      const client = await pool.connect();
      console.log('[DB Engine]: PostgreSQL conectado a:', client.database);
      client.release();
      isPg = true;

      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        try {
          await pool.query(schemaSql);
          console.log('Schema PostgreSQL verificado.');
        } catch (schemaErr) {
          console.error('[Schema Warning]:', schemaErr.message);
        }
      }

      const userCount = await get('SELECT COUNT(*) AS count FROM usuarios');
      if (parseInt(userCount.count) === 0) {
        await seedDatabase();
      } else {
        const catalogCount = await get('SELECT COUNT(*) AS count FROM catalogo_vehiculos');
        if (parseInt(catalogCount.count) === 0) {
          await seedCatalogo();
        }
      }
      await seedTasasComision();
      console.log('Base de datos PostgreSQL lista.');
      return;
    } catch (err) {
      console.warn('[DB Fallback]: No se pudo conectar a PostgreSQL (', err.message, '). Cambiando a SQLite...');
      isPg = false;
    }
  }

  // Fallback SQLite
  console.log('[DB Engine]: Inicializando SQLite (gpg_seguros.db)');
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, 'gpg_seguros.db');
  sqliteDb = new sqlite3.Database(dbPath);

  await initSqliteTables();
  const userCount = await get('SELECT COUNT(*) AS count FROM usuarios');
  if (!userCount || parseInt(userCount.count) === 0) {
    await seedDatabase();
  }
  const catalogCount = await get('SELECT COUNT(*) AS count FROM catalogo_vehiculos');
  if (!catalogCount || parseInt(catalogCount.count) === 0) {
    await seedCatalogo();
  }
  await seedTasasComision();
  console.log('Base de datos SQLite lista.');
}

async function initSqliteTables() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS usuarios (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario    TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        rol        TEXT NOT NULL CHECK (rol IN ('admin', 'productor', 'administrativo')),
        nombre     TEXT NOT NULL,
        creado_en  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS clientes (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre           TEXT NOT NULL,
        dni_cuit         TEXT UNIQUE NOT NULL,
        fecha_nacimiento DATE,
        telefono         TEXT,
        email            TEXT,
        direccion        TEXT,
        localidad        TEXT,
        provincia        TEXT,
        observaciones    TEXT,
        estado           TEXT NOT NULL DEFAULT 'activo',
        riesgo_baja      BOOLEAN NOT NULL DEFAULT 0,
        creado_en        DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vehiculos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        marca      TEXT NOT NULL,
        modelo     TEXT NOT NULL,
        version    TEXT,
        anio       INTEGER,
        patente    TEXT,
        chasis     TEXT,
        motor      TEXT,
        uso        TEXT DEFAULT 'particular',
        creado_en  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS polizas (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_poliza     TEXT NOT NULL,
        numero_renovacion INTEGER NOT NULL DEFAULT 0,
        fecha_inicio      DATE NOT NULL,
        fecha_vencimiento DATE NOT NULL,
        cobertura         TEXT NOT NULL,
        estado            TEXT NOT NULL DEFAULT 'vigente',
        monto_total       REAL NOT NULL,
        valor_cuota       REAL NOT NULL,
        forma_pago        TEXT NOT NULL DEFAULT 'efectivo',
        compania          TEXT NOT NULL,
        cliente_id        INTEGER NOT NULL,
        vehiculo_id       INTEGER,
        creado_en         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cotizaciones (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id     INTEGER NOT NULL,
        vehiculo_id    INTEGER,
        compania       TEXT NOT NULL,
        cobertura      TEXT NOT NULL,
        monto_total    REAL NOT NULL,
        valor_cuota    REAL NOT NULL,
        estado         TEXT NOT NULL DEFAULT 'pendiente',
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS siniestros (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_siniestro TEXT UNIQUE,
        cliente_id       INTEGER NOT NULL,
        vehiculo_id      INTEGER,
        poliza_id        INTEGER,
        fecha            DATE NOT NULL,
        descripcion      TEXT NOT NULL,
        estado           TEXT NOT NULL DEFAULT 'denunciado',
        creado_en        DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agenda (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id        INTEGER,
        titulo            TEXT NOT NULL,
        descripcion       TEXT,
        fecha_vencimiento DATE NOT NULL,
        tipo              TEXT NOT NULL DEFAULT 'recordatorio',
        completado        BOOLEAN NOT NULL DEFAULT 0,
        creado_en         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS crm_logs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id     INTEGER NOT NULL,
        tipo_contacto  TEXT NOT NULL DEFAULT 'nota',
        descripcion    TEXT NOT NULL,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS comisiones (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        poliza_id      INTEGER NOT NULL,
        compania       TEXT NOT NULL,
        monto_poliza   REAL NOT NULL,
        tasa_comision  REAL NOT NULL,
        monto_comision REAL NOT NULL,
        estado_pago    TEXT NOT NULL DEFAULT 'pendiente',
        periodo        TEXT NOT NULL,
        creado_en      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS adjuntos (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id     INTEGER,
        poliza_id      INTEGER,
        siniestro_id   INTEGER,
        nombre_archivo TEXT NOT NULL,
        ruta_archivo   TEXT NOT NULL,
        tipo_documento TEXT NOT NULL DEFAULT 'pdf',
        fecha_subida   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS catalogo_vehiculos (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        marca   TEXT NOT NULL,
        modelo  TEXT NOT NULL,
        version TEXT NOT NULL,
        UNIQUE (marca, modelo, version)
    );
    CREATE TABLE IF NOT EXISTS tasas_comision (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        compania       TEXT NOT NULL,
        tipo_cobertura TEXT NOT NULL DEFAULT '*',
        tasa           REAL NOT NULL DEFAULT 0.15,
        descripcion    TEXT,
        activa         BOOLEAN NOT NULL DEFAULT 1,
        creado_en      DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (compania, tipo_cobertura)
    );
    CREATE TABLE IF NOT EXISTS cuotas_cobranza (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        poliza_id         INTEGER NOT NULL,
        numero_cuota      INTEGER NOT NULL,
        total_cuotas      INTEGER NOT NULL DEFAULT 12,
        fecha_vencimiento DATE NOT NULL,
        monto             REAL NOT NULL,
        estado            TEXT NOT NULL DEFAULT 'pendiente',
        fecha_pago        DATE,
        forma_pago        TEXT,
        notas             TEXT,
        creado_en         DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (poliza_id, numero_cuota)
    );
  `;
  return new Promise((resolve, reject) => {
    sqliteDb.exec(ddl, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function seedTasasComision() {
  try {
    const count = await get('SELECT COUNT(*) as count FROM tasas_comision');
    if (!count || parseInt(count.count) === 0) {
      const query = `
        INSERT INTO tasas_comision (compania, tipo_cobertura, tasa, descripcion) VALUES
          ('Federación Patronal', '*', 0.1500, 'Tasa genérica Federación Patronal'),
          ('Sancor Seguros', '*', 0.1500, 'Tasa genérica Sancor'),
          ('El Norte Seguros', '*', 0.1500, 'Tasa genérica El Norte Seguros'),
          ('La Segunda', '*', 0.1200, 'Tasa genérica La Segunda'),
          ('Zurich', '*', 0.1400, 'Tasa genérica Zurich'),
          ('Rivadavia', '*', 0.1300, 'Tasa genérica Rivadavia'),
          ('San Cristóbal', '*', 0.1500, 'Tasa genérica San Cristóbal'),
          ('Mapfre', '*', 0.1200, 'Tasa genérica Mapfre'),
          ('Allianz', '*', 0.1400, 'Tasa genérica Allianz'),
          ('Mercantil Andina', '*', 0.1500, 'Tasa genérica Mercantil Andina'),
          ('Berkley', '*', 0.1300, 'Tasa genérica Berkley')
      `;
      await run(query);
      console.log('Tasas de comisión de ejemplo creadas.');
    }
  } catch (err) {
    console.error('Error al inicializar tasas_comision:', err.message);
  }
}

async function seedCatalogo() {
  console.log('Cargando catálogo de vehículos...');
  const normalizeCatalogText = (s) => {
    if (s === null || s === undefined) return '';
    return String(s).trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const catalogo = {
    "Toyota": {
      "Corolla": ["1.8 XEI CVT", "1.8 SEG CVT", "2.0 GR-Sport", "1.8 Hybrid SEG CVT"],
      "Hilux": ["2.4 TD DX 4x2", "2.8 TD SRX 4x4", "2.8 TD GR-Sport"],
      "Etios": ["1.5 X 6MT", "1.5 XLS 4AT"],
      "Yaris": ["1.5 XS 6MT", "1.5 XLS Pack CVT"],
      "SW4": ["2.8 TD SRX 4x4 7Asientos", "2.8 TD Diamond 4x4"],
      "Corolla Cross": ["2.0 XEI CVT", "1.8 Hybrid SEG CVT"],
      "RAV4": ["2.5 XLE CVT", "2.0 GX CVT"]
    },
    "Ford": {
      "Ranger": ["2.0T XL 4x2", "2.0T XLS 4x4", "3.0 V6 XLS", "3.0 V6 Limited 4x4"],
      "Ka": ["1.5 S 5MT", "1.5 SEL 6AT"],
      "Fiesta": ["1.6 SE 5MT", "1.6 Titanium 6MT"],
      "Focus": ["1.6 S 5MT", "2.0 SE Plus 5MT", "2.0 Titanium 6AT"],
      "EcoSport": ["1.5 SE 5MT", "2.0 Titanium 6AT"],
      "Kuga": ["1.5 EcoBoost Titanium", "2.0 EcoBlue ST-Line"]
    },
    "Fiat": {
      "Cronos": ["1.3 Like", "1.3 Drive Pack Conectividad", "1.8 Precision 6AT"],
      "Toro": ["2.0 TD Freedom 4x4", "2.0 TD Volcano 4x4", "1.3T Ultra"],
      "Argo": ["1.3 Drive", "1.8 Precision 6AT", "1.8 Adventure"],
      "Mobi": ["1.0 Easy", "1.0 Way"],
      "Strada": ["1.4 Endurance", "1.3 Freedom 4x2", "1.3 Volcano CVT"],
      "Pulse": ["1.3 Turbo", "1.8 Sport"]
    },
    "Peugeot": {
      "208": ["1.2 Like", "1.6 Active", "1.6 Allure", "1.6 Feline 6AT"],
      "308": ["1.6 Active", "1.6T Allure Plus", "2.0 Feline"],
      "2008": ["1.6 Active", "1.6T Sport 6AT"],
      "Partner": ["1.6 Presence (Furgon)", "1.6 HDI Patagonica (Familiar)"],
      "3008": ["1.6 THP Allure", "1.5 BlueHDi GT"]
    },
    "Chevrolet": {
      "Onix": ["1.2 Joy", "1.2 LT", "1.0T LTZ", "1.0T Premier AT"],
      "Cruze": ["1.4T LT 6MT", "1.4T LTZ 6AT", "1.4T Premier 6AT"],
      "Tracker": ["1.2T Base 5MT", "1.2T LTZ 6AT", "1.2T Premier 6AT"],
      "S10": ["2.8 TD LT 4x2", "2.8 TD LTZ 4x4", "2.8 TD High Country 4x4"],
      "Equinox": ["1.5 Turbo RS", "2.0 Premier"]
    },
    "Volkswagen": {
      "Gol Trend": ["1.6 Trendline 5MT"],
      "Amarok": ["2.0 TDI Trendline 4x2", "2.0 TDI Highline 4x4", "3.0 V6 Extreme 4x4"],
      "T-Cross": ["1.6 Trendline", "1.0T Comfortline 6AT", "1.0T Highline 6AT"],
      "Polo": ["1.6 Trendline", "1.6 Highline 6AT", "1.4T GTS 6AT"],
      "Vento": ["1.4T Comfortline 6AT", "2.0T GLI 6DSG"],
      "Taos": ["1.4T Comfortline 6AT", "1.4T Highline 6AT"],
      "Suran": ["1.6 Comfortline", "1.6 Highline 6MT"],
      "Virtus": ["1.6 MSI Comfortline", "1.0T Highline"]
    },
    "Renault": {
      "Sandero": ["1.6 Life", "1.6 Zen", "1.6 Intens CVT"],
      "Kangoo": ["1.6 Express Professional (Furgon)", "1.6 Life (Familiar)", "1.5 dCi Stepway (Familiar)"],
      "Logan": ["1.6 Life", "1.6 Zen"],
      "Duster": ["1.6 Intens 4x2", "1.3T Outsider 4x2 CVT", "1.3T Iconic 4x4 6MT"],
      "Alaskan": ["2.0 Dci Confort 4x2", "2.3 Dci Intens 4x4", "2.3 Dci Iconic 4x4 AT"],
      "Koleos": ["2.5 CVT Intens", "2.0 Turbo Zen"]
    },
    "Citroen": {
      "C3": ["1.2 Live Pack", "1.6 Feel 5MT", "1.6 Feel Pack 6AT"],
      "C4 Cactus": ["1.6 Feel 5MT", "1.6 Feel Pack 6AT", "1.6T Shine 6AT"],
      "Berlingo": ["1.6 Business (Furgon)", "1.6 HDI Multispace (Familiar)"],
      "C-Elysee": ["1.6 VTi 115", "1.2 PureTech"]
    },
    "Honda": {
      "Civic": ["2.0 EXS CVT", "1.5T EXT 7CVT"],
      "HR-V": ["1.8 LX CVT", "1.8 EXL CVT"],
      "Fit": ["1.5 EXL CVT"],
      "City": ["1.5 Touring CVT", "1.5 EX MT"]
    },
    "Jeep": {
      "Renegade": ["1.8 Sport 5MT", "1.8 Sport 6AT", "1.3T Longitude 6AT", "1.3T Trailhawk 4x4 9AT"],
      "Compass": ["2.0 Sport 6MT", "1.3T Longitude 6AT", "2.0 TD Trailhawk 4x4 9AT"],
      "Cherokee": ["3.2 Limited"]
    },
    "Nissan": {
      "Frontier": ["2.3 Dci S 4x2", "2.3 Dci XE 4x4", "2.3 Dci Pro-4X 4x4 AT"],
      "Kicks": ["1.6 Sense 5MT", "1.6 Advance CVT", "1.6 Exclusive CVT"],
      "X-Trail": ["2.5 Advance", "1.7 N-Design"]
    },
    "Hyundai": {
      "Tucson": ["2.0 GL 6AT", "1.6T GLS 7DCT 4x4"],
      "Creta": ["1.6 GL 6AT", "2.0 Safety 6AT"],
      "Santa Fe": ["2.4 GLS", "2.2 CRDi Premium"]
    },
    "Kia": {
      "Sportage": ["2.0 LX AT", "1.6T EX Line"],
      "Cerato": ["2.0 EX", "1.6 LX"],
      "Seltos": ["2.0 EX", "1.4T Limited"]
    },
    "Audi": {
      "A3": ["1.4 TFSI S-Tronic", "2.0 TFSI S-Line"],
      "A4": ["2.0 TFSI Avant", "2.0 TFSI S-Tronic"],
      "Q3": ["1.4 TFSI S-Tronic", "2.0 TFSI Quattro"],
      "Q5": ["2.0 TFSI Quattro S-Tronic", "3.0 TDI Quattro"]
    },
    "Bmw": {
      "Serie 1": ["118i Sportive", "120i M Sport"],
      "Serie 3": ["320i ActiveFlex", "330i Sport Line", "M340i xDrive"],
      "X1": ["sDrive20i M Sport", "xDrive25i"],
      "X3": ["xDrive30i M Sport", "M40i"]
    },
    "Mercedes Benz": {
      "Clase A": ["A200 Progressive", "A250 AMG-Line"],
      "Clase C": ["C200 Avantgarde", "C300 AMG-Line"],
      "Gla": ["GLA200 Progressive", "GLA250 AMG-Line"],
      "Glc": ["GLC300 Off-Road", "GLC300 Coupe AMG-Line"]
    }
  };

  for (const marca of Object.keys(catalogo)) {
    for (const modelo of Object.keys(catalogo[marca])) {
      for (const version of catalogo[marca][modelo]) {
        const marcaN  = normalizeCatalogText(marca);
        const modeloN = normalizeCatalogText(modelo);
        const versionN = normalizeCatalogText(version);
        await run('INSERT INTO catalogo_vehiculos (marca, modelo, version) VALUES (?, ?, ?)', [marcaN, modeloN, versionN]);
      }
    }
  }
  console.log('Catálogo de vehículos cargado con éxito.');
}

async function seedDatabase() {
  console.log('Iniciando carga de datos semilla (usuarios)...');
  const hashAdmin = bcrypt.hashSync('admin123', 10);
  const hashProd  = bcrypt.hashSync('prod123', 10);
  const hashAdm   = bcrypt.hashSync('adm123', 10);

  try {
    await run("INSERT INTO usuarios (usuario, password, rol, nombre) VALUES (?, ?, 'admin', 'Administrador General')", ['admin', hashAdmin]);
  } catch {}
  try {
    await run("INSERT INTO usuarios (usuario, password, rol, nombre) VALUES (?, ?, 'productor', 'Pedro Pas (Productor)')", ['productor', hashProd]);
  } catch {}
  try {
    await run("INSERT INTO usuarios (usuario, password, rol, nombre) VALUES (?, ?, 'administrativo', 'Ana Admin (Administrativa)')", ['administrativo', hashAdm]);
  } catch {}
  console.log('Usuarios base inicializados con éxito.');
}

module.exports = { pool, run, get, all, initDatabase };
