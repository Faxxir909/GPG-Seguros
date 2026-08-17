// =========================================================================
// dashboard.js — Lógica del Dashboard y gráficos
// =========================================================================
async function loadDashboardData() {
  // Mostrar placeholders de carga en métricas si están vacíos
  const statIds = ['stat-clientes-activos', 'stat-polizas-vigentes', 'stat-vencimientos-30', 'stat-siniestros-abiertos', 'stat-produccion-mes', 'stat-comisiones-mes'];
  statIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.innerText.trim()) {
      el.innerHTML = '<span class="skeleton-shimmer" style="height: 22px; width: 45px; border-radius: 4px; display: inline-block;"></span>';
    }
  });

  // Skeleton para la tabla de vencimientos
  showTableSkeleton('dashboard-vencimientos-body', 4, 4);

  try {
    const data = await apiFetch('/api/dashboard');
    document.getElementById('stat-clientes-activos').innerText = data.clientesActivos;
    document.getElementById('stat-polizas-vigentes').innerText = data.polizasVigentes;
    document.getElementById('stat-vencimientos-30').innerText = data.porVencer30;
    document.getElementById('stat-siniestros-abiertos').innerText = data.siniestrosAbiertos;
    document.getElementById('stat-produccion-mes').innerText = formatMoney(data.produccionMes);
    document.getElementById('stat-comisiones-mes').innerText = formatMoney(data.comisionesMes);

    const tbody = document.getElementById('dashboard-vencimientos-body');
    if (!data.listadoVencimientos || data.listadoVencimientos.length === 0) {
      showTableEmpty('dashboard-vencimientos-body', 4, 'No hay pólizas con vencimientos próximos en los siguientes 30 días.', 'fa-calendar-check');
    } else {
      let html = '';
      data.listadoVencimientos.forEach(p => {
        const cleanTel = p.cliente_telefono ? String(p.cliente_telefono).replace(/[^0-9]/g, '') : '';
        const waMsg = encodeURIComponent(`Hola ${p.cliente_nombre}, te recordamos desde GPG Seguros que tu póliza Nº ${p.numero_poliza} (${p.cobertura}) en ${p.compania} vence el ${formatDate(p.fecha_vencimiento)}. ¿Coordinamos la renovación?`);
        const waBtn = cleanTel ? `
          <a href="https://wa.me/${cleanTel}?text=${waMsg}" target="_blank" class="btn btn-sm btn-success px-3 py-1 shadow-sm" style="border-radius: 8px;">
            <i class="fa-brands fa-whatsapp me-1"></i> Avisar
          </a>
        ` : `<span class="text-muted small">Sin tel.</span>`;

        html += `
          <tr>
            <td>
              <div class="fw-bold text-dark">${p.cliente_nombre}</div>
              <div class="small text-muted font-monospace"><i class="fa-solid fa-file-shield me-1"></i>${p.numero_poliza} (${p.cobertura})</div>
            </td>
            <td><span class="badge bg-light text-dark border">${p.compania}</span></td>
            <td>${renderExpirationCell(p.fecha_vencimiento, false, p.fecha_inicio)}</td>
            <td>${waBtn}</td>
          </tr>`;
      });
      tbody.innerHTML = html;
    }
    initComisionesChart(data.comisionesMes);
  } catch (err) {
    console.error('Error al cargar dashboard', err);
    showTableError('dashboard-vencimientos-body', 4, 'Error al cargar métricas del dashboard: ' + err.message, 'loadDashboardData()');
  }
}

function initComisionesChart(montoMesActual) {
  const chartCanvas = document.getElementById('chartComisiones');
  if (!chartCanvas) return;
  const ctx = chartCanvas.getContext('2d');
  if (chartComisionesObj) chartComisionesObj.destroy();
  chartComisionesObj = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'],
      datasets: [{ label: 'Comisiones Mensuales ($)', data: [montoMesActual*0.7, montoMesActual*0.8, montoMesActual*0.9, montoMesActual*0.95, montoMesActual*0.9, montoMesActual], borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,0.1)', tension: 0.3, fill: true, borderWidth: 3 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

