require('dotenv').config();

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function readBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function resolveConnectionString() {
  const raw = process.env.NODE_ENV === 'test'
    ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || null)
    : (process.env.DATABASE_URL
      || process.env.INTERNAL_DATABASE_URL
      || process.env.EXTERNAL_DATABASE_URL
      || process.env.POSTGRES_URL
      || process.env.POSTGRESQL_URL
      || null);

  return typeof raw === 'string' ? raw.trim() : null;
}

function buildPoolConfig() {
  const connectionString = resolveConnectionString();
  const host = process.env.PGHOST || process.env.PG_HOST || null;

  if (process.env.NODE_ENV === 'test' && !connectionString) {
    throw new Error('TEST_DATABASE_URL o DATABASE_URL es obligatorio para ejecutar pruebas de integración con PostgreSQL.');
  }

  if (!connectionString && !host) {
    throw new Error('PostgreSQL no está configurado. Defina DATABASE_URL o las variables PG_HOST/PG_USER/PG_PASSWORD/PG_DATABASE.');
  }

  const config = {
    application_name: process.env.PGAPPNAME || 'gpg-seguros',
    max: Number.parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeoutMillis: Number.parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: Number.parseInt(process.env.PG_CONNECT_TIMEOUT_MS || '10000', 10),
    statement_timeout: Number.parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '15000', 10),
    idle_in_transaction_session_timeout: Number.parseInt(process.env.PG_IDLE_TX_TIMEOUT_MS || '30000', 10),
    allowExitOnIdle: process.env.NODE_ENV === 'test',
    options: '-c timezone=America/Argentina/Buenos_Aires'
  };

  let targetHost = host;
  if (connectionString) {
    config.connectionString = connectionString;
    try {
      targetHost = new URL(connectionString).hostname;
    } catch {
      throw new Error('DATABASE_URL/TEST_DATABASE_URL no tiene un formato URL válido.');
    }
  } else {
    config.host = host;
    config.port = Number.parseInt(process.env.PGPORT || process.env.PG_PORT || '5432', 10);
    config.user = process.env.PGUSER || process.env.PG_USER;
    config.password = process.env.PGPASSWORD || process.env.PG_PASSWORD;
    config.database = process.env.PGDATABASE || process.env.PG_DATABASE;

    if (!config.user || !config.database) {
      throw new Error('PG_USER y PG_DATABASE son obligatorios cuando no se utiliza DATABASE_URL.');
    }
  }

  const isLocal = LOCAL_HOSTS.has(String(targetHost || '').toLowerCase());
  const sslEnabled = readBoolean(process.env.PGSSL || process.env.DB_SSL, !isLocal);
  if (sslEnabled) {
    config.ssl = {
      rejectUnauthorized: readBoolean(process.env.PGSSL_REJECT_UNAUTHORIZED, true)
    };

    if (process.env.PGSSL_CA_BASE64) {
      config.ssl.ca = Buffer.from(process.env.PGSSL_CA_BASE64, 'base64').toString('utf8');
    }
  }

  return config;
}

function describeDatabaseTarget() {
  const connectionString = resolveConnectionString();
  if (connectionString) {
    try {
      const parsed = new URL(connectionString);
      return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
    } catch {
      return 'URL de PostgreSQL configurada';
    }
  }

  const host = process.env.PGHOST || process.env.PG_HOST || 'sin-host';
  const port = process.env.PGPORT || process.env.PG_PORT || '5432';
  const database = process.env.PGDATABASE || process.env.PG_DATABASE || 'sin-base';
  return `${host}:${port}/${database}`;
}

module.exports = { buildPoolConfig, describeDatabaseTarget, resolveConnectionString };
