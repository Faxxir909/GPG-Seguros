const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATION_LOCK_ID = 724031985;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`No existe el directorio de migraciones: ${MIGRATIONS_DIR}`);
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version      TEXT PRIMARY KEY,
        checksum     TEXT NOT NULL,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_ms INTEGER NOT NULL
      )
    `);

    const appliedResult = await client.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(appliedResult.rows.map(row => [row.version, row.checksum]));

    for (const file of listMigrationFiles()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const fileChecksum = checksum(sql);
      const previousChecksum = applied.get(file);

      if (previousChecksum) {
        if (previousChecksum !== fileChecksum) {
          throw new Error(`La migración aplicada ${file} fue modificada. Cree una migración nueva en lugar de editar el historial.`);
        }
        continue;
      }

      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum, execution_ms) VALUES ($1, $2, $3)',
          [file, fileChecksum, Date.now() - startedAt]
        );
        await client.query('COMMIT');
        console.log(`[DB Migration]: aplicada ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${file}: ${error.message}`);
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    } catch {}
    client.release();
  }
}

module.exports = { runMigrations, listMigrationFiles, checksum };
