const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

const {
  getJwtSecret,
  getSessionHours,
  getCookieOptions,
  getClearCookieOptions,
  getAllowedOrigins
} = require('../config/security');
const { logger } = require('../utils/logger');
const { csrfProtection } = require('../middlewares/csrf');

test('módulo de seguridad y configuración de cookies', async t => {
  await t.test('JWT Secret tiene al menos 32 caracteres y no es inseguro', () => {
    const secret = getJwtSecret();
    assert.ok(secret && secret.length >= 32);
    assert.notStrictEqual(secret, 'gpg_seguros_secret_key_12345');
  });

  await t.test('paridad exacta de atributos entre cookie y clearCookie', () => {
    const setOpts = getCookieOptions();
    const clearOpts = getClearCookieOptions();

    assert.strictEqual(setOpts.httpOnly, true);
    assert.strictEqual(clearOpts.httpOnly, true);
    assert.strictEqual(setOpts.sameSite, clearOpts.sameSite);
    assert.strictEqual(setOpts.secure, clearOpts.secure);
    assert.strictEqual(setOpts.path, clearOpts.path);
    assert.strictEqual(clearOpts.maxAge, undefined); // clearCookie no debe tener maxAge
  });

  await t.test('orígenes CORS permitidos en desarrollo rechazan comodines o orígenes arbitrarios', () => {
    const origins = getAllowedOrigins();
    assert.ok(Array.isArray(origins));
    assert.ok(origins.includes('http://localhost:3000'));
    assert.ok(!origins.includes('*'));
  });
});

test('verificación de tokens JWT (HS256)', async t => {
  const secret = getJwtSecret();

  await t.test('token con firma válida es decodificado correctamente', () => {
    const token = jwt.sign(
      { id: 1, usuario: 'admin', rol: 'admin' },
      secret,
      { expiresIn: '1h', algorithm: 'HS256', issuer: 'gpg-seguros', audience: 'gpg-seguros-crm' }
    );
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'gpg-seguros',
      audience: 'gpg-seguros-crm'
    });
    assert.strictEqual(decoded.usuario, 'admin');
  });

  await t.test('token alterado con secret erróneo es rechazado', () => {
    const token = jwt.sign(
      { id: 1, usuario: 'admin' },
      'otro_secret_completamente_diferente_12345678',
      { expiresIn: '1h', algorithm: 'HS256', issuer: 'gpg-seguros', audience: 'gpg-seguros-crm' }
    );
    assert.throws(() => {
      jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'gpg-seguros', audience: 'gpg-seguros-crm' });
    });
  });

  await t.test('token con issuer o audience inválidos es rechazado', () => {
    const token = jwt.sign(
      { id: 1, usuario: 'admin' },
      secret,
      { expiresIn: '1h', algorithm: 'HS256', issuer: 'otro-issuer', audience: 'gpg-seguros-crm' }
    );
    assert.throws(() => {
      jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'gpg-seguros', audience: 'gpg-seguros-crm' });
    });
  });

  await t.test('token expirado es rechazado', () => {
    const token = jwt.sign(
      { id: 1, usuario: 'admin' },
      secret,
      { expiresIn: '-10s', algorithm: 'HS256', issuer: 'gpg-seguros', audience: 'gpg-seguros-crm' }
    );
    assert.throws(() => {
      jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'gpg-seguros', audience: 'gpg-seguros-crm' });
    });
  });
});

test('protección contra CSRF en peticiones mutables', async t => {
  await t.test('permite peticiones GET sin headers especiales', () => {
    let called = false;
    const req = { method: 'GET', headers: {} };
    const res = {};
    csrfProtection(req, res, () => { called = true; });
    assert.strictEqual(called, true);
  });

  await t.test('permite peticiones con header X-Requested-With', () => {
    let called = false;
    const req = { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest' } };
    const res = {};
    csrfProtection(req, res, () => { called = true; });
    assert.strictEqual(called, true);
  });

  await t.test('permite peticiones con Bearer token', () => {
    let called = false;
    const req = { method: 'POST', headers: { authorization: 'Bearer some.jwt.token' } };
    const res = {};
    csrfProtection(req, res, () => { called = true; });
    assert.strictEqual(called, true);
  });

  await t.test('bloquea peticiones mutables sin origen, referer ni headers autorizados', () => {
    let statusSent = null;
    let jsonSent = null;
    const req = { method: 'POST', headers: {} };
    const res = {
      status(code) { statusSent = code; return this; },
      json(data) { jsonSent = data; return this; }
    };
    csrfProtection(req, res, () => {});
    assert.strictEqual(statusSent, 403);
    assert.match(jsonSent.error, /CSRF/i);
  });
});

test('redacción automática de datos sensibles en logging', () => {
  const sensitiveObj = {
    usuario: 'juan_perez',
    password: 'SuperPassword123!',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
    email: 'juan.perez@seguros.com.ar',
    dni_cuit: '20354448881',
    telefono: '1144445555'
  };

  const redacted = logger.redact(sensitiveObj);

  assert.strictEqual(redacted.usuario, 'juan_perez');
  assert.strictEqual(redacted.password, '[REDACTED]');
  assert.strictEqual(redacted.token, '[REDACTED]');
  assert.ok(!redacted.email.includes('juan.perez'));
  assert.ok(redacted.email.includes('***'));
  assert.ok(!redacted.dni_cuit.includes('35444888'));
});

const { me } = require('../controllers/authController');

test('controlador authController.me responde 401 si no hay usuario en sesión', async () => {
  let statusSent = null;
  let jsonSent = null;
  const mockRes = {
    status(c) { statusSent = c; return this; },
    json(d) { jsonSent = d; return this; },
    clearCookie() {}
  };

  await me({ user: null }, mockRes);
  assert.strictEqual(statusSent, 401);
  assert.match(jsonSent.error, /no autenticado/i);
});

