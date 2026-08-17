// =========================================================================
// searchController.js — Buscador Global Inteligente (Spotlight / Ctrl + K)
// =========================================================================
const db = require('../db');

exports.globalSearch = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json({ results: [] });
    }

    const searchPattern = `%${q}%`;
    const results = [];

    // 1. Clientes
    const clients = await db.all(
      `SELECT id, nombre, dni_cuit, telefono, email, estado 
       FROM clientes 
       WHERE nombre ILIKE $1 OR dni_cuit ILIKE $1 OR telefono ILIKE $1 OR email ILIKE $1 
       LIMIT 6`,
      [searchPattern]
    ).catch(async () => {
      // Fallback SQLite LIKE
      return db.all(
        `SELECT id, nombre, dni_cuit, telefono, email, estado 
         FROM clientes 
         WHERE nombre LIKE ? OR dni_cuit LIKE ? OR telefono LIKE ? OR email LIKE ? 
         LIMIT 6`,
        [searchPattern, searchPattern, searchPattern, searchPattern]
      );
    });

    (clients || []).forEach(c => {
      results.push({
        category: 'Clientes',
        type: 'cliente',
        id: c.id,
        title: c.nombre,
        subtitle: `DNI/CUIT: ${c.dni_cuit || '--'} | Tel: ${c.telefono || '--'}`,
        badge: c.estado === 'activo' ? 'Activo' : 'Inactivo',
        badgeColor: c.estado === 'activo' ? 'success' : 'secondary',
        icon: 'fa-user'
      });
    });

    // 2. Pólizas
    const policies = await db.all(
      `SELECT p.id, p.numero_poliza, p.compania, p.cobertura, p.estado, p.fecha_vencimiento, c.nombre as cliente_nombre, c.id as cliente_id
       FROM polizas p
       JOIN clientes c ON p.cliente_id = c.id
       WHERE p.numero_poliza ILIKE $1 OR p.cobertura ILIKE $1 OR p.compania ILIKE $1
       LIMIT 6`,
      [searchPattern]
    ).catch(async () => {
      return db.all(
        `SELECT p.id, p.numero_poliza, p.compania, p.cobertura, p.estado, p.fecha_vencimiento, c.nombre as cliente_nombre, c.id as cliente_id
         FROM polizas p
         JOIN clientes c ON p.cliente_id = c.id
         WHERE p.numero_poliza LIKE ? OR p.cobertura LIKE ? OR p.compania LIKE ?
         LIMIT 6`,
        [searchPattern, searchPattern, searchPattern]
      );
    });

    (policies || []).forEach(p => {
      results.push({
        category: 'Pólizas',
        type: 'poliza',
        id: p.id,
        clienteId: p.cliente_id,
        title: `Póliza Nº ${p.numero_poliza}`,
        subtitle: `${p.cliente_nombre} | ${p.compania} (${p.cobertura})`,
        badge: p.estado,
        badgeColor: p.estado === 'vigente' ? 'success' : 'danger',
        icon: 'fa-file-shield'
      });
    });

    // 3. Vehículos
    const vehicles = await db.all(
      `SELECT v.id, v.patente, v.marca, v.modelo, v.motor, v.chasis, c.nombre as cliente_nombre, c.id as cliente_id
       FROM vehiculos v
       JOIN clientes c ON v.cliente_id = c.id
       WHERE v.patente ILIKE $1 OR v.marca ILIKE $1 OR v.modelo ILIKE $1 OR v.motor ILIKE $1 OR v.chasis ILIKE $1
       LIMIT 6`,
      [searchPattern]
    ).catch(async () => {
      return db.all(
        `SELECT v.id, v.patente, v.marca, v.modelo, v.motor, v.chasis, c.nombre as cliente_nombre, c.id as cliente_id
         FROM vehiculos v
         JOIN clientes c ON v.cliente_id = c.id
         WHERE v.patente LIKE ? OR v.marca LIKE ? OR v.modelo LIKE ? OR v.motor LIKE ? OR v.chasis LIKE ?
         LIMIT 6`,
        [searchPattern, searchPattern, searchPattern, searchPattern, searchPattern]
      );
    });

    (vehicles || []).forEach(v => {
      results.push({
        category: 'Vehículos',
        type: 'vehiculo',
        id: v.id,
        clienteId: v.cliente_id,
        title: `${v.marca} ${v.modelo} [${v.patente || 'S/Patente'}]`,
        subtitle: `Asegurado: ${v.cliente_nombre}${v.motor ? ` | Motor: ${v.motor}` : ''}`,
        badge: v.patente || 'Vehículo',
        badgeColor: 'primary',
        icon: 'fa-car'
      });
    });

    // 4. Siniestros
    const claims = await db.all(
      `SELECT s.id, s.numero_siniestro, s.fecha, s.estado, s.descripcion, c.nombre as cliente_nombre, c.id as cliente_id
       FROM siniestros s
       JOIN clientes c ON s.cliente_id = c.id
       WHERE s.numero_siniestro ILIKE $1 OR s.descripcion ILIKE $1
       LIMIT 4`,
      [searchPattern]
    ).catch(async () => {
      return db.all(
        `SELECT s.id, s.numero_siniestro, s.fecha, s.estado, s.descripcion, c.nombre as cliente_nombre, c.id as cliente_id
         FROM siniestros s
         JOIN clientes c ON s.cliente_id = c.id
         WHERE s.numero_siniestro LIKE ? OR s.descripcion LIKE ?
         LIMIT 4`,
        [searchPattern, searchPattern]
      );
    });

    (claims || []).forEach(s => {
      results.push({
        category: 'Siniestros',
        type: 'siniestro',
        id: s.id,
        clienteId: s.cliente_id,
        title: `Siniestro: ${s.numero_siniestro || 'Sin Nº'}`,
        subtitle: `${s.cliente_nombre} - ${s.descripcion ? s.descripcion.substring(0, 45) + '...' : ''}`,
        badge: s.estado,
        badgeColor: s.estado === 'resuelto' ? 'success' : 'warning',
        icon: 'fa-triangle-exclamation'
      });
    });

    res.json({ results });
  } catch (error) {
    console.error('Error en búsqueda global:', error);
    res.status(500).json({ error: 'Error al realizar la búsqueda global' });
  }
};
