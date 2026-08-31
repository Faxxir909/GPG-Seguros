const db = require('../db');

async function getDashboard(req, res, next) {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const fecha30 = new Date(); fecha30.setDate(fecha30.getDate() + 30);
    const fecha30Str = fecha30.toISOString().split('T')[0];
    const fecha7 = new Date(); fecha7.setDate(fecha7.getDate() + 7);
    const fecha7Str = fecha7.toISOString().split('T')[0];
    const primerDiaMes = new Date(); primerDiaMes.setDate(1);
    const primerDiaMesStr = primerDiaMes.toISOString().split('T')[0];
    const periodoActual = new Date().toISOString().substring(0, 7);

    // Generar últimos 6 meses para histórico real de comisiones
    const periodosCodigos = [];
    const periodosLabels = [];
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const code = d.toISOString().substring(0, 7);
      periodosCodigos.push(code);
      periodosLabels.push(monthNames[d.getMonth()]);
    }
    const primerPeriodo = periodosCodigos[0];

    // Ejecutar todas las queries en paralelo
    const [
      clientesActivos,
      polizasVigentes,
      porVencer30,
      cotizacionesPendientes,
      siniestrosAbiertos,
      produccionMes,
      comisionesMes,
      listadoVencimientos,
      vencidasTotal,
      renovar7dTotal,
      cuotasMoraTotal,
      docsPendientesTotal,
      comisionesHistoricas
    ] = await Promise.all([
      db.get("SELECT COUNT(*) as count FROM clientes WHERE estado = 'activo'"),
      // Contar solo pólizas realmente vigentes y no vencidas por fecha
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente' AND fecha_vencimiento >= ?", [hoy]),
      // Vencimientos en los próximos 30 días
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente' AND fecha_vencimiento >= ? AND fecha_vencimiento <= ?", [hoy, fecha30Str]),
      db.get("SELECT COUNT(*) as count FROM cotizaciones WHERE estado = 'pendiente' OR estado = 'enviada'"),
      db.get("SELECT COUNT(*) as count FROM siniestros WHERE estado != 'resuelto'"),
      db.get("SELECT SUM(monto_total) as total FROM polizas WHERE fecha_inicio >= ?", [primerDiaMesStr]),
      db.get("SELECT SUM(monto_comision) as total FROM comisiones WHERE periodo = ?", [periodoActual]),
      // Listado de vencimientos con límite superior estricto (hoy a hoy+30d)
      db.all(`
        SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono
        FROM polizas p
        JOIN clientes c ON p.cliente_id = c.id
        WHERE p.estado = 'vigente' AND p.fecha_vencimiento >= ? AND p.fecha_vencimiento <= ?
        ORDER BY p.fecha_vencimiento ASC
        LIMIT 10
      `, [hoy, fecha30Str]),
      // Métricas de Cola de Trabajo Operativa
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vencida' OR (estado = 'vigente' AND fecha_vencimiento < ?)", [hoy]),
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente' AND fecha_vencimiento >= ? AND fecha_vencimiento <= ?", [hoy, fecha7Str]),
      db.get("SELECT COUNT(*) as count FROM cuotas_cobranza WHERE estado = 'vencida' OR (estado = 'pendiente' AND fecha_vencimiento < ?)", [hoy]),
      db.get("SELECT COUNT(*) as count FROM clientes WHERE id NOT IN (SELECT DISTINCT cliente_id FROM adjuntos WHERE cliente_id IS NOT NULL)"),
      // Histórico real de comisiones
      db.all(`
        SELECT periodo, SUM(monto_comision) as total
        FROM comisiones
        WHERE periodo >= ?
        GROUP BY periodo
        ORDER BY periodo ASC
      `, [primerPeriodo])
    ]);

    // Mapear montos reales a las etiquetas de los últimos 6 meses
    const comisionesMap = {};
    (comisionesHistoricas || []).forEach(r => {
      comisionesMap[r.periodo] = parseFloat(r.total || 0);
    });
    const historicoValores = periodosCodigos.map(code => comisionesMap[code] || 0);

    res.json({
      clientesActivos: clientesActivos?.count || 0,
      polizasVigentes: polizasVigentes?.count || 0,
      porVencer30: porVencer30?.count || 0,
      cotizacionesPendientes: cotizacionesPendientes?.count || 0,
      siniestrosAbiertos: siniestrosAbiertos?.count || 0,
      produccionMes: produccionMes?.total || 0,
      comisionesMes: comisionesMes?.total || 0,
      listadoVencimientos: listadoVencimientos || [],
      // Cola de Trabajo
      colaTrabajo: {
        vencidas: vencidasTotal?.count || 0,
        renovar7d: renovar7dTotal?.count || 0,
        cuotasMora: cuotasMoraTotal?.count || 0,
        docsPendientes: docsPendientesTotal?.count || 0
      },
      // Histórico real para gráfico
      graficoComisiones: {
        labels: periodosLabels,
        valores: historicoValores,
        periodos: periodosCodigos
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboard
};
