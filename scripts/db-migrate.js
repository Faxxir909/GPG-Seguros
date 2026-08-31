const { Pool } = require('pg');
const { buildPoolConfig, describeDatabaseTarget } = require('../database/config');
const { runMigrations } = require('../database/migrate');

async function main() {
  const pool = new Pool(buildPoolConfig());
  try {
    console.log(`[DB Migrate]: ${describeDatabaseTarget()}`);
    await runMigrations(pool);
    const result = await pool.query(`
      SELECT COUNT(*)::int AS total,
             MAX(applied_at) AS ultima_migracion
      FROM schema_migrations
    `);
    console.log(`[DB Migrate]: ${result.rows[0].total} migraciones aplicadas.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`[DB Migrate Error]: ${error.message}`);
  process.exitCode = 1;
});
