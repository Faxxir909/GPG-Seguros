const { getRequestContext } = require('../database/request-context');

const SENSITIVE_KEYS = [
  'password', 'contrasena', 'clave', 'token', 'jwt', 'secret',
  'authorization', 'cookie', 'cookies', 'gpg_token', 'credential',
  'refreshtoken', 'accesstoken'
];

function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return email;
  const [user, domain] = email.split('@');
  const maskedUser = user.length > 2 ? `${user[0]}***${user[user.length - 1]}` : `${user[0] || ''}***`;
  const domainParts = domain.split('.');
  const maskedDomain = domainParts.length > 1
    ? `***.${domainParts[domainParts.length - 1]}`
    : '***';
  return `${maskedUser}@${maskedDomain}`;
}

function maskDniCuit(val) {
  if (typeof val !== 'string' && typeof val !== 'number') return val;
  const str = String(val).replace(/[^0-9]/g, '');
  if (str.length < 6) return '***';
  return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

function redact(obj, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Si contiene un JWT evidente
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(obj) && obj.length > 50) {
      return '[REDACTED_JWT]';
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redact(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some(k => lowerKey.includes(k))) {
        clean[key] = '[REDACTED]';
      } else if (lowerKey.includes('email')) {
        clean[key] = typeof value === 'string' ? maskEmail(value) : '[REDACTED_EMAIL]';
      } else if (lowerKey.includes('dni') || lowerKey.includes('cuit')) {
        clean[key] = maskDniCuit(value);
      } else {
        clean[key] = redact(value, depth + 1);
      }
    }
    return clean;
  }

  return obj;
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')] ?? 1;

function formatLog(level, message, meta = {}) {
  const ctx = getRequestContext();
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    requestId: meta.requestId || ctx?.requestId || null,
    userId: meta.userId || ctx?.userId || null,
    message: typeof message === 'string' ? message : String(message),
    ...(Object.keys(meta).length > 0 ? { meta: redact(meta) } : {})
  };
  return JSON.stringify(entry);
}

const logger = {
  debug(message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.debug) {
      console.log(formatLog('debug', message, meta));
    }
  },
  info(message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.info) {
      console.log(formatLog('info', message, meta));
    }
  },
  warn(message, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.warn) {
      console.warn(formatLog('warn', message, meta));
    }
  },
  error(message, errOrMeta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.error) {
      let meta = {};
      if (errOrMeta instanceof Error) {
        meta = {
          errorMessage: errOrMeta.message,
          stack: errOrMeta.stack,
          status: errOrMeta.status || 500
        };
      } else if (errOrMeta) {
        meta = errOrMeta;
      }
      console.error(formatLog('error', message, meta));
    }
  },
  redact,
  maskEmail,
  maskDniCuit
};

function requestLoggingMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const isError = res.statusCode >= 400;
    const logFn = res.statusCode >= 500 ? logger.error : (res.statusCode >= 400 ? logger.warn : logger.info);

    logFn(`${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${duration}ms)`, {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip
    });
  });
  next();
}

module.exports = {
  logger,
  requestLoggingMiddleware
};
