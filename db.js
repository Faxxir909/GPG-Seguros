const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'gpg_seguros.db');
const isNewDb = !fs.existsSync(dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al abrir la base de datos', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite: gpg_seguros.db');
  }
});

// Helper para ejecutar consultas y devolver una promesa (para INSERT, UPDATE, DELETE, CREATE)
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

// Helper para obtener una fila
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Helper para obtener varias filas
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Inicialización de tablas y carga de datos semilla
async function initDatabase() {
  try {
    // Habilitar claves foráneas
    await run('PRAGMA foreign_keys = ON');

    // Optimizar SQLite con WAL mode y synchronous normal
    await run('PRAGMA journal_mode = WAL');
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

  // Si ya existen clientes (seed anterior), no hacer nada
  const existing = await get('SELECT COUNT(*) as count FROM clientes');
  if (existing && existing.count > 0) {
    console.log('Los datos de clientes ya existen. Omitiendo.');
    return;
  }

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

    // Clientes
    await run(`INSERT INTO clientes (nombre, dni_cuit, fecha_nacimiento, telefono, email, direccion, localidad, provincia, observaciones, estado, riesgo_baja) VALUES
      ('Juan Pérez', '20-30456789-2', '1985-05-12', '1155551234', 'juan.perez@email.com', 'Av. Santa Fe 1234', 'Palermo', 'CABA', 'Cliente de confianza. Prefiere contacto por WhatsApp.', 'activo', 0),
      ('María Rodríguez', '27-32987654-1', '1990-09-24', '3416789123', 'maria.rod@email.com', 'Bv. Oroño 456', 'Rosario', 'Santa Fe', 'Tiene 2 autos y 1 casa cotizada. Muy puntual con los pagos.', 'activo', 0),
      ('Carlos Gómez', '20-25874123-5', '1978-02-03', '3519876543', 'carlos.gomez@email.com', 'Colón 789', 'Córdoba Capital', 'Córdoba', 'Cliente con retrasos recurrentes en pagos.', 'activo', 1),
      ('Sofía Martínez', '27-36541236-8', '1995-11-30', '1166667777', 'sofia.martinez@email.com', 'Corrientes 555', 'Recoleta', 'CABA', 'Cliente dado de baja el año pasado por venta de vehículo.', 'inactivo', 0),
      ('Estudio Contable Lopez', '30-71458962-9', '2010-01-01', '3414221133', 'contacto@lopezyasoc.com', 'Pellegrini 1020', 'Rosario', 'Santa Fe', 'Póliza corporativa (Flota).', 'activo', 0)
    `);

    // Vehículos
    await run(`INSERT INTO vehiculos (cliente_id, marca, modelo, version, anio, patente, chasis, motor, uso) VALUES
      (1, 'Toyota', 'Corolla', '1.8 XEI CVT', 2021, 'AE543AA', '9BH8Y11XXXXXXXXXX', '1ZZ-FE-XXXXXX', 'particular'),
      (2, 'Peugeot', '208', '1.6 Feline', 2023, 'AF987BB', '8AD9B22XXXXXXXXXX', 'EC5-XXXXXX', 'particular'),
      (2, 'Ford', 'Ranger', '3.0 V6 Limited 4x4', 2019, 'AD456CC', '8AF1F33XXXXXXXXXX', 'PUMA-XXXXXX', 'particular'),
      (3, 'Fiat', 'Cronos', '1.3 Drive', 2022, 'AF321DD', '9BD3A44XXXXXXXXXX', 'FSE-XXXXXX', 'comercial'),
      (5, 'Chevrolet', 'Onix', '1.4T Premier', 2020, 'AE012EE', '9BG4S55XXXXXXXXXX', 'SPE-XXXXXX', 'comercial')
    `);

    // Pólizas (Vigentes, vencidas, suspendidas)
    const hoy = new Date();
    const format = (d) => d.toISOString().split('T')[0];

    const sumarDias = (d, dias) => {
      const res = new Date(d);
      res.setDate(res.getDate() + dias);
      return res;
    };

    const restarDias = (d, dias) => {
      const res = new Date(d);
      res.setDate(res.getDate() - dias);
      return res;
    };

    // Póliza 1: Vigente, vence en 15 días (Juan Pérez - Toyota Corolla)
    const inicio1 = restarDias(hoy, 350);
    const fin1 = sumarDias(hoy, 15);
    await run(`INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id) VALUES
      ('POL-TOY-8921', 2, '${format(inicio1)}', '${format(fin1)}', 'Terceros Completo Premium', 'vigente', 120000.00, 10000.00, 'Débito Automático', 'Sancor Seguros', 1, 1)
    `);

    // Póliza 2: Vigente, vence en 6 meses (María Rodríguez - Peugeot 208)
    const inicio2 = restarDias(hoy, 30);
    const fin2 = sumarDias(hoy, 335);
    await run(`INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id) VALUES
      ('POL-PEU-3120', 0, '${format(inicio2)}', '${format(fin2)}', 'Todo Riesgo con Franquicia', 'vigente', 180000.00, 15000.00, 'Tarjeta de Crédito', 'El Norte Seguros', 2, 2)
    `);

    // Póliza 3: Vencida hace 5 días (Carlos Gómez - Fiat Cronos)
    const inicio3 = restarDias(hoy, 370);
    const fin3 = restarDias(hoy, 5);
    await run(`INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id) VALUES
      ('POL-FIA-4412', 2, '${format(inicio3)}', '${format(fin3)}', 'Responsabilidad Civil', 'vencida', 84000.00, 7000.00, 'Cupón / Pago Fácil', 'Federación Patronal', 3, 4)
    `);

    // Póliza 4: Suspendida por falta de pago (Carlos Gómez)
    const inicio4 = restarDias(hoy, 60);
    const fin4 = sumarDias(hoy, 305);
    await run(`INSERT INTO polizas (numero_poliza, numero_renovacion, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id, vehiculo_id) VALUES
      ('POL-FIA-9912', 0, '${format(inicio4)}', '${format(fin4)}', 'Terceros Completo', 'suspendida', 96000.00, 8000.00, 'Cupón / Pago Fácil', 'El Norte Seguros', 3, 4)
    `);

    // Cotizaciones
    await run(`INSERT INTO cotizaciones (cliente_id, vehiculo_id, compania, cobertura, monto_total, valor_cuota, estado, notas) VALUES
      (2, 3, 'Sancor Seguros', 'Todo Riesgo Franquicia $150.000', 210000.00, 17500.00, 'enviada', 'Enviado presupuesto comparativo por WhatsApp.'),
      (2, 3, 'El Norte Seguros', 'Terceros Completo Full', 150000.00, 12500.00, 'pendiente', 'Comparación del Peugeot Ranger.'),
      (3, 4, 'La Segunda', 'Terceros Completo Premium', 108000.00, 9000.00, 'rechazada', 'El cliente consideró que la cuota era muy alta.'),
      (1, 1, 'El Norte Seguros', 'Todo Riesgo Premium', 144000.00, 12000.00, 'aceptada', 'Convertida en póliza POL-TOY-8921. Oferta especial.')
    `);

    // Siniestros
    await run(`INSERT INTO siniestros (numero_siniestro, cliente_id, vehiculo_id, poliza_id, fecha, descripcion, estado) VALUES
      ('SIN-2026-0001', 2, 2, 2, '${format(restarDias(hoy, 15))}', 'Choque menor en intersección de calles. Guardabarro delantero izquierdo dañado.', 'en_proceso'),
      ('SIN-2026-0002', 3, 4, 4, '${format(restarDias(hoy, 45))}', 'Rotura de parabrisas por granizo.', 'doc_pendiente'),
      ('SIN-2026-0003', 1, 1, 1, '${format(restarDias(hoy, 120))}', 'Cerradura forzada e intento de robo de stereo. Resuelto por compañía.', 'resuelto')
    `);

    // CRM Logs (Historial de contactos)
    await run(`INSERT INTO crm_logs (cliente_id, tipo_contacto, descripcion) VALUES
      (1, 'whatsapp', 'Se le envió cotización de renovación de póliza.'),
      (1, 'llamada', 'Habló el cliente confirmando el débito de la cuota 11.'),
      (2, 'whatsapp', 'Reportó choque menor. Se le solicitaron fotos y denuncia administrativa.'),
      (3, 'llamada', 'Se lo llamó para avisar de la suspensión de cobertura. Quedó en pagar mañana.'),
      (3, 'nota', 'Cliente manifiesta problemas de efectivo. Solicita pasar a cobertura básica.')
    `);

    // Agenda
    await run(`INSERT INTO agenda (cliente_id, titulo, descripcion, fecha_vencimiento, tipo, completado) VALUES
      (1, 'Renovación Póliza Corolla', 'Póliza POL-TOY-8921 vence pronto. Contactar para renovar.', '${format(fin1)}', 'renovacion', 0),
      (3, 'Llamar por deuda cuota 3 y 4', 'Póliza suspendida. Llamar urgente antes de baja definitiva.', '${format(sumarDias(hoy, 2))}', 'llamada', 0),
      (2, 'Reunión entrega de cheque siniestro', 'Entregar orden de reparación en taller mecánico oficial.', '${format(sumarDias(hoy, 4))}', 'reunion', 0),
      (null, 'Revisar comisiones pendientes Sancor', 'Controlar planilla de comisiones del mes anterior.', '${format(sumarDias(hoy, 1))}', 'recordatorio', 0)
    `);

    // Comisiones
    const perAct = hoy.toISOString().substring(0, 7);
    const fechaAnt = restarDias(hoy, 30);
    const perAnt = fechaAnt.toISOString().substring(0, 7);

    await run(`INSERT INTO comisiones (poliza_id, compania, monto_poliza, tasa_comision, monto_comision, estado_pago, periodo) VALUES
      (1, 'Sancor Seguros', 10000.00, 0.15, 1500.00, 'pagado', '${perAnt}'),
      (1, 'Sancor Seguros', 10000.00, 0.15, 1500.00, 'pendiente', '${perAct}'),
      (2, 'El Norte Seguros', 15000.00, 0.18, 2700.00, 'pagado', '${perAnt}'),
      (2, 'El Norte Seguros', 15000.00, 0.18, 2700.00, 'pendiente', '${perAct}'),
      (3, 'Federación Patronal', 7000.00, 0.20, 1400.00, 'pagado', '${perAnt}')
    `);

    await run('COMMIT');
    console.log('Datos semilla insertados con éxito.');
  } catch (err) {
    await run('ROLLBACK');
    console.error('Error al insertar datos semilla:', err);
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
