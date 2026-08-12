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

async function loadCommissionRates() {
  const tbody = document.getElementById('tasas-table-body');
  if (!tbody) return;
  try {
    const rates = await apiFetch('/api/commission-rates');
    if (!rates.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">No hay tasas configuradas.</td></tr>';
      return;
    }
    let html = '';
    rates.forEach(r => {
      const pct = (parseFloat(r.tasa) * 100).toFixed(1);
      html += `
        <tr>
          <td><strong>${r.compania}</strong></td>
          <td><code>${r.tipo_cobertura || '*'}</code></td>
          <td class="fw-bold text-success">${pct}%</td>
          <td><span class="badge bg-success">Activa</span></td>
        </tr>`;
    });
    tbody.innerHTML = html;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-3">Error: ${err.message}</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filter-com-period')?.addEventListener('change', filterCommissions);
  document.getElementById('filter-com-company')?.addEventListener('change', filterCommissions);

  document.getElementById('btn-manage-rates')?.addEventListener('click', () => {
    loadCommissionRates();
    new bootstrap.Modal(document.getElementById('modalTasasComision')).show();
  });

  document.getElementById('formTasaComision')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const company = document.getElementById('rate-company').value.trim();
    const coverage = document.getElementById('rate-coverage').value.trim() || '*';
    const percent = parseFloat(document.getElementById('rate-percent').value);

    if (!company || isNaN(percent) || percent < 0 || percent > 100) {
      showToast('Por favor complete una compañía y porcentaje válido (0 a 100).', 'warning');
      return;
    }

    try {
      await apiFetch('/api/commission-rates', {
        method: 'POST',
        body: {
          compania: company,
          tipo_cobertura: coverage,
          tasa: percent / 100,
          activa: true
        }
      });
      showToast(`Tasa para ${company} guardada con éxito (${percent}%).`, 'success');
      document.getElementById('formTasaComision').reset();
      document.getElementById('rate-coverage').value = '*';
      loadCommissionRates();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });
});
