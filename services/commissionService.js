const db = require('../db');

/**
 * Obtiene la tasa de comisión configurada para una compañía y tipo de cobertura.
 * Si no encuentra una específica, usa la genérica '*'. Si no existe ninguna, devuelve 0.15 (15%).
 *
 * @param {string} compania - Nombre de la compañía de seguros
 * @param {string} [cobertura='*'] - Tipo de cobertura
 * @returns {Promise<number>} Tasa de comisión como decimal (ej: 0.15)
 */
async function getCommissionRate(compania, cobertura = '*') {
  if (!compania) return 0.15;
  try {
    const row = await db.get(`
      SELECT tasa 
      FROM tasas_comision 
      WHERE compania = ? 
        AND (tipo_cobertura = ? OR tipo_cobertura = '*') 
        AND activa = TRUE 
      ORDER BY CASE WHEN tipo_cobertura = ? THEN 1 ELSE 2 END 
      LIMIT 1
    `, [compania, cobertura, cobertura]);

    return row ? parseFloat(row.tasa) : 0.15;
  } catch (err) {
    console.error('[getCommissionRate error]:', err.message);
    return 0.15;
  }
}

module.exports = { getCommissionRate };
