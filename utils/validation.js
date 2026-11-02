/**
 * Utilidades livianas de validación y sanitización para GPG Seguros CRM.
 * Complementa los constraints de PostgreSQL en la capa HTTP.
 */

function isPositiveInteger(val) {
  if (val === null || val === undefined) return false;
  const num = Number(val);
  return Number.isInteger(num) && num > 0;
}

function normalizeDniCuit(val) {
  if (!val) return '';
  return String(val).replace(/[^0-9]/g, '').trim();
}

/**
 * Valida DNI (7 u 8 dígitos) o CUIT/CUIL argentino (11 dígitos con dígito verificador mod 11)
 */
function isValidDniCuit(raw) {
  const clean = normalizeDniCuit(raw);
  if (!clean) return false;

  // DNI argentino estándar: 7 u 8 dígitos
  if (clean.length >= 7 && clean.length <= 8) {
    const num = parseInt(clean, 10);
    return num >= 1000000 && num <= 99999999;
  }

  // CUIT / CUIL: 11 dígitos con algoritmo de verificación módulo 11
  if (clean.length === 11) {
    const tipo = clean.substring(0, 2);
    const tiposValidos = ['20', '23', '24', '25', '26', '27', '30', '33', '34', '50', '51', '55'];
    if (!tiposValidos.includes(tipo)) return false;

    const coeficientes = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 10; i++) {
      suma += parseInt(clean[i], 10) * coeficientes[i];
    }

    const resto = suma % 11;
    let digitoEsperado = 11 - resto;
    if (digitoEsperado === 11) digitoEsperado = 0;
    if (digitoEsperado === 10) digitoEsperado = 9;

    return parseInt(clean[10], 10) === digitoEsperado;
  }

  return false;
}

function isValidEmail(val) {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length > 254) return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(trimmed);
}

function isValidPhone(val) {
  if (!val) return false;
  const clean = String(val).replace(/[^0-9]/g, '');
  return clean.length >= 8 && clean.length <= 15;
}

function isValidDate(val) {
  if (!val) return false;
  const d = new Date(val);
  return d instanceof Date && !isNaN(d.getTime());
}

function isValidDateRange(inicio, vencimiento) {
  if (!isValidDate(inicio) || !isValidDate(vencimiento)) return false;
  const dIni = new Date(inicio);
  const dFin = new Date(vencimiento);
  return dFin.getTime() >= dIni.getTime();
}

function isNonNegativeAmount(val) {
  if (val === null || val === undefined || val === '') return false;
  const num = Number(val);
  return Number.isFinite(num) && num >= 0;
}

function isInEnum(val, allowed) {
  if (!val) return false;
  return allowed.includes(String(val).toLowerCase().trim());
}

function sanitizeText(val, maxLength = 255) {
  if (val === null || val === undefined) return '';
  return String(val).trim().substring(0, maxLength);
}

function sanitizePagination(page, limit) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { page: p, limit: l, offset: (p - 1) * l };
}

/**
 * Middleware constructor para validaciones declarativas
 */
function validateSchema(schema) {
  return (req, res, next) => {
    const errors = [];

    // Validar params
    if (schema.params) {
      for (const [key, rule] of Object.entries(schema.params)) {
        const val = req.params[key];
        if (rule.required && (val === undefined || val === '')) {
          errors.push(`El parámetro de ruta '${key}' es requerido.`);
        } else if (rule.type === 'positiveInt' && !isPositiveInteger(val)) {
          errors.push(`El parámetro '${key}' debe ser un entero positivo.`);
        }
      }
    }

    // Validar query
    if (schema.query) {
      for (const [key, rule] of Object.entries(schema.query)) {
        const val = req.query[key];
        if (rule.required && (val === undefined || val === '')) {
          errors.push(`El parámetro de consulta '${key}' es requerido.`);
        }
      }
    }

    // Validar body
    if (schema.body) {
      for (const [key, rule] of Object.entries(schema.body)) {
        const val = req.body?.[key];
        if (rule.required && (val === undefined || val === null || val === '')) {
          errors.push(`El campo '${key}' es requerido.`);
        } else if (val !== undefined && val !== null && val !== '') {
          if (rule.type === 'email' && !isValidEmail(val)) {
            errors.push(`El campo '${key}' no tiene un formato de correo electrónico válido.`);
          } else if (rule.type === 'dni_cuit' && !isValidDniCuit(val)) {
            errors.push(`El campo '${key}' debe ser un DNI (7-8 dígitos) o CUIT válido.`);
          } else if (rule.type === 'amount' && !isNonNegativeAmount(val)) {
            errors.push(`El campo '${key}' debe ser un importe numérico mayor o igual a cero.`);
          } else if (rule.type === 'enum' && rule.allowed && !isInEnum(val, rule.allowed)) {
            errors.push(`El campo '${key}' debe ser uno de los siguientes: ${rule.allowed.join(', ')}.`);
          } else if (rule.type === 'positiveInt' && !isPositiveInteger(val)) {
            errors.push(`El campo '${key}' debe ser un número entero positivo.`);
          }
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }

    next();
  };
}

module.exports = {
  isPositiveInteger,
  normalizeDniCuit,
  isValidDniCuit,
  isValidEmail,
  isValidPhone,
  isValidDate,
  isValidDateRange,
  isNonNegativeAmount,
  isInEnum,
  sanitizeText,
  sanitizePagination,
  validateSchema
};
