require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────
// Pool de conexiones a PostgreSQL
// ─────────────────────────────────────────────
const poolConfig = {
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  // Render y servicios cloud en producción requieren SSL
  poolConfig.ssl = { rejectUnauthorized: false };
} else {
  poolConfig.host = process.env.PG_HOST || 'localhost';
  poolConfig.port = parseInt(process.env.PG_PORT || '5432');
  poolConfig.user = process.env.PG_USER || 'postgres';
  poolConfig.password = process.env.PG_PASSWORD || 'admin1234';
  poolConfig.database = process.env.PG_DATABASE || 'gpg_seguros';
  if (process.env.PG_SSL === 'true') {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

// ─────────────────────────────────────────────
// Convertir placeholders ? de SQLite → $1,$2... de PostgreSQL
// Esto permite que todos los controllers sigan funcionando sin cambios
// ─────────────────────────────────────────────
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ─────────────────────────────────────────────
// Helper: ejecutar INSERT / UPDATE / DELETE / DDL
// Retorna { id, changes } — compatible con la API anterior de SQLite
// ─────────────────────────────────────────────
async function run(sql, params = []) {
  const query = convertPlaceholders(sql);
  const isInsert = /^\s*INSERT/i.test(sql);

  // Para INSERT: agrega RETURNING id si no lo tiene ya
  if (isInsert && !/RETURNING/i.test(sql)) {
    const queryWithReturning = query + ' RETURNING id';
    const result = await pool.query(queryWithReturning, params);
    return {
      id:      result.rows[0]?.id ?? 0,
      changes: result.rowCount ?? 0,
    };
  }

  const result = await pool.query(query, params);
  return {
    id:      0,
    changes: result.rowCount ?? 0,
  };
}

// ─────────────────────────────────────────────
// Helper: obtener una sola fila (o undefined)
// ─────────────────────────────────────────────
async function get(sql, params = []) {
  const query = convertPlaceholders(sql);
  const result = await pool.query(query, params);
  return result.rows[0];
}

// ─────────────────────────────────────────────
// Helper: obtener múltiples filas
// ─────────────────────────────────────────────
async function all(sql, params = []) {
  const query = convertPlaceholders(sql);
  const result = await pool.query(query, params);
  return result.rows;
}

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
// Inicialización: verifica conexión y carga datos semilla
// ─────────────────────────────────────────────
async function initDatabase() {
  try {
    const client = await pool.connect();
    console.log('Conectado a PostgreSQL:', client.database);
    client.release();

    // 1. Ejecutar schema.sql para garantizar que todas las tablas existan
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      try {
        await pool.query(schemaSql);
        console.log('Schema verificado/aplicado en PostgreSQL.');
      } catch (schemaErr) {
        console.error('[Schema SQL Warning]:', schemaErr.message || schemaErr);
      }
    }

    // 2. Verificar si ya existen usuarios; si no, cargar datos semilla
    const userCount = await get('SELECT COUNT(*) AS count FROM usuarios');
    if (parseInt(userCount.count) === 0) {
      await seedDatabase();
    } else {
      // Solo cargar catálogo de vehículos si está vacío (evitar DELETE + re-insert en cada inicio)
      const catalogCount = await get('SELECT COUNT(*) AS count FROM catalogo_vehiculos');
      if (parseInt(catalogCount.count) === 0) {
        await seedCatalogo();
      } else {
        console.log('Catálogo de vehículos ya cargado (%d registros). Saltando recarga.', parseInt(catalogCount.count));
      }
    }

    // 3. Verificar e inicializar tasas de comisión si no existen
    await seedTasasComision();

    console.log('Base de datos inicializada correctamente.');
  } catch (error) {
    console.error('Error al inicializar la base de datos:', error.message);
    throw error;
  }
}

async function seedTasasComision() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasas_comision (
        id             SERIAL PRIMARY KEY,
        compania       TEXT NOT NULL,
        tipo_cobertura TEXT NOT NULL DEFAULT '*',
        tasa           NUMERIC(5,4) NOT NULL DEFAULT 0.1500,
        descripcion    TEXT,
        activa         BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (compania, tipo_cobertura)
      )
    `);
    const count = await pool.query('SELECT COUNT(*) as count FROM tasas_comision');
    if (parseInt(count.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO tasas_comision (compania, tipo_cobertura, tasa, descripcion) VALUES
          ('Federación Patronal', '*', 0.1500, 'Tasa genérica Federación Patronal'),
          ('Sancor Seguros', '*', 0.1500, 'Tasa genérica Sancor'),
          ('La Segunda', '*', 0.1200, 'Tasa genérica La Segunda'),
          ('Zurich', '*', 0.1400, 'Tasa genérica Zurich'),
          ('Rivadavia', '*', 0.1300, 'Tasa genérica Rivadavia'),
          ('San Cristóbal', '*', 0.1500, 'Tasa genérica San Cristóbal'),
          ('Mapfre', '*', 0.1200, 'Tasa genérica Mapfre'),
          ('Allianz', '*', 0.1400, 'Tasa genérica Allianz'),
          ('Mercantil Andina', '*', 0.1500, 'Tasa genérica Mercantil Andina'),
          ('Berkley', '*', 0.1300, 'Tasa genérica Berkley')
        ON CONFLICT DO NOTHING
      `);
      console.log('Tasas de comisión iniciales verficadas/creadas.');
    }
  } catch (err) {
    console.error('Error al inicializar tasas_comision:', err.message);
  }
}

// ─────────────────────────────────────────────
// Catálogo de vehículos
// ─────────────────────────────────────────────
async function seedCatalogo() {
  console.log('Cargando catálogo de vehículos...');

  const normalizeCatalogText = (s) => {
    if (s === null || s === undefined) return '';
    return String(s)
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const marca of Object.keys(catalogo)) {
      for (const modelo of Object.keys(catalogo[marca])) {
        for (const version of catalogo[marca][modelo]) {
          const marcaN  = normalizeCatalogText(marca);
          const modeloN = normalizeCatalogText(modelo);
          const versionN = normalizeCatalogText(version);
          await client.query(
            'INSERT INTO catalogo_vehiculos (marca, modelo, version) VALUES ($1, $2, $3) ON CONFLICT (marca, modelo, version) DO NOTHING',
            [marcaN, modeloN, versionN]
          );
        }
      }
    }
    await client.query('COMMIT');
    console.log('Catalogo de vehiculos cargado con exito.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al cargar catalogo:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function seedDatabase() {
  console.log('Iniciando carga de datos semilla...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hashAdmin = bcrypt.hashSync('admin123', 10);
    const hashProd  = bcrypt.hashSync('prod123', 10);
    const hashAdm   = bcrypt.hashSync('adm123', 10);

    await client.query(`
      INSERT INTO usuarios (usuario, password, rol, nombre) VALUES
        ('admin',          $1, 'admin',          'Administrador General'),
        ('productor',      $2, 'productor',      'Pedro Pas (Productor)'),
        ('administrativo', $3, 'administrativo', 'Ana Admin (Administrativa)')
      ON CONFLICT (usuario) DO NOTHING
    `, [hashAdmin, hashProd, hashAdm]);

    await client.query('COMMIT');
    console.log('Usuarios base inicializados con exito.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al insertar usuarios base:', err.message);
    throw err;
  } finally {
    client.release();
  }

  await seedCatalogo();
}

module.exports = { pool, run, get, all, initDatabase };
