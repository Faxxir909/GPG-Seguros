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

const { parseExcelMoney, parseExcelDate, findRowValue } = require('../services/importerService');

test('parser de dinero para importación de Excel con formato argentino', () => {
  assert.strictEqual(parseExcelMoney(15000), 15000);
  assert.strictEqual(parseExcelMoney('15.000'), 15000);
  assert.strictEqual(parseExcelMoney('$ 125.450,50'), 125450.50);
  assert.strictEqual(parseExcelMoney('125,450.50'), 125450.50);
  assert.strictEqual(parseExcelMoney('1.250.000,00'), 1250000);
  assert.strictEqual(parseExcelMoney('1500,25'), 1500.25);
  assert.strictEqual(parseExcelMoney(''), 0);
  assert.strictEqual(parseExcelMoney(null), 0);
  assert.strictEqual(parseExcelMoney(undefined), 0);
});

test('parser de fechas para importación de Excel', () => {
  assert.strictEqual(parseExcelDate('15/08/2026'), '2026-08-15');
  assert.strictEqual(parseExcelDate('15-08-2026'), '2026-08-15');
  assert.strictEqual(parseExcelDate('2026-08-15'), '2026-08-15');
  assert.strictEqual(parseExcelDate(new Date('2026-08-15T12:00:00Z')), '2026-08-15');
  assert.strictEqual(parseExcelDate(null, false), null);
  assert.strictEqual(parseExcelDate('', true), new Date().toISOString().substring(0, 10));
});

test('buscador de columnas por patrones de regex findRowValue', () => {
  const row = { 'Nº Póliza': '123456', 'Nombre Completo': 'Juan Perez' };
  assert.strictEqual(findRowValue(row, [/p[oó]liza/i]), '123456');
  assert.strictEqual(findRowValue(row, [/nombre/i]), 'Juan Perez');
  assert.strictEqual(findRowValue(row, [/patente/i]), null);
});

const { ensurePolicyInstallments } = require('../controllers/paymentController');

test('cálculo seguro de fechas en ensurePolicyInstallments sin month-rollover', async () => {
  const inserted = [];
  let existingCheck = false;
  const mockDb = {
    all: async (sql, params) => {
      if (!existingCheck) {
        existingCheck = true;
        return [];
      }
      return inserted;
    },
    get: async (sql, params) => ({
      id: 99,
      fecha_inicio: '2026-01-31',
      valor_cuota: 10000,
      monto_total: 40000,
      forma_pago: 'Efectivo'
    }),
    run: async (sql, params) => {
      inserted.push({
        numero_cuota: params[1],
        fecha_vencimiento: params[3]
      });
      return { id: inserted.length };
    }
  };

  const cuotas = await ensurePolicyInstallments(99, mockDb);
  assert.strictEqual(inserted.length, 4);
  assert.strictEqual(inserted[0].fecha_vencimiento, '2026-01-31');
  assert.strictEqual(inserted[1].fecha_vencimiento, '2026-02-28'); // Febrero limitado a 28, no salta a marzo
  assert.strictEqual(inserted[2].fecha_vencimiento, '2026-03-31');
  assert.strictEqual(inserted[3].fecha_vencimiento, '2026-04-30'); // Abril limitado a 30
});
