const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'gpg_seguros.db');

let db; // Will be initialized asynchronously

// Save the database to disk periodically and on changes
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (db) {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    }
  }, 100);
}

// Helper para ejecutar consultas (INSERT, UPDATE, DELETE, CREATE, PRAGMA)
function run(sql, params = []) {
  try {
    db.run(sql, params);
    const result = {
      id: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0,
      changes: db.getRowsModified()
    };
    scheduleSave();
    return Promise.resolve(result);
  } catch (err) {
    return Promise.reject(err);
  }
}

// Helper para obtener una fila
function get(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let row = undefined;
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      row = {};
      columns.forEach((col, i) => { row[col] = values[i]; });
    }
    stmt.free();
    return Promise.resolve(row);
  } catch (err) {
    return Promise.reject(err);
  }
}

// Helper para obtener varias filas
function all(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      const row = {};
      columns.forEach((col, i) => { row[col] = values[i]; });
      rows.push(row);
    }
    stmt.free();
    return Promise.resolve(rows);
  } catch (err) {
    return Promise.reject(err);
  }
}

// Inicialización de tablas y carga de datos semilla
async function initDatabase() {
  try {
    // Inicializar sql.js y cargar/crear la base de datos
    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('Conectado a la base de datos SQLite existente: gpg_seguros.db');
    } else {
      db = new SQL.Database();
      console.log('Base de datos SQLite creada: gpg_seguros.db');
    }

    // Habilitar claves foráneas
    await run('PRAGMA foreign_keys = ON');

    // sql.js no soporta WAL, usar DELETE journal mode (por defecto)
    await run('PRAGMA synchronous = NORMAL');

    // 1. Usuarios
    await run(`CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT CHECK(rol IN ('admin', 'productor', 'administrativo')) NOT NULL,
      nombre TEXT NOT NULL
    )`);

    // 2. Clientes
    await run(`CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      dni_cuit TEXT UNIQUE NOT NULL,
      fecha_nacimiento TEXT,
      telefono TEXT,
      email TEXT,
      direccion TEXT,
      localidad TEXT,
      provincia TEXT,
      observaciones TEXT,
      estado TEXT DEFAULT 'activo' CHECK(estado IN ('activo', 'inactivo')),
      riesgo_baja INTEGER DEFAULT 0 CHECK(riesgo_baja IN (0, 1))
    )`);

    // Migración para bases de datos existentes: agregar columna 'provincia' si no existe
    const tableInfo = await all("PRAGMA table_info(clientes)");
    const hasProvince = tableInfo.some(column => column.name === 'provincia');
    if (!hasProvince) {
      await run("ALTER TABLE clientes ADD COLUMN provincia TEXT");
      console.log("Columna 'provincia' agregada a la tabla clientes.");
    }

    // 3. Vehículos
    await run(`CREATE TABLE IF NOT EXISTS vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      version TEXT,
      anio INTEGER,
      patente TEXT,
      chasis TEXT,
      motor TEXT,
      uso TEXT CHECK(uso IN ('particular', 'comercial')),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )`);

    // 4. Pólizas
    await run(`CREATE TABLE IF NOT EXISTS polizas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_poliza TEXT NOT NULL,
      numero_renovacion INTEGER DEFAULT 0,
      fecha_inicio TEXT NOT NULL,
      fecha_vencimiento TEXT NOT NULL,
      cobertura TEXT NOT NULL,
      estado TEXT CHECK(estado IN ('vigente', 'vencida', 'suspendida')) NOT NULL,
      monto_total REAL NOT NULL,
      valor_cuota REAL NOT NULL,
      forma_pago TEXT NOT NULL,
      compania TEXT NOT NULL,
      cliente_id INTEGER NOT NULL,
      vehiculo_id INTEGER,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
      FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE SET NULL,
      UNIQUE(numero_poliza, numero_renovacion)
    )`);

    // 5. Cotizaciones
    await run(`CREATE TABLE IF NOT EXISTS cotizaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      vehiculo_id INTEGER,
      compania TEXT NOT NULL,
      cobertura TEXT NOT NULL,
      monto_total REAL,
      valor_cuota REAL,
      estado TEXT CHECK(estado IN ('pendiente', 'enviada', 'aceptada', 'rechazada')) DEFAULT 'pendiente',
      notas TEXT,
      fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
      FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE SET NULL
    )`);

    // 6. Siniestros
    await run(`CREATE TABLE IF NOT EXISTS siniestros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_siniestro TEXT UNIQUE,
      cliente_id INTEGER NOT NULL,
      vehiculo_id INTEGER,
      poliza_id INTEGER,
      fecha TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      estado TEXT CHECK(estado IN ('denunciado', 'en_proceso', 'doc_pendiente', 'resuelto')) DEFAULT 'denunciado',
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
      FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE SET NULL,
      FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE SET NULL
    )`);

    // 7. Agenda
    await run(`CREATE TABLE IF NOT EXISTS agenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      titulo TEXT NOT NULL,
      descripcion TEXT,
      fecha_vencimiento TEXT NOT NULL,
      tipo TEXT CHECK(tipo IN ('llamada', 'reunion', 'recordatorio', 'renovacion')) NOT NULL,
      completado INTEGER DEFAULT 0 CHECK(completado IN (0, 1)),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )`);

    // 8. CRM Logs
    await run(`CREATE TABLE IF NOT EXISTS crm_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      tipo_contacto TEXT CHECK(tipo_contacto IN ('llamada', 'whatsapp', 'email', 'nota')) NOT NULL,
      descripcion TEXT NOT NULL,
      fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )`);

    // 9. Comisiones
    await run(`CREATE TABLE IF NOT EXISTS comisiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poliza_id INTEGER NOT NULL,
      compania TEXT NOT NULL,
      monto_poliza REAL NOT NULL,
      tasa_comision REAL NOT NULL,
      monto_comision REAL NOT NULL,
      estado_pago TEXT CHECK(estado_pago IN ('pendiente', 'pagado')) DEFAULT 'pendiente',
      periodo TEXT NOT NULL, -- Formato YYYY-MM
      FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE CASCADE
    )`);

    // 10. Adjuntos
    await run(`CREATE TABLE IF NOT EXISTS adjuntos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      poliza_id INTEGER,
      siniestro_id INTEGER,
      nombre_archivo TEXT NOT NULL,
      ruta_archivo TEXT NOT NULL,
      tipo_documento TEXT CHECK(tipo_documento IN ('dni', 'cedula', 'licencia', 'afip', 'pdf', 'foto', 'denuncia', 'formulario', 'otro')) NOT NULL,
      fecha_subida TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
      FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE CASCADE,
      FOREIGN KEY (siniestro_id) REFERENCES siniestros(id) ON DELETE CASCADE
    )`);

    // 11. Catálogo de Vehículos (Marcas, Modelos y Versiones)
    await run(`CREATE TABLE IF NOT EXISTS catalogo_vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      version TEXT NOT NULL,
      UNIQUE(marca, modelo, version)
    )`);

    console.log('Tablas inicializadas correctamente.');

    // Crear Índices para Optimización de Rendimiento
    await run(`CREATE INDEX IF NOT EXISTS idx_clientes_estado ON clientes(estado)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente_id ON vehiculos(cliente_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_polizas_cliente_id ON polizas(cliente_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_polizas_vehiculo_id ON polizas(vehiculo_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_polizas_estado ON polizas(estado)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_polizas_vencimiento ON polizas(fecha_vencimiento)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_polizas_inicio ON polizas(fecha_inicio)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_id ON cotizaciones(cliente_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_cotizaciones_vehiculo_id ON cotizaciones(vehiculo_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones(estado)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha_creacion ON cotizaciones(fecha_creacion)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_siniestros_cliente_id ON siniestros(cliente_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_siniestros_vehiculo_id ON siniestros(vehiculo_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_siniestros_poliza_id ON siniestros(poliza_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_siniestros_estado ON siniestros(estado)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_siniestros_fecha ON siniestros(fecha)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agenda_cliente_id ON agenda(cliente_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agenda_fecha_vencimiento ON agenda(fecha_vencimiento)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_crm_logs_cliente_id ON crm_logs(cliente_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_crm_logs_fecha_creacion ON crm_logs(fecha_creacion)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_comisiones_poliza_id ON comisiones(poliza_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_comisiones_periodo_compania ON comisiones(periodo, compania)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_adjuntos_cliente_id ON adjuntos(cliente_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_adjuntos_poliza_id ON adjuntos(poliza_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_adjuntos_siniestro_id ON adjuntos(siniestro_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_catalogo_marca ON catalogo_vehiculos(marca)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_catalogo_marca_modelo ON catalogo_vehiculos(marca, modelo)`);

    console.log('Índices de base de datos creados/verificados correctamente.');

    // Cargar datos semilla
    const userCount = await get('SELECT COUNT(*) as count FROM usuarios');
    if (userCount.count === 0) {
      await seedDatabase();
    } else {
      // Si ya existen usuarios, refrescar solo el catálogo de vehículos para mantenerlo actualizado
      await run('DELETE FROM catalogo_vehiculos');
      await seedCatalogo();
    }

  } catch (error) {
    console.error('Error al inicializar la base de datos:', error);
  }
}

async function seedDatabase() {
  console.log('Iniciando carga de datos semilla...');
  await seedDatabaseAll();
}

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
      "Pulse": ["1.3 Turbo", "1.8 Sport" ]
    },
    "Peugeot": {
      "208": ["1.2 Like", "1.6 Active", "1.6 Allure", "1.6 Feline 6AT"],
      "308": ["1.6 Active", "1.6T Allure Plus", "2.0 Feline"],
      "2008": ["1.6 Active", "1.6T Sport 6AT"],
      "Partner": ["1.6 Presence (Furgón)", "1.6 HDI Patagonica (Familiar)"],
      "3008": ["1.6 THP Allure", "1.5 BlueHDi GT"]
    },
    "Chevrolet": {
      "Onix": ["1.2 Joy", "1.2 LT", "1.0T LTZ", "1.0T Premier AT"],
      "Cruze": ["1.4T LT 6MT", "1.4T LTZ 6AT", "1.4T Premier 6AT"],
      "Tracker": ["1.2T Base 5MT", "1.2T LTZ 6AT", "1.2T Premier 6AT"],
      "S10": ["2.8 TD LT 4x2", "2.8 TD LTZ 4x4", "2.8 TD High Country 4x4"],
      "Equinox": ["1.5 Turbo RS", "2.0 Premier" ]
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
      "Kangoo": ["1.6 Express Professional (Furgón)", "1.6 Life (Familiar)", "1.5 dCi Stepway (Familiar)"],
      "Logan": ["1.6 Life", "1.6 Zen"],
      "Duster": ["1.6 Intens 4x2", "1.3T Outsider 4x2 CVT", "1.3T Iconic 4x4 6MT"],
      "Alaskan": ["2.0 Dci Confort 4x2", "2.3 Dci Intens 4x4", "2.3 Dci Iconic 4x4 AT"],
      "Koleos": ["2.5 CVT Intens", "2.0 Turbo Zen"]
    },
    "Citroen": {
      "C3": ["1.2 Live Pack", "1.6 Feel 5MT", "1.6 Feel Pack 6AT"],
      "C4 Cactus": ["1.6 Feel 5MT", "1.6 Feel Pack 6AT", "1.6T Shine 6AT"],
      "Berlingo": ["1.6 Business (Furgón)", "1.6 HDI Multispace (Familiar)"],
      "C-Elysee": ["1.6 VTi 115", "1.2 PureTech" ]
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
      "Cherokee": ["3.2 Limited" ]
    },
    "Nissan": {
      "Frontier": ["2.3 Dci S 4x2", "2.3 Dci XE 4x4", "2.3 Dci Pro-4X 4x4 AT"],
      "Kicks": ["1.6 Sense 5MT", "1.6 Advance CVT", "1.6 Exclusive CVT"],
      "X-Trail": ["2.5 Advance", "1.7 N-Design" ]
    },
    "Hyundai": {
      "Tucson": ["2.0 GL 6AT", "1.6T GLS 7DCT 4x4"],
      "Creta": ["1.6 GL 6AT", "2.0 Safety 6AT"],
      "Santa Fe": ["2.4 GLS", "2.2 CRDi Premium"]
    },
    "Kia": {
      "Sportage": ["2.0 LX AT", "1.6T EX Line"],
      "Cerato": ["2.0 EX", "1.6 LX"],
      "Seltos": ["2.0 EX", "1.4T Limited" ]
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

  await run('BEGIN TRANSACTION');
  try {
    for (const marca of Object.keys(catalogo)) {
      for (const modelo of Object.keys(catalogo[marca])) {
        for (const version of catalogo[marca][modelo]) {
          const marcaN = normalizeCatalogText(marca);
          const modeloN = normalizeCatalogText(modelo);
          const versionN = normalizeCatalogText(version);

          await run(
            `INSERT OR IGNORE INTO catalogo_vehiculos (marca, modelo, version) VALUES (?, ?, ?)`,
            [marcaN, modeloN, versionN]
          );
        }
      }
    }
    await run('COMMIT');
    console.log('Catálogo de vehículos cargado con éxito.');
  } catch (error) {
    await run('ROLLBACK');
    console.error('Error al cargar catálogo de vehículos:', error);
    throw error;
  }
}

async function seedDatabaseAll() {
  console.log('Cargando todos los datos semilla principales...');

  await run('BEGIN TRANSACTION');
  try {
    // Usuarios por defecto (passwords hasheados para seguridad)
    const hashAdmin = bcrypt.hashSync('admin123', 10);
    const hashProd = bcrypt.hashSync('prod123', 10);
    const hashAdm = bcrypt.hashSync('adm123', 10);

    // IMPORTANTE: usar INSERT OR IGNORE para que initDatabase sea idempotente.
    await run(`INSERT OR IGNORE INTO usuarios (usuario, password, rol, nombre) VALUES
      ('admin', ?, 'admin', 'Administrador General'),
      ('productor', ?, 'productor', 'Pedro Pas (Productor)'),
      ('administrativo', ?, 'administrativo', 'Ana Admin (Administrativa)')
    `, [hashAdmin, hashProd, hashAdm]);

    await run('COMMIT');
    console.log('Usuarios base inicializados con éxito.');
  } catch (err) {
    await run('ROLLBACK');
    console.error('Error al insertar usuarios base:', err);
    throw err;
  }

  // Cargar catálogo de vehículos
  await seedCatalogo();
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase
};
