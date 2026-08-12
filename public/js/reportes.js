// =========================================================================
// reportes.js
// =========================================================================
async function loadReportsData() {
  try {
    const policies = await apiFetch('/api/policies');
    const counts = {};
    policies.forEach(p => { counts[p.compania] = (counts[p.compania] || 0) + 1; });
    const labels = Object.keys(counts);
    const chartData = Object.values(counts);
    const ctx = document.getElementById('chartProduccionCompania').getContext('2d');
    if (chartProduccionObj) chartProduccionObj.destroy();
    chartProduccionObj = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: labels.length ? labels : ['Sin datos'], datasets: [{ data: chartData.length ? chartData : [1], backgroundColor: ['#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6'], borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } } }
    });
  } catch (err) { console.error(err); }
}

async function downloadReportFile(format) {
  const type = document.getElementById('report-select-type').value;
  try {
    showToast('Generando reporte, por favor aguarde...', 'info', 2000);
    const res = await fetch(`/api/reports/${format}?type=${type}`, { credentials: 'include' });
    if (!res.ok) {
      let errorMsg = 'Error al generar el reporte.';
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) errorMsg = errJson.error;
      } catch {}
      throw new Error(errorMsg);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte_${type}_${Date.now()}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('Reporte descargado correctamente.', 'success');
  } catch (err) {
    showToast('Error al exportar: ' + err.message, 'danger');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => downloadReportFile('pdf'));
  document.getElementById('btn-export-excel')?.addEventListener('click', () => downloadReportFile('excel'));
});
