-- Esquema base PostgreSQL para una instalación de GPG Seguros.
-- Las migraciones son la única fuente de verdad del esquema.

CREATE TABLE IF NOT EXISTS usuarios (
    id              SERIAL PRIMARY KEY,
    usuario         TEXT NOT NULL,
    password        TEXT NOT NULL,
    rol             TEXT NOT NULL CONSTRAINT usuarios_rol_check
                    CHECK (rol IN ('admin', 'productor', 'administrativo')),
    nombre          TEXT NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso   TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clientes (
    id               SERIAL PRIMARY KEY,
    nombre           TEXT NOT NULL,
    dni_cuit         TEXT NOT NULL,
    fecha_nacimiento DATE,
    telefono         TEXT,
    email            TEXT,
    direccion        TEXT,
    localidad        TEXT,
    provincia        TEXT,
    observaciones    TEXT,
    estado           TEXT NOT NULL DEFAULT 'activo' CONSTRAINT clientes_estado_check
                     CHECK (estado IN ('activo', 'inactivo')),
    riesgo_baja      BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehiculos (
    id               SERIAL PRIMARY KEY,
    cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    marca            TEXT NOT NULL,
    modelo           TEXT NOT NULL,
    version          TEXT,
    anio             SMALLINT CONSTRAINT vehiculos_anio_check CHECK (anio IS NULL OR anio BETWEEN 1886 AND 2100),
    patente          TEXT,
    chasis           TEXT,
    motor            TEXT,
    uso              TEXT CONSTRAINT vehiculos_uso_check CHECK (uso IS NULL OR uso IN ('particular', 'comercial')),
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS polizas (
    id                SERIAL PRIMARY KEY,
    numero_poliza     TEXT NOT NULL,
    numero_renovacion INTEGER NOT NULL DEFAULT 0 CONSTRAINT polizas_renovacion_check CHECK (numero_renovacion >= 0),
    fecha_inicio      DATE NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    cobertura         TEXT NOT NULL,
    estado            TEXT NOT NULL CONSTRAINT polizas_estado_check
                      CHECK (estado IN ('vigente', 'vencida', 'suspendida')),
    monto_total       NUMERIC(14,2) NOT NULL CONSTRAINT polizas_monto_check CHECK (monto_total >= 0),
    valor_cuota       NUMERIC(14,2) NOT NULL CONSTRAINT polizas_cuota_check CHECK (valor_cuota >= 0),
    forma_pago        TEXT NOT NULL,
    compania          TEXT NOT NULL,
    cliente_id        INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    vehiculo_id       INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT polizas_fechas_check CHECK (fecha_vencimiento >= fecha_inicio),
    CONSTRAINT polizas_numero_renovacion_uq UNIQUE (numero_poliza, numero_renovacion)
);

CREATE TABLE IF NOT EXISTS cotizaciones (
    id               SERIAL PRIMARY KEY,
    cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    vehiculo_id      INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    compania         TEXT NOT NULL,
    cobertura        TEXT NOT NULL,
    monto_total      NUMERIC(14,2) CONSTRAINT cotizaciones_monto_check CHECK (monto_total IS NULL OR monto_total >= 0),
    valor_cuota      NUMERIC(14,2) CONSTRAINT cotizaciones_cuota_check CHECK (valor_cuota IS NULL OR valor_cuota >= 0),
    estado           TEXT NOT NULL DEFAULT 'pendiente' CONSTRAINT cotizaciones_estado_check
                     CHECK (estado IN ('pendiente', 'enviada', 'aceptada', 'rechazada')),
    notas            TEXT,
    fecha_creacion   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS siniestros (
    id               SERIAL PRIMARY KEY,
    numero_siniestro TEXT UNIQUE,
    cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    vehiculo_id      INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    poliza_id        INTEGER REFERENCES polizas(id) ON DELETE SET NULL,
    fecha            DATE NOT NULL,
    descripcion      TEXT NOT NULL,
    estado           TEXT NOT NULL DEFAULT 'denunciado' CONSTRAINT siniestros_estado_check
                     CHECK (estado IN ('denunciado', 'en_proceso', 'doc_pendiente', 'resuelto')),
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agenda (
    id                SERIAL PRIMARY KEY,
    cliente_id        INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    titulo            TEXT NOT NULL,
    descripcion       TEXT,
    fecha_vencimiento DATE NOT NULL,
    tipo              TEXT NOT NULL CONSTRAINT agenda_tipo_check
                      CHECK (tipo IN ('llamada', 'reunion', 'recordatorio', 'renovacion')),
    completado        BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_logs (
    id             SERIAL PRIMARY KEY,
    cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    tipo_contacto  TEXT NOT NULL CONSTRAINT crm_logs_tipo_check
                   CHECK (tipo_contacto IN ('llamada', 'whatsapp', 'email', 'nota')),
    descripcion    TEXT NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comisiones (
    id              SERIAL PRIMARY KEY,
    poliza_id       INTEGER NOT NULL REFERENCES polizas(id) ON DELETE RESTRICT,
    compania        TEXT NOT NULL,
    monto_poliza    NUMERIC(14,2) NOT NULL CONSTRAINT comisiones_monto_poliza_check CHECK (monto_poliza >= 0),
    tasa_comision   NUMERIC(7,6) NOT NULL CONSTRAINT comisiones_tasa_check CHECK (tasa_comision BETWEEN 0 AND 1),
    monto_comision  NUMERIC(14,2) NOT NULL CONSTRAINT comisiones_monto_check CHECK (monto_comision >= 0),
    estado_pago     TEXT NOT NULL DEFAULT 'pendiente' CONSTRAINT comisiones_estado_check
                    CHECK (estado_pago IN ('pendiente', 'pagado')),
    periodo         TEXT NOT NULL CONSTRAINT comisiones_periodo_check
                    CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT comisiones_poliza_uq UNIQUE (poliza_id)
);

CREATE TABLE IF NOT EXISTS adjuntos (
    id              SERIAL PRIMARY KEY,
    cliente_id      INTEGER REFERENCES clientes(id) ON DELETE RESTRICT,
    poliza_id       INTEGER REFERENCES polizas(id) ON DELETE RESTRICT,
    siniestro_id    INTEGER REFERENCES siniestros(id) ON DELETE RESTRICT,
    nombre_archivo  TEXT NOT NULL,
    ruta_archivo    TEXT NOT NULL,
    tipo_documento  TEXT NOT NULL CONSTRAINT adjuntos_tipo_check
                    CHECK (tipo_documento IN ('dni','cedula','licencia','afip','pdf','foto','denuncia','formulario','otro')),
    fecha_subida    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT adjuntos_unico_padre_check CHECK (num_nonnulls(cliente_id, poliza_id, siniestro_id) = 1)
);

CREATE TABLE IF NOT EXISTS catalogo_vehiculos (
    id      SERIAL PRIMARY KEY,
    marca   TEXT NOT NULL,
    modelo  TEXT NOT NULL,
    version TEXT NOT NULL,
    CONSTRAINT catalogo_vehiculos_uq UNIQUE (marca, modelo, version)
);

CREATE TABLE IF NOT EXISTS tasas_comision (
    id              SERIAL PRIMARY KEY,
    compania        TEXT NOT NULL,
    tipo_cobertura  TEXT NOT NULL DEFAULT '*',
    tasa            NUMERIC(7,6) NOT NULL CONSTRAINT tasas_comision_tasa_check CHECK (tasa BETWEEN 0 AND 1),
    descripcion     TEXT,
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tasas_comision_uq UNIQUE (compania, tipo_cobertura)
);

CREATE TABLE IF NOT EXISTS cuotas_cobranza (
    id                SERIAL PRIMARY KEY,
    poliza_id         INTEGER NOT NULL REFERENCES polizas(id) ON DELETE RESTRICT,
    numero_cuota      INTEGER NOT NULL,
    total_cuotas      INTEGER NOT NULL DEFAULT 12,
    fecha_vencimiento DATE NOT NULL,
    monto             NUMERIC(14,2) NOT NULL CONSTRAINT cuotas_monto_check CHECK (monto >= 0),
    estado            TEXT NOT NULL DEFAULT 'pendiente' CONSTRAINT cuotas_estado_check
                      CHECK (estado IN ('pagada', 'pendiente', 'en_mora', 'anulada')),
    fecha_pago        DATE,
    forma_pago        TEXT,
    notas             TEXT,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cuotas_numeracion_check CHECK (total_cuotas > 0 AND numero_cuota BETWEEN 1 AND total_cuotas),
    CONSTRAINT cuotas_poliza_numero_uq UNIQUE (poliza_id, numero_cuota)
);

CREATE TABLE IF NOT EXISTS auditoria_eventos (
    id               BIGSERIAL PRIMARY KEY,
    tabla            TEXT NOT NULL,
    registro_id      TEXT,
    accion           TEXT NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE')),
    datos_anteriores JSONB,
    datos_nuevos     JSONB,
    campos_cambiados TEXT[],
    usuario_id       INTEGER,
    request_id       TEXT,
    usuario_db       TEXT NOT NULL DEFAULT CURRENT_USER,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_usuario_normalizado_uq ON usuarios (LOWER(BTRIM(usuario)));
CREATE UNIQUE INDEX IF NOT EXISTS clientes_dni_normalizado_uq ON clientes (REGEXP_REPLACE(dni_cuit, '[^0-9]', '', 'g'));
CREATE INDEX IF NOT EXISTS idx_clientes_estado_nombre ON clientes (estado, nombre);
CREATE INDEX IF NOT EXISTS idx_clientes_email_lower ON clientes (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente ON vehiculos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_vehiculos_patente_upper ON vehiculos (UPPER(patente)) WHERE patente IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehiculos_chasis_upper ON vehiculos (UPPER(chasis)) WHERE chasis IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_polizas_cliente_vencimiento ON polizas (cliente_id, fecha_vencimiento DESC);
CREATE INDEX IF NOT EXISTS idx_polizas_vehiculo ON polizas (vehiculo_id) WHERE vehiculo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_polizas_estado_vencimiento ON polizas (estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_polizas_compania ON polizas (compania);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_fecha ON cotizaciones (cliente_id, fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado_fecha ON cotizaciones (estado, fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_siniestros_cliente_fecha ON siniestros (cliente_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_siniestros_estado_fecha ON siniestros (estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_siniestros_poliza ON siniestros (poliza_id) WHERE poliza_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_pendiente_fecha ON agenda (completado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_crm_logs_cliente_fecha ON crm_logs (cliente_id, fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_comisiones_periodo_estado ON comisiones (periodo DESC, estado_pago);
CREATE INDEX IF NOT EXISTS idx_adjuntos_cliente_fecha ON adjuntos (cliente_id, fecha_subida DESC) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adjuntos_poliza ON adjuntos (poliza_id) WHERE poliza_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adjuntos_siniestro ON adjuntos (siniestro_id) WHERE siniestro_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalogo_marca_modelo ON catalogo_vehiculos (marca, modelo);
CREATE INDEX IF NOT EXISTS idx_tasas_comision_busqueda ON tasas_comision (compania, tipo_cobertura) WHERE activa;
CREATE INDEX IF NOT EXISTS idx_cuotas_poliza_numero ON cuotas_cobranza (poliza_id, numero_cuota);
CREATE INDEX IF NOT EXISTS idx_cuotas_estado_vencimiento ON cuotas_cobranza (estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_registro ON auditoria_eventos (tabla, registro_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria_eventos (creado_en DESC);
