const db = require('../db');

async function getDashboard(req, res, next) {
  try {
    // PostgreSQL define la fecha de negocio en America/Argentina/Buenos_Aires.
    const periodos = await db.all(`
      SELECT TO_CHAR(month_start, 'YYYY-MM') AS periodo
      FROM GENERATE_SERIES(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
        DATE_TRUNC('month', CURRENT_DATE),
        INTERVAL '1 month'
      ) AS month_start
      ORDER BY month_start
    `);
    const periodosCodigos = periodos.map(row => row.periodo);
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const periodosLabels = periodosCodigos.map(code => monthNames[Number(code.slice(5, 7)) - 1]);
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
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente' AND fecha_vencimiento >= CURRENT_DATE"),
      // Vencimientos en los próximos 30 días
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente' AND fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 30"),
      db.get("SELECT COUNT(*) as count FROM cotizaciones WHERE estado = 'pendiente' OR estado = 'enviada'"),
      db.get("SELECT COUNT(*) as count FROM siniestros WHERE estado != 'resuelto'"),
      db.get("SELECT SUM(monto_total) as total FROM polizas WHERE fecha_inicio >= DATE_TRUNC('month', CURRENT_DATE)::date"),
      db.get("SELECT SUM(monto_comision) as total FROM comisiones WHERE periodo = TO_CHAR(CURRENT_DATE, 'YYYY-MM')"),
      // Listado de vencimientos con límite superior estricto (hoy a hoy+30d)
      db.all(`
        SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono
        FROM polizas p
        JOIN clientes c ON p.cliente_id = c.id
        WHERE p.estado = 'vigente'
          AND p.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
        ORDER BY p.fecha_vencimiento ASC
        LIMIT 10
      `),
      // Métricas de Cola de Trabajo Operativa
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vencida' OR (estado = 'vigente' AND fecha_vencimiento < CURRENT_DATE)"),
      db.get("SELECT COUNT(*) as count FROM polizas WHERE estado = 'vigente' AND fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7"),
      db.get("SELECT COUNT(*) as count FROM cuotas_cobranza WHERE estado = 'en_mora' OR (estado = 'pendiente' AND fecha_vencimiento < CURRENT_DATE)"),
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
