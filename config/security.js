require('dotenv').config();

const INSECURE_DEFAULT_SECRET = 'gpg_seguros_secret_key_12345';
const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'];

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === INSECURE_DEFAULT_SECRET || secret.length < 32) {
    throw new Error('JWT_SECRET debe estar configurado con al menos 32 caracteres y no puede usar el valor predeterminado.');
  }
  return secret;
}

function getSessionHours() {
  const hours = Number.parseInt(process.env.SESSION_TTL_HOURS || '8', 10);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    throw new Error('SESSION_TTL_HOURS debe ser un número entre 1 y 168.');
  }
  return hours;
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function getCookieSameSite() {
  const value = (process.env.COOKIE_SAMESITE || 'Lax').trim();
  const allowed = ['Lax', 'Strict', 'None'];
  if (!allowed.includes(value)) {
    return 'Lax';
  }
  return value;
}

function isCookieSecure() {
  if (process.env.COOKIE_SECURE !== undefined) {
    return process.env.COOKIE_SECURE === 'true';
  }
  return isProduction();
}

function getCookieOptions() {
  const sameSite = getCookieSameSite();
  const secure = isCookieSecure();

  // Si se utiliza SameSite=None, la cookie DEBE obligatoriamente ser Secure (RFC 6265bis)
  const isSecure = sameSite === 'None' ? true : secure;

  return {
    httpOnly: true,
    sameSite,
    secure: isSecure,
    path: '/',
    maxAge: getSessionHours() * 60 * 60 * 1000
  };
}

function getClearCookieOptions() {
  const opts = getCookieOptions();
  const { maxAge, ...clearOpts } = opts;
  return clearOpts;
}

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;

  if (isProduction()) {
    if (!raw || !raw.trim()) {
      throw new Error('ALLOWED_ORIGINS es obligatorio en producción y debe contener una lista separada por comas de orígenes permitidos.');
    }
    const origins = raw.split(',').map(o => o.trim()).filter(Boolean);
    if (origins.includes('*')) {
      throw new Error('ALLOWED_ORIGINS no puede contener el comodín "*" en producción.');
    }
    return origins;
  }

  if (raw && raw.trim()) {
    return raw.split(',').map(o => o.trim()).filter(Boolean);
  }

  return DEFAULT_DEV_ORIGINS;
}

module.exports = {
  getJwtSecret,
  getSessionHours,
  getCookieOptions,
  getClearCookieOptions,
  getAllowedOrigins,
  isProduction
};
