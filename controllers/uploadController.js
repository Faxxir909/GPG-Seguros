const path = require('path');
const fs = require('fs');
const db = require('../db');

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.xls', '.xlsx'];

async function uploadFile(req, res) {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'No se subió ningún archivo.' });
  }

  const { cliente_id, poliza_id, siniestro_id, tipo_documento } = req.body;
  const archivo = req.files.archivo;

  // Validar extensión de archivo para evitar malware/scripts
  const ext = path.extname(archivo.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido. Solo se aceptan PDFs, imágenes y documentos de oficina.' });
  }

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  // Generar nombre de archivo único
  const baseName = path.basename(archivo.name, ext).replace(/[^a-zA-Z0-9]/g, '_');
  const uniqueName = `${tipo_documento}_${Date.now()}_${baseName}${ext}`;
  const uploadPath = path.join(uploadsDir, uniqueName);

  archivo.mv(uploadPath, async (err) => {
    if (err) return res.status(500).json({ error: err.message });

    try {
      const result = await db.run(`
        INSERT INTO adjuntos (cliente_id, poliza_id, siniestro_id, nombre_archivo, ruta_archivo, tipo_documento)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        cliente_id ? parseInt(cliente_id) : null,
        poliza_id ? parseInt(poliza_id) : null,
        siniestro_id ? parseInt(siniestro_id) : null,
        archivo.name,
        `/uploads/${uniqueName}`,
        tipo_documento
      ]);

      res.status(201).json({ id: result.id, name: archivo.name, path: `/uploads/${uniqueName}` });
    } catch (dbErr) {
      res.status(500).json({ error: dbErr.message });
    }
  });
}

module.exports = {
  uploadFile
};
