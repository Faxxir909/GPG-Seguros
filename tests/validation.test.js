const test = require('node:test');
const assert = require('node:assert');

const {
  isPositiveInteger,
  isValidDniCuit,
  isValidEmail,
  isValidPhone,
  isValidDateRange,
  isNonNegativeAmount,
  isInEnum,
  sanitizePagination,
  validateSchema
} = require('../utils/validation');

test('validadores de utilidades', async t => {
  await t.test('isPositiveInteger', () => {
    assert.strictEqual(isPositiveInteger(1), true);
    assert.strictEqual(isPositiveInteger('42'), true);
    assert.strictEqual(isPositiveInteger(0), false);
    assert.strictEqual(isPositiveInteger(-5), false);
    assert.strictEqual(isPositiveInteger('abc'), false);
    assert.strictEqual(isPositiveInteger(null), false);
  });

  await t.test('isValidDniCuit para DNI argentino', () => {
    assert.strictEqual(isValidDniCuit('35.444.888'), true);
    assert.strictEqual(isValidDniCuit('35444888'), true);
    assert.strictEqual(isValidDniCuit('8444888'), true); // 7 dígitos
    assert.strictEqual(isValidDniCuit('123'), false); // muy corto
    assert.strictEqual(isValidDniCuit(''), false);
  });

  await t.test('isValidDniCuit para CUIT/CUIL argentino con dígito verificador', () => {
    // CUITs reales válidos (módulo 11)
    assert.strictEqual(isValidDniCuit('33-69345023-9'), true); // AFIP
    assert.strictEqual(isValidDniCuit('20-35444888-3'), true);
    assert.strictEqual(isValidDniCuit('33-63761744-9'), true); // ANSES

    // CUIT con dígito verificador incorrecto
    assert.strictEqual(isValidDniCuit('33-69345023-1'), false);
    assert.strictEqual(isValidDniCuit('99-35444888-1'), false); // Tipo inválido
  });

  await t.test('isValidEmail', () => {
    assert.strictEqual(isValidEmail('productor@gpgseguros.com.ar'), true);
    assert.strictEqual(isValidEmail('juan.perez+test@gmail.com'), true);
    assert.strictEqual(isValidEmail('invalido'), false);
    assert.strictEqual(isValidEmail('@sin-usuario.com'), false);
    assert.strictEqual(isValidEmail(null), false);
  });

  await t.test('isValidPhone', () => {
    assert.strictEqual(isValidPhone('1144445555'), true);
    assert.strictEqual(isValidPhone('+54 9 11 4444-5555'), true);
    assert.strictEqual(isValidPhone('123'), false);
  });

  await t.test('isValidDateRange', () => {
    assert.strictEqual(isValidDateRange('2026-01-01', '2026-12-31'), true);
    assert.strictEqual(isValidDateRange('2026-05-01', '2026-05-01'), true);
    assert.strictEqual(isValidDateRange('2026-12-31', '2026-01-01'), false); // invertido
    assert.strictEqual(isValidDateRange('fecha-invalida', '2026-12-31'), false);
  });

  await t.test('isNonNegativeAmount', () => {
    assert.strictEqual(isNonNegativeAmount(0), true);
    assert.strictEqual(isNonNegativeAmount('1500.50'), true);
    assert.strictEqual(isNonNegativeAmount(-10), false);
    assert.strictEqual(isNonNegativeAmount('abc'), false);
    assert.strictEqual(isNonNegativeAmount(null), false);
  });

  await t.test('isInEnum', () => {
    const allowed = ['vigente', 'vencida', 'suspendida'];
    assert.strictEqual(isInEnum('vigente', allowed), true);
    assert.strictEqual(isInEnum('VIGENTE', allowed), true);
    assert.strictEqual(isInEnum('cancelada', allowed), false);
  });

  await t.test('sanitizePagination', () => {
    assert.deepStrictEqual(sanitizePagination(1, 20), { page: 1, limit: 20, offset: 0 });
    assert.deepStrictEqual(sanitizePagination(3, 50), { page: 3, limit: 50, offset: 100 });
    assert.deepStrictEqual(sanitizePagination(-5, 500), { page: 1, limit: 100, offset: 0 }); // acotado a max 100
  });

  await t.test('middleware validateSchema', () => {
    const middleware = validateSchema({
      params: { id: { required: true, type: 'positiveInt' } },
      body: {
        email: { required: true, type: 'email' },
        monto: { required: false, type: 'amount' }
      }
    });

    // Caso inválido
    let status = null;
    let json = null;
    const badReq = {
      params: { id: 'no-es-numero' },
      body: { email: 'correo-invalido', monto: -50 }
    };
    const badRes = {
      status(code) { status = code; return this; },
      json(data) { json = data; return this; }
    };
    middleware(badReq, badRes, () => {});
    assert.strictEqual(status, 400);
    assert.ok(json.error.includes('entero positivo'));
    assert.ok(json.error.includes('correo electrónico'));

    // Caso válido
    let calledNext = false;
    const goodReq = {
      params: { id: '42' },
      body: { email: 'admin@seguros.com', monto: 1200 }
    };
    middleware(goodReq, {}, () => { calledNext = true; });
    assert.strictEqual(calledNext, true);
  });
});
