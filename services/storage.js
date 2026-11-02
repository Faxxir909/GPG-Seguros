const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const UPLOADS_DIR = process.env.STORAGE_LOCAL_DIR || path.join(__dirname, '..', 'uploads');

// Magic numbers para verificación de contenido real
const SIGNATURES = [
  { mime: 'application/pdf', ext: '.pdf', check: buf => buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'image/png', ext: '.png', check: buf => buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 },
  { mime: 'image/jpeg', ext: '.jpg', check: buf => buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF },
  { mime: 'image/webp', ext: '.webp', check: buf => buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP' },
  {
    mime: 'application/vnd.openxmlformats-officedocument',
    exts: ['.docx', '.xlsx'],
    check: buf => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04
  },
  {
    mime: 'application/msword-or-excel',
    exts: ['.doc', '.xls'],
    check: buf => buf.length >= 8 && buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0
  }
];

// Firmas explícitamente maliciosas / ejecutables que deben ser rechazadas de inmediato
const FORBIDDEN_SIGNATURES = [
  { type: 'PE Executable (.exe/.dll)', check: buf => buf.length >= 2 && buf[0] === 0x4D && buf[1] === 0x5A }, // MZ
  { type: 'ELF Binary', check: buf => buf.length >= 4 && buf[0] === 0x7F && buf[1] === 0x45 && buf[2] === 0x4C && buf[3] === 0x46 },
  { type: 'Shell Script', check: buf => buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21 }, // #!
  { type: 'HTML/Script injection', check: buf => {
    const head = buf.subarray(0, 100).toString('utf8').toLowerCase();
    return head.includes('<script') || head.includes('<?php') || head.includes('<html');
  }}
];

function isEphemeralEnvironment() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

function detectMimeAndValidate(buffer, declaredName = '') {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('El archivo está vacío o no contiene datos válidos.');
    err.status = 400;
    throw err;
  }

  // 1. Rechazo inmediato de binarios ejecutables o scripts
  for (const forbidden of FORBIDDEN_SIGNATURES) {
    if (forbidden.check(buffer)) {
      const err = new Error(`El archivo contiene un formato no permitido (${forbidden.type}).`);
      err.status = 400;
      throw err;
    }
  }

  // 2. Comprobar contra firmas permitidas
  const declaredExt = path.extname(declaredName).toLowerCase();
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) {
      if (sig.exts) {
        // Formatos compuestos (e.g. Office zip o msword): validar que la extensión declarada coincida
        if (sig.exts.includes(declaredExt)) {
          return { mime: sig.mime, ext: declaredExt };
        }
        return { mime: sig.mime, ext: sig.exts[0] };
      }
      return { mime: sig.mime, ext: sig.ext };
    }
  }

  const err = new Error('Tipo de archivo no permitido. Solo se aceptan PDFs, imágenes y documentos de oficina válidos.');
  err.status = 400;
  throw err;
}

class StorageService {
  constructor() {
    this.isProd = process.env.NODE_ENV === 'production';
    this.provider = process.env.STORAGE_PROVIDER || null;
  }

  assertAvailable() {
    if (this.isProd && !process.env.STORAGE_ALLOW_LOCAL) {
      if (isEphemeralEnvironment() || !this.provider) {
        const err = new Error('Almacenamiento persistente no configurado en producción. Se requiere configurar un proveedor de almacenamiento persistente para adjuntos.');
        err.code = 'STORAGE_NOT_CONFIGURED';
        err.status = 503;
        throw err;
      }
    }
  }

  async saveFile({ buffer, originalName, prefix = 'doc' }) {
    this.assertAvailable();

    const { ext } = detectMimeAndValidate(buffer, originalName);

    // Evitar path traversal y sanitizar prefijo
    const safePrefix = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const storageKey = `${safePrefix}_${randomUUID()}${ext}`;

    // Si hay proveedor externo configurado (S3/GCS/Azure en el futuro):
    if (this.provider && this.provider !== 'local') {
      const err = new Error(`Proveedor de almacenamiento '${this.provider}' configurado pero su conector aún no fue inicializado.`);
      err.status = 503;
      throw err;
    }

    // Driver local para desarrollo y entornos autorizados
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const safeFilename = path.basename(storageKey);
    const destination = path.join(UPLOADS_DIR, safeFilename);

    await fs.promises.writeFile(destination, buffer);

    return {
      storageKey: safeFilename,
      publicPath: `/uploads/${safeFilename}`,
      safeName: path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_')
    };
  }

  async deleteFile(storageKey) {
    if (!storageKey) return;
    try {
      const safeFilename = path.basename(storageKey);
      const filePath = path.join(UPLOADS_DIR, safeFilename);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      // Registrar internamente pero no interrumpir
      console.error(`[Storage Error]: No se pudo eliminar archivo temporal ${storageKey}:`, err.message);
    }
  }

  getLocalFilePath(storageKey) {
    const safeFilename = path.basename(storageKey);
    return path.join(UPLOADS_DIR, safeFilename);
  }
}

const storageService = new StorageService();

module.exports = {
  storageService,
  detectMimeAndValidate,
  isEphemeralEnvironment,
  UPLOADS_DIR
};
