const { Pool } = require('pg');
const { buildPoolConfig, describeDatabaseTarget } = require('../database/config');

const checks = [
  {
    name: 'Pólizas con fechas invertidas',
    sql: 'SELECT COUNT(*)::int AS count FROM polizas WHERE fecha_vencimiento < fecha_inicio'
  },
  {
    name: 'Pólizas con importes negativos',
    sql: 'SELECT COUNT(*)::int AS count FROM polizas WHERE monto_total < 0 OR valor_cuota < 0'
  },
  {
    name: 'Pólizas duplicadas por número y renovación',
    sql: `SELECT COUNT(*)::int AS count FROM (
      SELECT numero_poliza, numero_renovacion FROM polizas
      GROUP BY numero_poliza, numero_renovacion HAVING COUNT(*) > 1
    ) duplicates`
  },
  {
    name: 'Clientes duplicados por DNI/CUIT normalizado',
    sql: `SELECT COUNT(*)::int AS count FROM (
      SELECT REGEXP_REPLACE(dni_cuit, '[^0-9]', '', 'g') normalized FROM clientes
      GROUP BY normalized HAVING COUNT(*) > 1
    ) duplicates`
  },
  {
    name: 'Usuarios duplicados ignorando mayúsculas y espacios',
    sql: `SELECT COUNT(*)::int AS count FROM (
      SELECT LOWER(BTRIM(usuario)) normalized FROM usuarios
      GROUP BY normalized HAVING COUNT(*) > 1
    ) duplicates`
  },
  {
    name: 'Comisiones duplicadas por póliza',
    sql: `SELECT COUNT(*)::int AS count FROM (
      SELECT poliza_id FROM comisiones GROUP BY poliza_id HAVING COUNT(*) > 1
    ) duplicates`
  },
  {
    name: 'Comisiones o tasas fuera del rango 0..1',
    sql: `SELECT
      (SELECT COUNT(*) FROM comisiones WHERE tasa_comision < 0 OR tasa_comision > 1)
      + (SELECT COUNT(*) FROM tasas_comision WHERE tasa < 0 OR tasa > 1) AS count`
  },
  {
    name: 'Cuotas con importes o numeración inválida',
    sql: `SELECT COUNT(*)::int AS count FROM cuotas_cobranza
      WHERE monto < 0 OR total_cuotas <= 0 OR numero_cuota < 1 OR numero_cuota > total_cuotas`
  },
  {
    name: 'Adjuntos sin un único propietario',
    sql: `SELECT COUNT(*)::int AS count FROM adjuntos
      WHERE num_nonnulls(cliente_id, poliza_id, siniestro_id) <> 1`
  },
  {
    name: 'Referencias huérfanas',
    sql: `SELECT
      (SELECT COUNT(*) FROM vehiculos v WHERE NOT EXISTS (SELECT 1 FROM clientes c WHERE c.id = v.cliente_id))
      + (SELECT COUNT(*) FROM polizas p WHERE NOT EXISTS (SELECT 1 FROM clientes c WHERE c.id = p.cliente_id))
      + (SELECT COUNT(*) FROM comisiones c WHERE NOT EXISTS (SELECT 1 FROM polizas p WHERE p.id = c.poliza_id))
      + (SELECT COUNT(*) FROM cuotas_cobranza q WHERE NOT EXISTS (SELECT 1 FROM polizas p WHERE p.id = q.poliza_id)) AS count`
  }
];

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`]);
  return result.rows[0].exists;
}

async function main() {
  const pool = new Pool(buildPoolConfig());
  const client = await pool.connect();
  let failed = false;
  try {
    console.log(`[DB Preflight]: ${describeDatabaseTarget()}`);
    if (!(await tableExists(client, 'usuarios'))) {
      console.log('[DB Preflight]: base nueva; no hay datos existentes que validar.');
      return;
    }

    await client.query('BEGIN TRANSACTION READ ONLY');
    for (const check of checks) {
      const result = await client.query(check.sql);
      const count = Number(result.rows[0].count || 0);
      const status = count === 0 ? 'OK' : `REVISAR (${count})`;
      console.log(`- ${status}: ${check.name}`);
      if (count > 0) failed = true;
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  if (failed) {
    throw new Error('El preflight detectó datos incompatibles con las nuevas restricciones. Corríjalos antes de migrar.');
  }
}

main().catch(error => {
  console.error(`[DB Preflight Error]: ${error.message}`);
  process.exitCode = 1;
});
