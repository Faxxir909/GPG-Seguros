// =========================================================================
// dashboard.js — Lógica del Dashboard y gráficos
// =========================================================================
async function loadDashboardData() {
  try {
    const data = await apiFetch('/api/dashboard');
    document.getElementById('stat-clientes-activos').innerText = data.clientesActivos;
    document.getElementById('stat-polizas-vigentes').innerText = data.polizasVigentes;
    document.getElementById('stat-vencimientos-30').innerText = data.porVencer30;
    document.getElementById('stat-siniestros-abiertos').innerText = data.siniestrosAbiertos;
    document.getElementById('stat-produccion-mes').innerText = formatMoney(data.produccionMes);
    document.getElementById('stat-comisiones-mes').innerText = formatMoney(data.comisionesMes);

    const tbody = document.getElementById('dashboard-vencimientos-body');
    tbody.innerHTML = '';
    if (data.listadoVencimientos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay vencimientos próximos.</td></tr>`;
    } else {
      data.listadoVencimientos.forEach(p => {
        const waMsg = encodeURIComponent(`Hola ${p.cliente_nombre}, te recordamos que tu póliza Nº ${p.numero_poliza} (${p.cobertura}) en ${p.compania} vence el ${formatDate(p.fecha_vencimiento)}. Por favor contáctanos para coordinar la renovación.`);
        const waUrl = `https://wa.me/${p.cliente_telefono}?text=${waMsg}`;
        tbody.innerHTML += `<tr><td><strong>${p.cliente_nombre}</strong></td><td>${p.compania}</td><td class="text-danger fw-bold">${formatDate(p.fecha_vencimiento)}</td><td><a href="${waUrl}" target="_blank" class="btn-whatsapp-share"><i class="fa-brands fa-whatsapp"></i> Avisar</a></td></tr>`;
      });
    }
    initComisionesChart(data.comisionesMes);
  } catch (err) { console.error('Error al cargar dashboard', err); }
}

function initComisionesChart(montoMesActual) {
  const ctx = document.getElementById('chartComisiones').getContext('2d');
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
