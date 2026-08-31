const { Pool } = require('pg');
const { buildPoolConfig, describeDatabaseTarget } = require('../database/config');

async function main() {
  const pool = new Pool(buildPoolConfig());
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS usuario,
        current_setting('server_version') AS version,
        current_setting('TimeZone') AS timezone,
        (SELECT COUNT(*) FROM schema_migrations) AS migraciones,
        (SELECT COUNT(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated) AS constraints_sin_validar,
        (SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'O') AS triggers_deshabilitados,
        EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS busqueda_trigramas
    `);
    const info = result.rows[0];
    console.log(`[DB Doctor]: ${describeDatabaseTarget()}`);
    console.log(`- PostgreSQL: ${info.version}`);
    console.log(`- Zona horaria: ${info.timezone}`);
    console.log(`- Migraciones: ${info.migraciones}`);
    console.log(`- Restricciones sin validar: ${info.constraints_sin_validar}`);
    console.log(`- Triggers deshabilitados: ${info.triggers_deshabilitados}`);
    console.log(`- pg_trgm: ${info.busqueda_trigramas ? 'activo' : 'no disponible'}`);

    if (Number(info.constraints_sin_validar) > 0 || Number(info.triggers_deshabilitados) > 0) {
      throw new Error('La base no superó todos los controles de integridad.');
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`[DB Doctor Error]: ${error.message}`);
  process.exitCode = 1;
});
