-- =============================================================
-- GPG SEGUROS - Schema PostgreSQL 18
-- =============================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- 1. USUARIOS
CREATE TABLE IF NOT EXISTS usuarios (
    id         SERIAL PRIMARY KEY,
    usuario    TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    rol        TEXT NOT NULL CHECK (rol IN ('admin', 'productor', 'administrativo')),
    nombre     TEXT NOT NULL,
    creado_en  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLIENTES
CREATE TABLE IF NOT EXISTS clientes (
    id               SERIAL PRIMARY KEY,
    nombre           TEXT NOT NULL,
    dni_cuit         TEXT UNIQUE NOT NULL,
    fecha_nacimiento DATE,
    telefono         TEXT,
    email            TEXT,
    direccion        TEXT,
    localidad        TEXT,
    provincia        TEXT,
    observaciones    TEXT,
    estado           TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    riesgo_baja      BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en        TIMESTAMPTZ DEFAULT NOW(),
    actualizado_en   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. VEHICULOS
CREATE TABLE IF NOT EXISTS vehiculos (
    id         SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    marca      TEXT NOT NULL,
    modelo     TEXT NOT NULL,
    version    TEXT,
    anio       SMALLINT,
    patente    TEXT,
    chasis     TEXT,
    motor      TEXT,
    uso        TEXT CHECK (uso IN ('particular', 'comercial')),
    creado_en  TIMESTAMPTZ DEFAULT NOW()
);

-- 4. POLIZAS
CREATE TABLE IF NOT EXISTS polizas (
    id                SERIAL PRIMARY KEY,
    numero_poliza     TEXT NOT NULL,
    numero_renovacion INTEGER NOT NULL DEFAULT 0,
    fecha_inicio      DATE NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    cobertura         TEXT NOT NULL,
    estado            TEXT NOT NULL CHECK (estado IN ('vigente', 'vencida', 'suspendida')),
    monto_total       NUMERIC(12,2) NOT NULL,
    valor_cuota       NUMERIC(12,2) NOT NULL,
    forma_pago        TEXT NOT NULL,
    compania          TEXT NOT NULL,
    cliente_id        INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    vehiculo_id       INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (numero_poliza, numero_renovacion)
);

-- 5. COTIZACIONES
CREATE TABLE IF NOT EXISTS cotizaciones (
    id             SERIAL PRIMARY KEY,
    cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    vehiculo_id    INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    compania       TEXT NOT NULL,
    cobertura      TEXT NOT NULL,
    monto_total    NUMERIC(12,2),
    valor_cuota    NUMERIC(12,2),
    estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviada', 'aceptada', 'rechazada')),
    notas          TEXT,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SINIESTROS
CREATE TABLE IF NOT EXISTS siniestros (
    id               SERIAL PRIMARY KEY,
    numero_siniestro TEXT UNIQUE,
    cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    vehiculo_id      INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    poliza_id        INTEGER REFERENCES polizas(id) ON DELETE SET NULL,
    fecha            DATE NOT NULL,
    descripcion      TEXT NOT NULL,
    estado           TEXT NOT NULL DEFAULT 'denunciado' CHECK (estado IN ('denunciado', 'en_proceso', 'doc_pendiente', 'resuelto')),
    creado_en        TIMESTAMPTZ DEFAULT NOW()
);

-- 7. AGENDA
CREATE TABLE IF NOT EXISTS agenda (
    id                SERIAL PRIMARY KEY,
    cliente_id        INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    titulo            TEXT NOT NULL,
    descripcion       TEXT,
    fecha_vencimiento DATE NOT NULL,
    tipo              TEXT NOT NULL CHECK (tipo IN ('llamada', 'reunion', 'recordatorio', 'renovacion')),
    completado        BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en         TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CRM_LOGS
CREATE TABLE IF NOT EXISTS crm_logs (
    id             SERIAL PRIMARY KEY,
    cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo_contacto  TEXT NOT NULL CHECK (tipo_contacto IN ('llamada', 'whatsapp', 'email', 'nota')),
    descripcion    TEXT NOT NULL,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

-- 9. COMISIONES
CREATE TABLE IF NOT EXISTS comisiones (
    id             SERIAL PRIMARY KEY,
    poliza_id      INTEGER NOT NULL REFERENCES polizas(id) ON DELETE CASCADE,
    compania       TEXT NOT NULL,
    monto_poliza   NUMERIC(12,2) NOT NULL,
    tasa_comision  NUMERIC(5,4) NOT NULL,
    monto_comision NUMERIC(12,2) NOT NULL,
    estado_pago    TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_pago IN ('pendiente', 'pagado')),
    periodo        TEXT NOT NULL,
    creado_en      TIMESTAMPTZ DEFAULT NOW()
);

-- 10. ADJUNTOS
CREATE TABLE IF NOT EXISTS adjuntos (
    id             SERIAL PRIMARY KEY,
    cliente_id     INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    poliza_id      INTEGER REFERENCES polizas(id) ON DELETE CASCADE,
    siniestro_id   INTEGER REFERENCES siniestros(id) ON DELETE CASCADE,
    nombre_archivo TEXT NOT NULL,
    ruta_archivo   TEXT NOT NULL,
    tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('dni','cedula','licencia','afip','pdf','foto','denuncia','formulario','otro')),
    fecha_subida   TIMESTAMPTZ DEFAULT NOW()
);

-- 11. CATALOGO_VEHICULOS
CREATE TABLE IF NOT EXISTS catalogo_vehiculos (
    id      SERIAL PRIMARY KEY,
    marca   TEXT NOT NULL,
    modelo  TEXT NOT NULL,
    version TEXT NOT NULL,
    UNIQUE (marca, modelo, version)
);

-- INDICES
CREATE INDEX IF NOT EXISTS idx_clientes_estado       ON clientes(estado);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre       ON clientes(nombre);
CREATE INDEX IF NOT EXISTS idx_clientes_dni_cuit     ON clientes(dni_cuit);
CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente_id  ON vehiculos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_polizas_cliente_id    ON polizas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_polizas_vehiculo_id   ON polizas(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_polizas_estado        ON polizas(estado);
CREATE INDEX IF NOT EXISTS idx_polizas_vencimiento   ON polizas(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_polizas_inicio        ON polizas(fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente  ON cotizaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_vehiculo ON cotizaciones(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado   ON cotizaciones(estado);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha    ON cotizaciones(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_siniestros_cliente    ON siniestros(cliente_id);
CREATE INDEX IF NOT EXISTS idx_siniestros_vehiculo   ON siniestros(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_siniestros_poliza     ON siniestros(poliza_id);
CREATE INDEX IF NOT EXISTS idx_siniestros_estado     ON siniestros(estado);
CREATE INDEX IF NOT EXISTS idx_siniestros_fecha      ON siniestros(fecha);
CREATE INDEX IF NOT EXISTS idx_agenda_cliente        ON agenda(cliente_id);
CREATE INDEX IF NOT EXISTS idx_agenda_vencimiento    ON agenda(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_crm_logs_cliente      ON crm_logs(cliente_id);
CREATE INDEX IF NOT EXISTS idx_crm_logs_fecha        ON crm_logs(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_comisiones_poliza     ON comisiones(poliza_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_periodo    ON comisiones(periodo, compania);
CREATE INDEX IF NOT EXISTS idx_adjuntos_cliente      ON adjuntos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_adjuntos_poliza       ON adjuntos(poliza_id);
CREATE INDEX IF NOT EXISTS idx_adjuntos_siniestro    ON adjuntos(siniestro_id);
CREATE INDEX IF NOT EXISTS idx_catalogo_marca        ON catalogo_vehiculos(marca);
CREATE INDEX IF NOT EXISTS idx_catalogo_marca_modelo ON catalogo_vehiculos(marca, modelo);

-- TRIGGER timestamp automatico en clientes
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_clientes ON clientes;
CREATE TRIGGER set_timestamp_clientes
BEFORE UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
