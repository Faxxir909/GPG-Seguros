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

    // Actualizar Cola de Trabajo Operativa
    if (data.colaTrabajo) {
      const elVencidas = document.getElementById('cola-count-vencidas');
      const elRenovar  = document.getElementById('cola-count-renovar');
      const elMora     = document.getElementById('cola-count-mora');
      const elDocs     = document.getElementById('cola-count-docs');
      if (elVencidas) elVencidas.innerText = data.colaTrabajo.vencidas;
      if (elRenovar)  elRenovar.innerText  = data.colaTrabajo.renovar7d;
      if (elMora)     elMora.innerText     = data.colaTrabajo.cuotasMora;
      if (elDocs)     elDocs.innerText     = data.colaTrabajo.docsPendientes;
    }

    // Listado de Vencimientos
    const tbody = document.getElementById('dashboard-vencimientos-body');
    if (!data.listadoVencimientos || data.listadoVencimientos.length === 0) {
      showTableEmpty('dashboard-vencimientos-body', 4, 'No hay pólizas con vencimientos próximos en los siguientes 30 días.', 'fa-calendar-check');
    } else {
      let html = '';
      data.listadoVencimientos.forEach(p => {
        const cleanTel = normalizeArgentinePhone(p.cliente_telefono);
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

    // Inicializar Gráfico de comisiones con datos históricos reales
    initComisionesChart(data.graficoComisiones);
    initActionQueueEvents();
  } catch (err) {
    console.error('Error al cargar dashboard', err);
    showTableError('dashboard-vencimientos-body', 4, 'Error al cargar métricas del dashboard: ' + err.message, 'loadDashboardData()');
  }
}

function initActionQueueEvents() {
  const itemVencidas = document.getElementById('queue-item-vencidas');
  if (itemVencidas && !itemVencidas.dataset.bound) {
    itemVencidas.dataset.bound = 'true';
    itemVencidas.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      const polLink = document.querySelector('.sidebar-link[data-target="polizas"]');
      if (polLink) polLink.classList.add('active');
      loadPanel('polizas');
      setTimeout(() => {
        const btnVenc = document.querySelector('.exp-filter-pill[data-exp="vencidas"]');
        if (btnVenc) btnVenc.click();
      }, 100);
    });
  }

  const itemRenovar = document.getElementById('queue-item-renovar');
  if (itemRenovar && !itemRenovar.dataset.bound) {
    itemRenovar.dataset.bound = 'true';
    itemRenovar.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      const polLink = document.querySelector('.sidebar-link[data-target="polizas"]');
      if (polLink) polLink.classList.add('active');
      loadPanel('polizas');
      setTimeout(() => {
        const btn7d = document.querySelector('.exp-filter-pill[data-exp="7d"]');
        if (btn7d) btn7d.click();
      }, 100);
    });
  }

  const itemMora = document.getElementById('queue-item-mora');
  if (itemMora && !itemMora.dataset.bound) {
    itemMora.dataset.bound = 'true';
    itemMora.addEventListener('click', () => {
      openCollectionSummaryModal();
    });
  }

  const itemDocs = document.getElementById('queue-item-docs');
  if (itemDocs && !itemDocs.dataset.bound) {
    itemDocs.dataset.bound = 'true';
    itemDocs.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      const cliLink = document.querySelector('.sidebar-link[data-target="clientes"]');
      if (cliLink) cliLink.classList.add('active');
      loadPanel('clientes');
    });
  }
}

function initComisionesChart(graficoData) {
  const chartCanvas = document.getElementById('chartComisiones');
  if (!chartCanvas) return;
  const ctx = chartCanvas.getContext('2d');
  if (chartComisionesObj) chartComisionesObj.destroy();

  const labels = graficoData?.labels || ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'];
  const data = graficoData?.valores || [0, 0, 0, 0, 0, 0];

  chartComisionesObj = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Comisiones ($)',
        data: data,
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.12)',
        tension: 0.35,
        fill: true,
        borderWidth: 3,
        pointBackgroundColor: '#0284c7',
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `Comisiones: ${formatMoney(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
              if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'k';
              return '$' + value;
            }
          }
        }
      }
    }
  });
}

