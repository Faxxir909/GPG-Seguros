const db = require('../db');

async function getDashboard(req, res, next) {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const fecha30 = new Date(); fecha30.setDate(fecha30.getDate() + 30);
    const fecha30Str = fecha30.toISOString().split('T')[0];
    const primerDiaMes = new Date(); primerDiaMes.setDate(1);
    const primerDiaMesStr = primerDiaMes.toISOString().split('T')[0];
    const periodoActual = new Date().toISOString().substring(0, 7);

    // Ejecutar todas las queries en paralelo (son independientes entre sí)
    const [
      clientesActivos,
      polizasVigentes,
      porVencer30,
      cotizacionesPendientes,
      siniestrosAbiertos,
      produccionMes,
      comisionesMes,
      listadoVencimientos
    ] = await Promise.all([
      db.get("SELECT COUNT(*) as count FROM clientes WHERE estado = 'activo'"),
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente'"),
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente' AND fecha_vencimiento >= ? AND fecha_vencimiento <= ?", [hoy, fecha30Str]),
      db.get("SELECT COUNT(*) as count FROM cotizaciones WHERE estado = 'pendiente' OR estado = 'enviada'"),
      db.get("SELECT COUNT(*) as count FROM siniestros WHERE estado != 'resuelto'"),
      db.get("SELECT SUM(monto_total) as total FROM polizas WHERE fecha_inicio >= ?", [primerDiaMesStr]),
      db.get("SELECT SUM(monto_comision) as total FROM comisiones WHERE periodo = ?", [periodoActual]),
      db.all(`
        SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono
        FROM polizas p
        JOIN clientes c ON p.cliente_id = c.id
        WHERE p.estado = 'vigente' AND p.fecha_vencimiento >= ?
        ORDER BY p.fecha_vencimiento ASC
        LIMIT 10
      `, [hoy])
    ]);

    res.json({
      clientesActivos: clientesActivos.count || 0,
      polizasVigentes: polizasVigentes.count || 0,
      porVencer30: porVencer30.count || 0,
      cotizacionesPendientes: cotizacionesPendientes.count || 0,
      siniestrosAbiertos: siniestrosAbiertos.count || 0,
      produccionMes: produccionMes.total || 0,
      comisionesMes: comisionesMes.total || 0,
      listadoVencimientos
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboard
};
