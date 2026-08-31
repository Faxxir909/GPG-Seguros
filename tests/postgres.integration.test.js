const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

test('integración PostgreSQL aislada', { skip: !hasTestDatabase }, async t => {
  const db = require('../db');
  await db.initDatabase();

  t.after(async () => {
    await db.close();
  });

  await t.test('migraciones, zona horaria y salud', async () => {
    const health = await db.healthCheck();
    assert.strictEqual(health.timezone, 'America/Argentina/Buenos_Aires');
    const migrations = await db.get('SELECT COUNT(*)::int AS count FROM schema_migrations');
    assert.ok(migrations.count >= 2);
  });

  await t.test('transacción revierte todos los cambios', async () => {
    const dni = `99${Date.now()}`;
    await assert.rejects(
      db.withTransaction(async trx => {
        await trx.run('INSERT INTO clientes (nombre, dni_cuit) VALUES (?, ?)', ['Rollback Test', dni]);
        throw new Error('rollback esperado');
      }),
      /rollback esperado/
    );
    const row = await db.get('SELECT id FROM clientes WHERE dni_cuit = ?', [dni]);
    assert.strictEqual(row, undefined);
  });

  await t.test('restricciones financieras rechazan importes negativos', async () => {
    const dni = `98${Date.now()}`;
    const client = await db.run('INSERT INTO clientes (nombre, dni_cuit) VALUES (?, ?)', ['Constraint Test', dni]);
    try {
      await assert.rejects(
        db.run(`
          INSERT INTO polizas (
            numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado,
            monto_total, valor_cuota, forma_pago, compania, cliente_id
          ) VALUES (?, CURRENT_DATE, CURRENT_DATE + 30, 'RC', 'vigente', -1, 0, 'efectivo', 'Test', ?)
        `, [`NEG-${Date.now()}`, client.id]),
        /check|constraint/i
      );
    } finally {
      await db.run('DELETE FROM clientes WHERE id = ?', [client.id]);
    }
  });

  await t.test('auditoría registra escrituras sin exponer hashes', async () => {
    const dni = `97${Date.now()}`;
    const client = await db.run('INSERT INTO clientes (nombre, dni_cuit) VALUES (?, ?)', ['Audit Test', dni]);
    const event = await db.get(`
      SELECT accion, datos_nuevos
      FROM auditoria_eventos
      WHERE tabla = 'clientes' AND registro_id = ?
      ORDER BY creado_en DESC LIMIT 1
    `, [String(client.id)]);
    assert.strictEqual(event.accion, 'INSERT');
    assert.strictEqual(event.datos_nuevos.nombre, 'Audit Test');
    await db.run('DELETE FROM clientes WHERE id = ?', [client.id]);
  });
});
