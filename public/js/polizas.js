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
}

function renderPolicies(policies) {
  const tbody = document.getElementById('policies-table-body');
  if (policies.length === 0) { tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">No se encontraron pólizas.</td></tr>`; return; }
  let html = '';
  policies.forEach(p => {
    const motorTag = p.motor ? `<div class="small text-muted"><i class="fa-solid fa-gears me-1"></i>Mot: ${p.motor}</div>` : '';
    const vDesc = p.marca ? `${p.marca} ${p.modelo} <span class="small font-monospace bg-light p-1">(${p.patente})</span>${motorTag}` : 'Sin vehículo';
    const renLabel = p.numero_renovacion > 0 ? ` <span class="badge bg-info text-dark" style="font-size:10px;">Ren. ${p.numero_renovacion}</span>` : '';
    
    const cuotaDisplay = (p.valor_cuota && parseFloat(p.valor_cuota) > 0)
      ? `<div class="fw-bold text-success">${formatMoney(p.valor_cuota)}/mes</div>`
      : (p.monto_total && parseFloat(p.monto_total) > 0)
        ? `<div class="fw-bold text-success">${formatMoney(p.monto_total)}</div>`
        : `<span class="badge bg-warning text-dark cursor-pointer" onclick="openEditPolicyModal(${p.id})" title="Hacer clic para ingresar valor de la cuota"><i class="fa-solid fa-pen me-1"></i> A ingresar</span>`;

    html += `
      <tr>
        <td><strong>${p.numero_poliza || 'PENDIENTE'}</strong>${renLabel}</td>
        <td>${p.cliente_nombre}</td>
        <td>${vDesc}</td>
        <td>${p.compania}</td>
        <td>${p.cobertura}</td>
        <td class="fw-bold">${formatDate(p.fecha_vencimiento)}</td>
        <td>${cuotaDisplay}<div class="small text-muted">${p.forma_pago || ''}</div></td>
        <td><span class="badge-status badge-${p.estado}">${p.estado}</span></td>
        <td>
          <button class="btn btn-sm btn-outline-primary py-1 me-1" title="Editar Póliza" onclick="openEditPolicyModal(${p.id})"><i class="fa-solid fa-pen-to-square"></i></button>
          ${p.estado === 'vencida' ? `<button class="btn btn-sm btn-success py-1" title="Renovar Póliza" onclick="quickRenewPolicy(${p.id})"><i class="fa-solid fa-rotate"></i></button>` : ''}
        </td>
      </tr>`;
  });
  tbody.innerHTML = html;
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
  document.getElementById('search-policy')?.addEventListener('input', debounce(filterPolicies, 350));
  document.getElementById('filter-policy-status')?.addEventListener('change', filterPolicies);
  document.getElementById('filter-policy-company')?.addEventListener('change', filterPolicies);

  // Escuchador de paginación estable
  document.getElementById('policies-pagination')?.addEventListener('pagechange', (e) => {
    policiesPage = parseInt(e.currentTarget.dataset.page || 1);
    renderPoliciesPage();
  });

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

  // Importar pólizas desde Excel
  document.getElementById('btn-import-policies-modal')?.addEventListener('click', () => {
    const resultDiv = document.getElementById('import-policy-result');
    if (resultDiv) { resultDiv.classList.add('d-none'); resultDiv.innerHTML = ''; }
  });

  document.getElementById('formImportarPolizas')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('excel-policy-file');
    const resultDiv = document.getElementById('import-policy-result');
    const btnSubmit = document.getElementById('btn-submit-import-policies');

    if (!fileInput || fileInput.files.length === 0) return;

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Importando...`;

    const formData = new FormData();
    formData.append('archivo', fileInput.files[0]);

    try {
      const response = await fetch('/api/policies/import', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const data = await response.json();

      resultDiv.classList.remove('d-none', 'alert-danger', 'alert-success');
      if (response.ok) {
        resultDiv.classList.add('alert-success');
        resultDiv.innerHTML = `<strong>¡Importación finalizada!</strong><br>• Pólizas Nuevas: ${data.insertadas}<br>• Actualizadas: ${data.actualizadas}<br>• Omitidas: ${data.omitidas}`;
        fileInput.value = '';
        loadPoliciesList();
      } else {
        resultDiv.classList.add('alert-danger');
        resultDiv.innerText = data.error || 'Error al procesar el archivo.';
      }
    } catch (err) {
      resultDiv.classList.remove('d-none', 'alert-success');
      resultDiv.classList.add('alert-danger');
      resultDiv.innerText = 'Error de conexión.';
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<i class="fa-solid fa-upload me-1"></i> Subir e Importar Pólizas`;
    }
  });

  // Guardar edición de póliza
  document.getElementById('formEditarPoliza')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const policyId = document.getElementById('edit-poliza-id').value;
    const vehiculoId = document.getElementById('edit-vehiculo-id').value;

    const payload = {
      numero_poliza: document.getElementById('edit-poliza-numero').value.trim(),
      compania: document.getElementById('edit-poliza-compania').value.trim(),
      cobertura: document.getElementById('edit-poliza-cobertura').value.trim(),
      estado: document.getElementById('edit-poliza-estado').value,
      valor_cuota: parseFloat(document.getElementById('edit-poliza-cuota').value || 0),
      monto_total: parseFloat(document.getElementById('edit-poliza-monto').value || 0),
      fecha_inicio: document.getElementById('edit-poliza-inicio').value,
      fecha_vencimiento: document.getElementById('edit-poliza-vencimiento').value,
      forma_pago: document.getElementById('edit-poliza-pago').value,
      vehiculo_id: vehiculoId ? parseInt(vehiculoId) : null,
      motor: document.getElementById('edit-vehiculo-motor').value.trim(),
      chasis: document.getElementById('edit-vehiculo-chasis').value.trim()
    };

    try {
      await apiFetch(`/api/policies/${policyId}`, { method: 'PUT', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalEditarPoliza')).hide();
      showToast('Póliza actualizada con éxito.', 'success');
      loadPoliciesList();
    } catch (err) {
      showToast('Error al actualizar póliza: ' + err.message, 'danger');
    }
  });
});

function openEditPolicyModal(policyId) {
  const p = policiesList.find(item => item.id === policyId);
  if (!p) return;
  document.getElementById('edit-poliza-id').value = p.id;
  document.getElementById('edit-vehiculo-id').value = p.vehiculo_id || '';
  document.getElementById('edit-poliza-numero').value = p.numero_poliza || '';
  document.getElementById('edit-poliza-compania').value = p.compania || '';
  document.getElementById('edit-poliza-cobertura').value = p.cobertura || '';
  document.getElementById('edit-poliza-estado').value = p.estado || 'vigente';
  document.getElementById('edit-poliza-cuota').value = p.valor_cuota || '';
  document.getElementById('edit-poliza-monto').value = p.monto_total || '';
  document.getElementById('edit-poliza-inicio').value = (p.fecha_inicio || '').split('T')[0];
  document.getElementById('edit-poliza-vencimiento').value = (p.fecha_vencimiento || '').split('T')[0];
  document.getElementById('edit-poliza-pago').value = p.forma_pago || 'debito_automatico';
  document.getElementById('edit-vehiculo-motor').value = p.motor || '';
  document.getElementById('edit-vehiculo-chasis').value = p.chasis || '';

  new bootstrap.Modal(document.getElementById('modalEditarPoliza')).show();
}
