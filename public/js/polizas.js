// =========================================================================
// polizas.js — Listado general de pólizas y renovaciones
// =========================================================================
let allPolicies = [];

async function loadPoliciesList() {
  try {
    const data = await apiFetch('/api/policies');
    allPolicies = data;
    policiesPage = 1;
    renderPoliciesPage();
  } catch (err) { console.error(err); }
}

function renderPoliciesPage() {
  const query  = document.getElementById('search-policy').value.toLowerCase();
  const status  = document.getElementById('filter-policy-status').value;
  const company = document.getElementById('filter-policy-company').value;

  const filtered = allPolicies.filter(p => {
    const matchSearch  = (p.numero_poliza || '').toLowerCase().includes(query) || (p.cliente_nombre || '').toLowerCase().includes(query);
    const matchStatus  = status  === '' || p.estado   === status;
    const matchCompany = company === '' || p.compania === company;
    return matchSearch && matchStatus && matchCompany;
  });

  policiesPage = paginate({
    items: filtered, page: policiesPage, pageSize: PAGE_SIZE,
    tbodyId: 'policies-table-body', renderFn: renderPolicies,
    wrapId: 'policies-pagination-wrap', infoId: 'policies-pagination-info', navId: 'policies-pagination'
  });

  const nav = document.getElementById('policies-pagination');
  nav.addEventListener('pagechange', () => { policiesPage = parseInt(nav.dataset.page); renderPoliciesPage(); }, { once: true });
}

function renderPolicies(policies) {
  const tbody = document.getElementById('policies-table-body');
  tbody.innerHTML = '';
  if (policies.length === 0) { tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">No se encontraron pólizas.</td></tr>`; return; }
  policies.forEach(p => {
    const vDesc = p.marca ? `${p.marca} ${p.modelo} <span class="small font-monospace bg-light p-1">(${p.patente})</span>` : 'Sin vehículo';
    const renLabel = p.numero_renovacion > 0 ? ` <span class="badge bg-info text-dark" style="font-size:10px;">Ren. ${p.numero_renovacion}</span>` : '';
    tbody.innerHTML += `
      <tr>
        <td><strong>${p.numero_poliza || 'PENDIENTE'}</strong>${renLabel}</td>
        <td>${p.cliente_nombre}</td>
        <td>${vDesc}</td>
        <td>${p.compania}</td>
        <td>${p.cobertura}</td>
        <td class="fw-bold">${formatDate(p.fecha_vencimiento)}</td>
        <td><div class="fw-bold text-success">${formatMoney(p.valor_cuota)}/mes</div><div class="small text-muted">${p.forma_pago}</div></td>
        <td><span class="badge-status badge-${p.estado}">${p.estado}</span></td>
        <td>${p.estado === 'vencida' ? `<button class="btn btn-sm btn-success py-1" onclick="quickRenewPolicy(${p.id})"><i class="fa-solid fa-rotate"></i></button>` : ''}</td>
      </tr>`;
  });
}

function filterPolicies() { policiesPage = 1; renderPoliciesPage(); }

function quickRenewPolicy(policyId) {
  document.getElementById('renovar-poliza-id').value = policyId;
  document.getElementById('ren-nuevo-numero').value = '';
  document.getElementById('ren-tipo-cuatrimestral').checked = true;
  document.getElementById('div-nuevo-numero-poliza').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('modalRenovacion')).show();
}

async function deletePolicy(policyId) {
  const ok = await showConfirm({ title: 'Eliminar Póliza', message: '¿Está seguro de eliminar esta póliza?', okText: 'Sí, eliminar', okClass: 'btn-danger' });
  if (ok) {
    try { await apiFetch(`/api/policies/${policyId}`, { method: 'DELETE' }); loadClientPolicies(); showToast('Póliza eliminada.', 'success'); }
    catch (err) { showToast(err.message, 'danger'); }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-policy')?.addEventListener('keyup', filterPolicies);
  document.getElementById('filter-policy-status')?.addEventListener('change', filterPolicies);
  document.getElementById('filter-policy-company')?.addEventListener('change', filterPolicies);

  // Mostrar/ocultar campo nuevo número en renovación
  document.addEventListener('change', (e) => {
    if (e.target?.name === 'tipoRenovacion') {
      const divNuevoNum = document.getElementById('div-nuevo-numero-poliza');
      const isAnual = e.target.value === 'anual';
      divNuevoNum.classList.toggle('d-none', !isAnual);
      document.getElementById('ren-nuevo-numero').required = isAnual;
    }
  });

  // Enviar formulario de renovación
  document.addEventListener('submit', async (e) => {
    if (e.target?.id !== 'formRenovacion') return;
    e.preventDefault();
    const policyId = document.getElementById('renovar-poliza-id').value;
    const tipo = document.querySelector('input[name="tipoRenovacion"]:checked').value;
    const numero_poliza = document.getElementById('ren-nuevo-numero').value.trim();
    const payload = { tipo };
    if (tipo === 'anual') {
      if (!numero_poliza) { showToast('Por favor, ingrese el nuevo número de póliza.', 'warning'); return; }
      payload.numero_poliza = numero_poliza;
    }
    try {
      await apiFetch(`/api/policies/${policyId}/renew`, { method: 'POST', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalRenovacion')).hide();
      showToast('Póliza renovada con éxito.', 'success');
      if (document.getElementById('panel-polizas').classList.contains('d-none')) {
        loadClientPolicies();
      } else {
        loadPoliciesList();
      }
    } catch (err) { showToast('Error al renovar póliza: ' + err.message, 'danger'); }
  });
});
