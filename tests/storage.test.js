const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { detectMimeAndValidate, storageService, UPLOADS_DIR } = require('../services/storage');

test('servicio de almacenamiento y detección de tipos MIME reales', async t => {
  await t.test('detecta PDF válido por cabecera %PDF-', () => {
    const pdfBuf = Buffer.from('%PDF-1.4\n%âãÏÓ\n');
    const result = detectMimeAndValidate(pdfBuf, 'documento.pdf');
    assert.strictEqual(result.mime, 'application/pdf');
    assert.strictEqual(result.ext, '.pdf');
  });

  await t.test('detecta PNG válido por magic number', () => {
    const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    const result = detectMimeAndValidate(pngBuf, 'imagen.png');
    assert.strictEqual(result.mime, 'image/png');
    assert.strictEqual(result.ext, '.png');
  });

  await t.test('detecta JPEG válido por magic number', () => {
    const jpgBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const result = detectMimeAndValidate(jpgBuf, 'foto.jpg');
    assert.strictEqual(result.mime, 'image/jpeg');
  });

  await t.test('rechaza ejecutable Windows (MZ / PE) aunque tenga extensión .pdf', () => {
    const exeBuf = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00]); // MZ
    assert.throws(
      () => detectMimeAndValidate(exeBuf, 'malware.pdf'),
      err => err.status === 400 && /ejecutable|formato no permitido/i.test(err.message)
    );
  });

  await t.test('rechaza scripts con inyección HTML/<script>', () => {
    const scriptBuf = Buffer.from('<script>alert("xss")</script>');
    assert.throws(
      () => detectMimeAndValidate(scriptBuf, 'documento.pdf'),
      err => err.status === 400 && /formato no permitido/i.test(err.message)
    );
  });

  await t.test('rechaza buffers vacíos o no reconocidos', () => {
    assert.throws(() => detectMimeAndValidate(Buffer.alloc(0)), err => err.status === 400);
    assert.throws(() => detectMimeAndValidate(Buffer.from('texto plano arbitrario')), err => err.status === 400);
  });

  await t.test('guardado y eliminación atómica en disco local', async () => {
    const validPdf = Buffer.from('%PDF-1.5 test document content');
    const saved = await storageService.saveFile({
      buffer: validPdf,
      originalName: 'poliza_123.pdf',
      prefix: 'pdf'
    });

    assert.ok(saved.storageKey);
    assert.ok(saved.publicPath.startsWith('/uploads/'));

    const filePath = path.join(UPLOADS_DIR, saved.storageKey);
    assert.ok(fs.existsSync(filePath));

    // Probar eliminación (rollback)
    await storageService.deleteFile(saved.storageKey);
    assert.ok(!fs.existsSync(filePath));
  });
});
