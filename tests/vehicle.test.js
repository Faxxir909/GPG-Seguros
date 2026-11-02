const test = require('node:test');
const assert = require('node:assert');

const { normalizeAndValidatePlate } = require('../controllers/vehicleController');

test('validación y normalización de patentes argentinas', async t => {
  await t.test('formato Mercosur automotor (ej: AA123BB)', () => {
    const res = normalizeAndValidatePlate('aa 123 bb');
    assert.strictEqual(res.patente, 'AA123BB');
    assert.strictEqual(res.formato, 'mercosur_auto');
    assert.strictEqual(res.tipoVehiculo, 'automotor');
  });

  await t.test('formato Mercosur con guiones (ej: AB-456-CD)', () => {
    const res = normalizeAndValidatePlate('ab-456-cd');
    assert.strictEqual(res.patente, 'AB456CD');
    assert.strictEqual(res.formato, 'mercosur_auto');
  });

  await t.test('formato tradicional 1995-2016 automotor (ej: ABC123)', () => {
    const res = normalizeAndValidatePlate('abC 987');
    assert.strictEqual(res.patente, 'ABC987');
    assert.strictEqual(res.formato, 'tradicional_auto');
    assert.strictEqual(res.tipoVehiculo, 'automotor');
  });

  await t.test('formato Mercosur motovehículo (ej: A123BCD)', () => {
    const res = normalizeAndValidatePlate('a 054 xyz');
    assert.strictEqual(res.patente, 'A054XYZ');
    assert.strictEqual(res.formato, 'mercosur_moto');
    assert.strictEqual(res.tipoVehiculo, 'motovehiculo');
  });

  await t.test('formato tradicional motovehículo (ej: 123ABC)', () => {
    const res = normalizeAndValidatePlate('999-ZZZ');
    assert.strictEqual(res.patente, '999ZZZ');
    assert.strictEqual(res.formato, 'tradicional_moto');
    assert.strictEqual(res.tipoVehiculo, 'motovehiculo');
  });

  await t.test('patente nula o vacía arroja 400', () => {
    assert.throws(() => normalizeAndValidatePlate(''), err => err.status === 400);
    assert.throws(() => normalizeAndValidatePlate(null), err => err.status === 400);
  });

  await t.test('patente con formato inválido arroja 400', () => {
    assert.throws(() => normalizeAndValidatePlate('123456'), err => err.status === 400);
    assert.throws(() => normalizeAndValidatePlate('ABCDEFG'), err => err.status === 400);
    assert.throws(() => normalizeAndValidatePlate('12AB34'), err => err.status === 400);
    assert.throws(() => normalizeAndValidatePlate('A1B2C3D'), err => err.status === 400);
  });
});
