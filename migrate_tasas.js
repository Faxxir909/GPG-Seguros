// Migración: Crear tabla tasas_comision y datos semilla
const { pool } = require('./db');

async function migrate() {
  try {
    // Crear tabla
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasas_comision (
        id             SERIAL PRIMARY KEY,
        compania       TEXT NOT NULL,
        tipo_cobertura TEXT NOT NULL DEFAULT '*',
        tasa           NUMERIC(5,4) NOT NULL DEFAULT 0.1500,
        descripcion    TEXT,
        activa         BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (compania, tipo_cobertura)
      )
    `);
    console.log('✅ Tabla tasas_comision creada/verificada.');

    // Insertar datos semilla si la tabla está vacía
    const count = await pool.query('SELECT COUNT(*) as count FROM tasas_comision');
    if (parseInt(count.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO tasas_comision (compania, tipo_cobertura, tasa, descripcion) VALUES
          ('Federación Patronal', '*', 0.1500, 'Tasa genérica Federación Patronal'),
          ('Sancor Seguros', '*', 0.1500, 'Tasa genérica Sancor'),
          ('La Segunda', '*', 0.1200, 'Tasa genérica La Segunda'),
          ('Zurich', '*', 0.1400, 'Tasa genérica Zurich'),
          ('Rivadavia', '*', 0.1300, 'Tasa genérica Rivadavia'),
          ('San Cristóbal', '*', 0.1500, 'Tasa genérica San Cristóbal'),
          ('Mapfre', '*', 0.1200, 'Tasa genérica Mapfre'),
          ('Allianz', '*', 0.1400, 'Tasa genérica Allianz'),
          ('Mercantil Andina', '*', 0.1500, 'Tasa genérica Mercantil Andina'),
          ('Berkley', '*', 0.1300, 'Tasa genérica Berkley')
        ON CONFLICT DO NOTHING
      `);
      console.log('✅ Tasas de comisión de ejemplo insertadas (10 compañías).');
    } else {
      console.log('ℹ️  Tasas de comisión ya existen:', count.rows[0].count, 'registros.');
    }

    // Crear índice
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tasas_comision_compania ON tasas_comision(compania, tipo_cobertura)
    `);
    console.log('✅ Índice creado.');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  }
}

migrate();
