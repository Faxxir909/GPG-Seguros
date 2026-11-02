const db = require('../db');
const { storageService } = require('../services/storage');

const ALLOWED_DOC_TYPES = ['dni', 'cedula', 'licencia', 'afip', 'pdf', 'foto', 'denuncia', 'formulario', 'otro'];

async function uploadFile(req, res, next) {
  if (!req.files || Object.keys(req.files).length === 0 || !req.files.archivo) {
    return res.status(400).json({ error: 'No se subió ningún archivo.' });
  }

  const { cliente_id, poliza_id, siniestro_id, tipo_documento } = req.body;
  const archivo = req.files.archivo;

  const tipoDoc = (tipo_documento || 'otro').toLowerCase().trim();
  if (!ALLOWED_DOC_TYPES.includes(tipoDoc)) {
    return res.status(400).json({
      error: `Tipo de documento inválido. Opciones permitidas: ${ALLOWED_DOC_TYPES.join(', ')}.`
    });
  }

  const cId = cliente_id ? parseInt(cliente_id, 10) : null;
  const pId = poliza_id ? parseInt(poliza_id, 10) : null;
  const sId = siniestro_id ? parseInt(siniestro_id, 10) : null;

  // Validación: Debe tener exactamente una entidad asociada
  const nonNullParents = [cId, pId, sId].filter(id => id !== null && !isNaN(id) && id > 0);
  if (nonNullParents.length !== 1) {
    return res.status(400).json({
      error: 'El archivo adjunto debe estar asociado exactamente a un cliente, una póliza o un siniestro.'
    });
  }

  let savedStorage = null;

  try {
    // 1. Guardar archivo con verificación de contenido real (magic numbers) y UUID seguro
    savedStorage = await storageService.saveFile({
      buffer: archivo.data,
      originalName: archivo.name,
      prefix: tipoDoc
    });

    // 2. Registrar en la base de datos dentro de transacción con contexto de usuario
    const result = await db.withTransaction(async trx => {
      return await trx.run(`
        INSERT INTO adjuntos (cliente_id, poliza_id, siniestro_id, nombre_archivo, ruta_archivo, tipo_documento)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        cId,
        pId,
        sId,
        savedStorage.safeName,
        savedStorage.publicPath,
        tipoDoc
      ]);
    }, { userId: req.user?.id, requestId: req.id });

    return res.status(201).json({
      id: result.id,
      name: savedStorage.safeName,
      path: savedStorage.publicPath,
      tipo_documento: tipoDoc
    });
  } catch (err) {
    // 3. Rollback de almacenamiento: Si la base de datos falla o hay error de guardado,
    // eliminar inmediatamente el archivo para no dejar huérfanos.
    if (savedStorage?.storageKey) {
      await storageService.deleteFile(savedStorage.storageKey);
    }

    if (err.status && err.status < 500) {
      return res.status(err.status).json({ error: err.message });
    }

    // No exponer rutas físicas ni errores SQL al cliente
    console.error('[Upload Error]:', err.message);
    return res.status(500).json({ error: 'Error interno al procesar el archivo adjunto.' });
  }
}

module.exports = {
  uploadFile
};
