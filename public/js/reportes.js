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

document.addEventListener('DOMContentLoaded', () => {
  const user = JSON.parse(localStorage.getItem('gpg_user') || '{}');

  document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    const type = document.getElementById('report-select-type').value;
    window.open(`/api/reports/pdf?type=${type}&x-user-role=${user.rol}`, '_blank');
  });

  document.getElementById('btn-export-excel')?.addEventListener('click', () => {
    const type = document.getElementById('report-select-type').value;
    window.open(`/api/reports/excel?type=${type}&x-user-role=${user.rol}`, '_blank');
  });
});
