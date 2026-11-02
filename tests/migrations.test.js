const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { listMigrationFiles, checksum } = require('../database/migrate');

const root = path.join(__dirname, '..');

test('migraciones versionadas y ordenadas', () => {
  const files = listMigrationFiles();
  assert.deepStrictEqual(files, [...files].sort());
  assert.ok(files.length >= 3);
  assert.match(files[0], /^001_/);
  assert.match(files[1], /^002_/);
  assert.match(files[2], /^003_/);

  for (const file of files) {
    const content = fs.readFileSync(path.join(root, 'migrations', file), 'utf8');
    assert.match(checksum(content), /^[a-f0-9]{64}$/);
    assert.ok(content.trim().length > 100);
  }
});

test('la migración 003 instala protección append-only en auditoría y constraints', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '003_concurrency_and_integrity.sql'), 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION gpg_proteger_auditoria_append_only/);
  assert.match(sql, /CREATE TRIGGER trg_auditoria_append_only/);
  assert.match(sql, /cotizaciones_estado_check/);
  assert.match(sql, /idx_polizas_numero_renovacion_asc/);
});

test('el esquema base contiene integridad financiera y referencial', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '001_baseline.sql'), 'utf8');
  for (const table of [
    'usuarios', 'clientes', 'vehiculos', 'polizas', 'cotizaciones', 'siniestros',
    'agenda', 'crm_logs', 'comisiones', 'adjuntos', 'tasas_comision',
    'cuotas_cobranza', 'auditoria_eventos'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
  }
  assert.match(sql, /NUMERIC\(14,2\)/);
  assert.match(sql, /CHECK \(fecha_vencimiento >= fecha_inicio\)/);
  assert.match(sql, /CHECK \(tasa_comision BETWEEN 0 AND 1\)/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /\bREAL\b|AUTOINCREMENT|INSERT OR IGNORE/i);
});

test('la migración de endurecimiento instala auditoría e índices de búsqueda', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '002_integrity_audit_search.sql'), 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION gpg_auditar_cambio/);
  assert.match(sql, /CREATE TRIGGER trg_%I_auditoria/);
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(sql, /USING GIN/);
  assert.match(sql, /gpg_set_actualizado_en/);
});

test('la aplicación no conserva rutas de ejecución SQLite', () => {
  const files = [
    'db.js', 'server.js', 'controllers/paymentController.js',
    'controllers/searchController.js', 'package.json'
  ];
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(content, /sqlite|INSERT OR IGNORE|AUTOINCREMENT/i, file);
  }
});
