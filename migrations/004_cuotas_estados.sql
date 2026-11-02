-- 004_cuotas_estados.sql
-- Actualiza la restricción de estados en cuotas_cobranza para admitir
-- explícitamente los estados 'en_mora' y 'vencida' requeridos por la operativa.

DO $$ BEGIN
  ALTER TABLE cuotas_cobranza DROP CONSTRAINT IF EXISTS cuotas_estado_check;
  ALTER TABLE cuotas_cobranza ADD CONSTRAINT cuotas_estado_check
  CHECK (estado IN ('pagada', 'pendiente', 'en_mora', 'vencida', 'anulada'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
