const db = require('../db');

/**
 * Obtiene la tasa de comisión configurada para una compañía y tipo de cobertura.
 * Si no encuentra una específica, usa la genérica '*'. Si no existe ninguna, devuelve 0.15 (15%).
 *
 * @param {string} compania - Nombre de la compañía de seguros
 * @param {string} [cobertura='*'] - Tipo de cobertura
 * @param {{get: Function}} [executor=db] - DB o transacción activa
 * @returns {Promise<number>} Tasa de comisión como decimal (ej: 0.15)
 */
async function getCommissionRate(compania, cobertura = '*', executor = db) {
  if (!compania) return 0.15;
  const row = await executor.get(`
    SELECT tasa
    FROM tasas_comision
    WHERE compania = ?
      AND (tipo_cobertura = ? OR tipo_cobertura = '*')
      AND activa IS TRUE
    ORDER BY CASE WHEN tipo_cobertura = ? THEN 1 ELSE 2 END
    LIMIT 1
  `, [compania, cobertura, cobertura]);

  return row ? Number.parseFloat(row.tasa) : 0.15;
}

module.exports = { getCommissionRate };
