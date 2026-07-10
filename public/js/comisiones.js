// =========================================================================
// comisiones.js
// =========================================================================
let allCommissions = [];

async function loadCommissionsList() {
  try {
    const data = await apiFetch('/api/commissions');
    allCommissions = data;
    renderCommissions(data);
    const periodSelect = document.getElementById('filter-com-period');
    periodSelect.innerHTML = '<option value="">Todos los Períodos</option>';
    [...new Set(data.map(c => c.periodo))].sort().reverse().forEach(p => { periodSelect.innerHTML += `<option value="${p}">${p}</option>`; });
  } catch (err) { console.error(err); }
}

function renderCommissions(commissions) {
  const tbody = document.getElementById('comisiones-table-body');
  tbody.innerHTML = '';
  if (commissions.length === 0) { tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">No hay comisiones registradas.</td></tr>`; return; }
  const user = JSON.parse(localStorage.getItem('gpg_user') || '{}');
  commissions.forEach(c => {
    const isPaid = c.estado_pago === 'pagado';
    const statusBadge = isPaid ? `<span class="badge bg-success">Cobrado</span>` : `<span class="badge bg-warning">Pendiente</span>`;
    const actionBtn = !isPaid && user.rol === 'admin' ? `<button class="btn btn-sm btn-success" onclick="markCommissionPaid(${c.id})"><i class="fa-solid fa-cash-register me-1"></i> Cobrar</button>` : '--';
    tbody.innerHTML += `<tr><td><strong>${c.numero_poliza}</strong></td><td>${c.cliente_nombre}</td><td>${c.compania}</td><td>${c.periodo}</td><td>${formatMoney(c.monto_poliza)}</td><td>${c.tasa_comision*100}%</td><td class="fw-bold text-success">${formatMoney(c.monto_comision)}</td><td>${statusBadge}</td><td class="action-col">${actionBtn}</td></tr>`;
  });
}

async function markCommissionPaid(id) {
  const ok = await showConfirm({ title: 'Marcar como Cobrado', message: '¿Desea marcar esta comisión como cobrada/liquidada?', okText: 'Confirmar Cobro', okClass: 'btn-success', icon: 'fa-cash-register text-success' });
  if (ok) {
    try { await apiFetch(`/api/commissions/${id}`, { method: 'PUT', body: { estado_pago: 'pagado' } }); loadCommissionsList(); showToast('Comisión marcada como cobrada.', 'success'); }
    catch (err) { showToast(err.message, 'danger'); }
  }
}

function filterCommissions() {
  const period = document.getElementById('filter-com-period').value;
  const company = document.getElementById('filter-com-company').value;
  renderCommissions(allCommissions.filter(c => (period===''||c.periodo===period) && (company===''||c.compania===company)));
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filter-com-period')?.addEventListener('change', filterCommissions);
  document.getElementById('filter-com-company')?.addEventListener('change', filterCommissions);
});
