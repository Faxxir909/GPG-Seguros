-- 003_concurrency_and_integrity.sql
-- Garantiza la inmutabilidad de la auditoría (append-only estricto),
-- validaciones adicionales de integridad y optimizaciones de concurrencia.

-- 1. Prohibición estricta de UPDATE y DELETE sobre auditoria_eventos
CREATE OR REPLACE FUNCTION gpg_proteger_auditoria_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La tabla auditoria_eventos es estrictamente append-only y no admite modificaciones ni eliminaciones.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_append_only ON auditoria_eventos;
CREATE TRIGGER trg_auditoria_append_only
BEFORE UPDATE OR DELETE ON auditoria_eventos
FOR EACH ROW EXECUTE FUNCTION gpg_proteger_auditoria_append_only();

-- 2. Restricción de estados válidos en cotizaciones
DO $$ BEGIN
  ALTER TABLE cotizaciones ADD CONSTRAINT cotizaciones_estado_check
  CHECK (estado IN ('pendiente', 'enviada', 'aceptada', 'rechazada'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Asegurar que las rutas de adjuntos no estén vacías
DO $$ BEGIN
  ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_rutas_validas_check
  CHECK (length(btrim(nombre_archivo)) > 0 AND length(btrim(ruta_archivo)) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Índice para evitar carreras en renovación de pólizas
CREATE INDEX IF NOT EXISTS idx_polizas_numero_renovacion_asc
ON polizas (numero_poliza, numero_renovacion DESC);
