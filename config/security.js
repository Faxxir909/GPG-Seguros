require('dotenv').config();

const INSECURE_DEFAULT_SECRET = 'gpg_seguros_secret_key_12345';

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

module.exports = { getJwtSecret, getSessionHours };
