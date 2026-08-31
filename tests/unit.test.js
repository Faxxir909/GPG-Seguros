const test = require('node:test');
const assert = require('node:assert');

const { normalizeArgentinePhone, formatDate, formatMoney } = require('../public/js/utils');
const { convertPlaceholders } = require('../db');

test('normalizador de teléfonos argentinos para WhatsApp', async t => {
  const cases = [
    ['011 15-4444-5555', '5491144445555'],
    ['11 4444-5555', '5491144445555'],
    ['+54 9 11 4444-5555', '5491144445555'],
    ['541144445555', '5491144445555'],
    ['0341 15 4123456', '5493414123456'],
    ['341 4123456', '5493414123456'],
    ['15-4444-5555', '5491144445555']
  ];

  for (const [input, expected] of cases) {
    await t.test(input, () => assert.strictEqual(normalizeArgentinePhone(input), expected));
  }
  assert.strictEqual(normalizeArgentinePhone(null), '');
});

test('utilidades de fecha y moneda', () => {
  assert.strictEqual(formatDate('2026-08-31'), '31/08/2026');
  assert.strictEqual(formatDate('2026-12-01T00:00:00.000Z'), '01/12/2026');
  assert.strictEqual(formatDate(null), '--');
  assert.match(formatMoney(150000), /150[.,]000/);
});

test('adaptador de placeholders conserva consultas PostgreSQL nativas', () => {
  assert.strictEqual(
    convertPlaceholders('SELECT * FROM polizas WHERE id = ? AND estado = ?'),
    'SELECT * FROM polizas WHERE id = $1 AND estado = $2'
  );
  assert.strictEqual(
    convertPlaceholders('SELECT * FROM clientes WHERE nombre ILIKE $1'),
    'SELECT * FROM clientes WHERE nombre ILIKE $1'
  );
});
