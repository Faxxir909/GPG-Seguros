-- Endurece instalaciones existentes y agrega auditoría e índices de búsqueda.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE polizas ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE siniestros ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tasas_comision ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE cuotas_cobranza ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION gpg_set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_clientes ON clientes;
DROP FUNCTION IF EXISTS trigger_set_timestamp();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'usuarios','clientes','vehiculos','polizas','cotizaciones','siniestros',
    'agenda','comisiones','tasas_comision','cuotas_cobranza'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_actualizado_en ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_actualizado_en BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION gpg_set_actualizado_en()',
      table_name, table_name
    );
  END LOOP;
END $$;

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

CREATE OR REPLACE FUNCTION gpg_auditar_cambio()
RETURNS TRIGGER AS $$
DECLARE
  old_json JSONB;
  new_json JSONB;
  changed TEXT[];
  actor_setting TEXT;
  actor_id INTEGER;
  req_id TEXT;
  row_id TEXT;
BEGIN
  old_json := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) - 'password' ELSE NULL END;
  new_json := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) - 'password' ELSE NULL END;

  IF TG_OP = 'UPDATE' THEN
    SELECT ARRAY_AGG(key ORDER BY key)
      INTO changed
      FROM JSONB_EACH(new_json)
     WHERE value IS DISTINCT FROM old_json -> key;
  END IF;

  actor_setting := current_setting('app.usuario_id', TRUE);
  IF actor_setting ~ '^\d+$' THEN actor_id := actor_setting::INTEGER; END IF;
  req_id := NULLIF(current_setting('app.request_id', TRUE), '');
  row_id := COALESCE(new_json ->> 'id', old_json ->> 'id');

  INSERT INTO auditoria_eventos (
    tabla, registro_id, accion, datos_anteriores, datos_nuevos,
    campos_cambiados, usuario_id, request_id
  ) VALUES (
    TG_TABLE_NAME, row_id, TG_OP, old_json, new_json,
    changed, actor_id, req_id
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION gpg_auditoria_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'auditoria_eventos es append-only: no se permiten UPDATE ni DELETE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_append_only ON auditoria_eventos;
CREATE TRIGGER trg_auditoria_append_only
BEFORE UPDATE OR DELETE ON auditoria_eventos
FOR EACH ROW EXECUTE FUNCTION gpg_auditoria_append_only();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'usuarios','clientes','vehiculos','polizas','cotizaciones','siniestros',
    'agenda','crm_logs','comisiones','adjuntos','tasas_comision','cuotas_cobranza'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_auditoria ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION gpg_auditar_cambio()',
      table_name, table_name
    );
  END LOOP;
END $$;

DO $$ BEGIN
  ALTER TABLE polizas ADD CONSTRAINT polizas_fechas_check CHECK (fecha_vencimiento >= fecha_inicio);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE polizas ADD CONSTRAINT polizas_monto_check CHECK (monto_total >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE polizas ADD CONSTRAINT polizas_cuota_check CHECK (valor_cuota >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_monto_check CHECK (monto_total IS NULL OR monto_total >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_cuota_check CHECK (valor_cuota IS NULL OR valor_cuota >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE comisiones ADD CONSTRAINT comisiones_tasa_check CHECK (tasa_comision BETWEEN 0 AND 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE comisiones ADD CONSTRAINT comisiones_monto_check CHECK (monto_comision >= 0 AND monto_poliza >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE comisiones ADD CONSTRAINT comisiones_periodo_check CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tasas_comision ADD CONSTRAINT tasas_comision_tasa_check CHECK (tasa BETWEEN 0 AND 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE cuotas_cobranza ADD CONSTRAINT cuotas_monto_check CHECK (monto >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE cuotas_cobranza ADD CONSTRAINT cuotas_numeracion_check CHECK (total_cuotas > 0 AND numero_cuota BETWEEN 1 AND total_cuotas);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_unico_padre_check CHECK (num_nonnulls(cliente_id, poliza_id, siniestro_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Las bajas de entidades principales deben ser explícitas. Se evita que una
-- eliminación accidental borre en cascada el historial contable o documental.
ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS vehiculos_cliente_id_fkey;
ALTER TABLE vehiculos ADD CONSTRAINT vehiculos_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT;
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_cliente_id_fkey;
ALTER TABLE polizas ADD CONSTRAINT polizas_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT;
ALTER TABLE polizas DROP CONSTRAINT IF EXISTS polizas_vehiculo_id_fkey;
ALTER TABLE polizas ADD CONSTRAINT polizas_vehiculo_id_fkey
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE SET NULL;
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_cliente_id_fkey;
ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT;
ALTER TABLE cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_vehiculo_id_fkey;
ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_vehiculo_id_fkey
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE SET NULL;
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_cliente_id_fkey;
ALTER TABLE siniestros ADD CONSTRAINT siniestros_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT;
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_vehiculo_id_fkey;
ALTER TABLE siniestros ADD CONSTRAINT siniestros_vehiculo_id_fkey
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE SET NULL;
ALTER TABLE siniestros DROP CONSTRAINT IF EXISTS siniestros_poliza_id_fkey;
ALTER TABLE siniestros ADD CONSTRAINT siniestros_poliza_id_fkey
  FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE SET NULL;
ALTER TABLE agenda DROP CONSTRAINT IF EXISTS agenda_cliente_id_fkey;
ALTER TABLE agenda ADD CONSTRAINT agenda_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE crm_logs DROP CONSTRAINT IF EXISTS crm_logs_cliente_id_fkey;
ALTER TABLE crm_logs ADD CONSTRAINT crm_logs_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT;
ALTER TABLE comisiones DROP CONSTRAINT IF EXISTS comisiones_poliza_id_fkey;
ALTER TABLE comisiones ADD CONSTRAINT comisiones_poliza_id_fkey
  FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE RESTRICT;
ALTER TABLE adjuntos DROP CONSTRAINT IF EXISTS adjuntos_cliente_id_fkey;
ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT;
ALTER TABLE adjuntos DROP CONSTRAINT IF EXISTS adjuntos_poliza_id_fkey;
ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_poliza_id_fkey
  FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE RESTRICT;
ALTER TABLE adjuntos DROP CONSTRAINT IF EXISTS adjuntos_siniestro_id_fkey;
ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_siniestro_id_fkey
  FOREIGN KEY (siniestro_id) REFERENCES siniestros(id) ON DELETE RESTRICT;
ALTER TABLE cuotas_cobranza DROP CONSTRAINT IF EXISTS cuotas_cobranza_poliza_id_fkey;
ALTER TABLE cuotas_cobranza ADD CONSTRAINT cuotas_cobranza_poliza_id_fkey
  FOREIGN KEY (poliza_id) REFERENCES polizas(id) ON DELETE RESTRICT;

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
CREATE UNIQUE INDEX IF NOT EXISTS comisiones_poliza_uq ON comisiones (poliza_id);
CREATE INDEX IF NOT EXISTS idx_adjuntos_cliente_fecha ON adjuntos (cliente_id, fecha_subida DESC) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adjuntos_poliza ON adjuntos (poliza_id) WHERE poliza_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adjuntos_siniestro ON adjuntos (siniestro_id) WHERE siniestro_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalogo_marca_modelo ON catalogo_vehiculos (marca, modelo);
CREATE INDEX IF NOT EXISTS idx_tasas_comision_busqueda ON tasas_comision (compania, tipo_cobertura) WHERE activa;
CREATE INDEX IF NOT EXISTS idx_cuotas_estado_vencimiento ON cuotas_cobranza (estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_registro ON auditoria_eventos (tabla, registro_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria_eventos (creado_en DESC);

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm no fue habilitada por falta de permisos; se mantienen los índices B-tree.';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clientes_nombre_trgm ON clientes USING GIN (nombre gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_polizas_numero_trgm ON polizas USING GIN (numero_poliza gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_polizas_compania_trgm ON polizas USING GIN (compania gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehiculos_patente_trgm ON vehiculos USING GIN (patente gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehiculos_motor_trgm ON vehiculos USING GIN (motor gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_siniestros_descripcion_trgm ON siniestros USING GIN (descripcion gin_trgm_ops)';
  END IF;
END $$;
