const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 1. Pruebas de Normalización de Teléfonos Argentinos para WhatsApp
const { normalizeArgentinePhone, formatDate, formatMoney } = require('../public/js/utils');

test('Normalizador de teléfonos argentinos para WhatsApp', async (t) => {
  await t.test('Normaliza formato CABA con 0 y 15 (011 15-4444-5555)', () => {
    assert.strictEqual(normalizeArgentinePhone('011 15-4444-5555'), '5491144445555');
  });

  await t.test('Normaliza formato CABA directo (11 4444-5555)', () => {
    assert.strictEqual(normalizeArgentinePhone('11 4444-5555'), '5491144445555');
  });

  await t.test('Mantiene formato internacional ya correcto (+54 9 11 4444-5555)', () => {
    assert.strictEqual(normalizeArgentinePhone('+54 9 11 4444-5555'), '5491144445555');
  });

  await t.test('Agrega el 9 móvil si tiene prefijo país 54 pero falta el 9 (541144445555)', () => {
    assert.strictEqual(normalizeArgentinePhone('541144445555'), '5491144445555');
  });

  await t.test('Normaliza teléfonos del interior con código de 3 dígitos (0341 15 4123456)', () => {
    assert.strictEqual(normalizeArgentinePhone('0341 15 4123456'), '5493414123456');
  });

  await t.test('Normaliza teléfonos del interior sin 0 ni 15 (341 4123456)', () => {
    assert.strictEqual(normalizeArgentinePhone('341 4123456'), '5493414123456');
  });

  await t.test('Normaliza móvil local de 8 dígitos con 15 (15-4444-5555)', () => {
    assert.strictEqual(normalizeArgentinePhone('15-4444-5555'), '5491144445555');
  });

  await t.test('Maneja entradas vacías o nulas de forma segura', () => {
    assert.strictEqual(normalizeArgentinePhone(''), '');
    assert.strictEqual(normalizeArgentinePhone(null), '');
    assert.strictEqual(normalizeArgentinePhone(undefined), '');
  });
});

// 2. Pruebas de Formateo de Fechas y Moneda
test('Utilidades de formato (Fechas y Monedas)', async (t) => {
  await t.test('Formatea fecha ISO YYYY-MM-DD a DD/MM/YYYY', () => {
    assert.strictEqual(formatDate('2026-08-31'), '31/08/2026');
    assert.strictEqual(formatDate('2026-12-01T00:00:00.000Z'), '01/12/2026');
    assert.strictEqual(formatDate(null), '--');
  });

  await t.test('Formatea montos monetarios en pesos argentinos', () => {
    const formatted = formatMoney(150000);
    assert.ok(formatted.includes('150.000') || formatted.includes('150,000'));
  });
});

// 3. Pruebas de Base de Datos y Transacciones ACID
const db = require('../db');

test('Base de Datos: Transacciones y Mantenimiento', async (t) => {
  await db.initDatabase();

  await t.test('withTransaction ejecuta y confirma operaciones atómicas', async () => {
    const testPlate = 'TEST_' + Date.now();
    const client = await db.run('INSERT INTO clientes (nombre, dni_cuit) VALUES (?, ?)', ['Test Cliente Trx', '1111' + Date.now()]);
    
    // Inserción en transacción
    await db.withTransaction(async (trx) => {
      await trx.run('INSERT INTO vehiculos (cliente_id, marca, modelo, patente, anio) VALUES (?, ?, ?, ?, ?)', [
        client.id, 'Toyota', 'Corolla', testPlate, 2024
      ]);
    });

    const inserted = await db.get('SELECT * FROM vehiculos WHERE patente = ?', [testPlate]);
    assert.ok(inserted, 'El vehículo debe haber sido insertado en la transacción');
    assert.strictEqual(inserted.patente, testPlate);

    // Limpieza
    await db.run('DELETE FROM vehiculos WHERE patente = ?', [testPlate]);
    await db.run('DELETE FROM clientes WHERE id = ?', [client.id]);
  });

  await t.test('withTransaction revierte cambios si ocurre un error', async () => {
    const failPlate = 'FAIL_' + Date.now();
    const client = await db.run('INSERT INTO clientes (nombre, dni_cuit) VALUES (?, ?)', ['Test Cliente Fail', '2222' + Date.now()]);
    
    try {
      await db.withTransaction(async (trx) => {
        await trx.run('INSERT INTO vehiculos (cliente_id, marca, modelo, patente, anio) VALUES (?, ?, ?, ?, ?)', [
          client.id, 'Ford', 'Focus', failPlate, 2023
        ]);
        throw new Error('Forzar error de transacción para rollback');
      });
    } catch (err) {
      assert.strictEqual(err.message, 'Forzar error de transacción para rollback');
    }

    const notInserted = await db.get('SELECT * FROM vehiculos WHERE patente = ?', [failPlate]);
    assert.strictEqual(notInserted, undefined, 'El registro no debe existir debido al rollback');
    await db.run('DELETE FROM clientes WHERE id = ?', [client.id]);
  });

  await t.test('updateExpiredPolicies actualiza pólizas vencidas automáticamente', async () => {
    // Insertar un cliente temporal y una póliza con fecha pasada
    const clientRes = await db.run('INSERT INTO clientes (nombre, dni_cuit) VALUES (?, ?)', [
      'Cliente Test Vencimiento', '99999999' + Date.now()
    ]);
    
    const polRes = await db.run(`
      INSERT INTO polizas (numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id)
      VALUES (?, '2020-01-01', '2020-12-31', 'Terceros Completo', 'vigente', 10000, 1000, 'efectivo', 'Sancor Seguros', ?)
    `, ['TEST-EXP-' + Date.now(), clientRes.id]);

    await db.updateExpiredPolicies();

    const pol = await db.get('SELECT estado FROM polizas WHERE id = ?', [polRes.id]);
    assert.strictEqual(pol.estado, 'vencida', 'La póliza con fecha de vencimiento pasada debe pasar a estado vencida');

    // Limpieza
    await db.run('DELETE FROM polizas WHERE id = ?', [polRes.id]);
    await db.run('DELETE FROM clientes WHERE id = ?', [clientRes.id]);
  });
});

// 4. Pruebas de Seguridad y Control de Acceso
const jwt = require('jsonwebtoken');

test('Seguridad: Tokens JWT y Protección de Endpoints', async (t) => {
  const secret = process.env.JWT_SECRET || 'secret';

  await t.test('Genera y valida token JWT con expiración de 8h', () => {
    const token = jwt.sign({ id: 1, email: 'test@gpgseguros.com.ar', rol: 'admin' }, secret, { expiresIn: '8h' });
    const decoded = jwt.verify(token, secret);
    assert.strictEqual(decoded.email, 'test@gpgseguros.com.ar');
    assert.strictEqual(decoded.rol, 'admin');
  });

  await t.test('Firma inválida es rechazada', () => {
    const token = jwt.sign({ id: 1, email: 'hacker@test.com', rol: 'admin' }, 'wrong_secret');
    assert.throws(() => {
      jwt.verify(token, secret);
    });
  });
});

// 5. Pruebas de Lógica de Dashboard y Límites de Vencimiento
test('Dashboard: Reglas de Vencimiento y Fechas', async (t) => {
  await t.test('Límite de 30 días filtra vencimientos mayores a 30 días', async () => {
    const client = await db.run('INSERT INTO clientes (nombre, dni_cuit) VALUES (?, ?)', ['Test Expiration', '3333' + Date.now()]);
    
    const d45 = new Date();
    d45.setDate(d45.getDate() + 45);
    const fecha45Str = d45.toISOString().split('T')[0];

    const d10 = new Date();
    d10.setDate(d10.getDate() + 10);
    const fecha10Str = d10.toISOString().split('T')[0];

    const pol10 = await db.run(`
      INSERT INTO polizas (numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id)
      VALUES ('POL-10D', '2026-01-01', ?, 'Todo Riesgo', 'vigente', 50000, 5000, 'tarjeta', 'Sancor', ?)
    `, [fecha10Str, client.id]);

    const pol45 = await db.run(`
      INSERT INTO polizas (numero_poliza, fecha_inicio, fecha_vencimiento, cobertura, estado, monto_total, valor_cuota, forma_pago, compania, cliente_id)
      VALUES ('POL-45D', '2026-01-01', ?, 'Todo Riesgo', 'vigente', 50000, 5000, 'tarjeta', 'Sancor', ?)
    `, [fecha45Str, client.id]);

    const hoy = new Date().toISOString().split('T')[0];
    const d30 = new Date();
    d30.setDate(d30.getDate() + 30);
    const fecha30Str = d30.toISOString().split('T')[0];

    const proximas = await db.all(`
      SELECT p.numero_poliza FROM polizas p
      WHERE p.estado = 'vigente' AND p.fecha_vencimiento >= ? AND p.fecha_vencimiento <= ?
      AND p.id IN (?, ?)
    `, [hoy, fecha30Str, pol10.id, pol45.id]);

    assert.strictEqual(proximas.length, 1, 'Solo la póliza con vencimiento a 10 días debe ser incluida en los próximos 30 días');
    assert.strictEqual(proximas[0].numero_poliza, 'POL-10D');

    // Limpieza
    await db.run('DELETE FROM polizas WHERE id IN (?, ?)', [pol10.id, pol45.id]);
    await db.run('DELETE FROM clientes WHERE id = ?', [client.id]);
  });
});

