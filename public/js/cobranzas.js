// =========================================================================
// cobranzas.js — Módulo de Gestión de Cobranzas y Cuotas
// =========================================================================

let activePolicyInstallments = [];
let activePolicyData = null;

/** Abrir el modal de plan de cuotas de una póliza */
async function openPolicyInstallmentsModal(policyId) {
  const modalEl = document.getElementById('modalPlanCuotas');
  if (!modalEl) return;

  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  const tbody = document.getElementById('cuotas-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-muted"><i class="fa-solid fa-spinner fa-spin me-2"></i>Cargando plan de cuotas...</td></tr>';

  try {
    const data = await apiFetch(`/api/policies/${policyId}/payments`);
    activePolicyData = data.policy;
    activePolicyInstallments = data.cuotas || [];

    document.getElementById('cuotas-modal-cliente').innerText = activePolicyData.cliente_nombre || 'Cliente';
    document.getElementById('cuotas-modal-poliza-info').innerText = `Póliza Nº ${activePolicyData.numero_poliza} | ${activePolicyData.compania} (${activePolicyData.cobertura})`;
    document.getElementById('cuotas-modal-monto-cuota').innerText = formatMoney(activePolicyData.valor_cuota || 0);

    renderInstallmentsTable();
  } catch (err) {
    console.error('Error al cargar cuotas:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-3 text-danger"><i class="fa-solid fa-triangle-exclamation me-1"></i>Error: ${err.message}</td></tr>`;
  }
}

function renderInstallmentsTable() {
  const tbody = document.getElementById('cuotas-table-body');
  if (!activePolicyInstallments || activePolicyInstallments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-muted">No hay cuotas generadas para esta póliza.</td></tr>';
    return;
  }

  let cobradasCount = 0;
  let pendientesCount = 0;
  let moraCount = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = '';
  activePolicyInstallments.forEach(c => {
    const expDate = new Date(c.fecha_vencimiento);
    expDate.setHours(0, 0, 0, 0);

    let isOverdue = false;
    if (c.estado === 'pendiente' && expDate.getTime() < today.getTime()) {
      isOverdue = true;
    }

    if (c.estado === 'pagada') cobradasCount++;
    else if (isOverdue || c.estado === 'en_mora') moraCount++;
    else pendientesCount++;

    let badgeStatus = '';
    if (c.estado === 'pagada') {
      badgeStatus = '<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="fa-solid fa-circle-check me-1"></i>Pagada</span>';
    } else if (isOverdue || c.estado === 'en_mora') {
      badgeStatus = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle fw-bold"><i class="fa-solid fa-triangle-exclamation me-1"></i>En Mora</span>';
    } else {
      badgeStatus = '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle"><i class="fa-regular fa-clock me-1"></i>Pendiente</span>';
    }

    const cleanTel = activePolicyData.cliente_telefono ? String(activePolicyData.cliente_telefono).replace(/[^0-9]/g, '') : '';
    const waReminderMsg = encodeURIComponent(`Hola ${activePolicyData.cliente_nombre}, te recordamos desde GPG Seguros que la cuota ${c.numero_cuota}/${c.total_cuotas} de tu póliza Nº ${activePolicyData.numero_poliza} (${activePolicyData.compania}) por ${formatMoney(c.monto)} vence el ${formatDate(c.fecha_vencimiento)}. ¿Te acercamos los datos de pago?`);
    const waBtn = (c.estado !== 'pagada' && cleanTel) ? `
      <a href="https://wa.me/${cleanTel}?text=${waReminderMsg}" target="_blank" class="btn btn-sm btn-outline-success py-1" title="Enviar recordatorio de cuota por WhatsApp">
        <i class="fa-brands fa-whatsapp"></i>
      </a>
    ` : '';

    const actionBtn = c.estado === 'pagada'
      ? `<button class="btn btn-sm btn-outline-secondary py-1" onclick="toggleCuotaPago(${c.id}, 'pendiente')" title="Desmarcar pago"><i class="fa-solid fa-rotate-left me-1"></i>Deshacer</button>`
      : `<button class="btn btn-sm btn-success py-1" onclick="toggleCuotaPago(${c.id}, 'pagada')" title="Registrar Cobro"><i class="fa-solid fa-check me-1"></i>Cobrada</button>`;

    html += `
      <tr>
        <td><strong>Cuota ${c.numero_cuota}</strong> <span class="small text-muted">/ ${c.total_cuotas}</span></td>
        <td><div class="fw-bold font-monospace text-dark">${formatDate(c.fecha_vencimiento)}</div></td>
        <td><div class="fw-bold text-success">${formatMoney(c.monto)}</div></td>
        <td>${badgeStatus}</td>
        <td><div class="small text-muted font-monospace">${c.fecha_pago ? formatDate(c.fecha_pago) : '--'}</div></td>
        <td>
          <div class="d-flex align-items-center gap-1">
            ${actionBtn}
            ${waBtn}
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  // Actualizar stats del modal
  document.getElementById('cuotas-stat-cobradas').innerText = `${cobradasCount} / ${activePolicyInstallments.length}`;
  document.getElementById('cuotas-stat-pendientes').innerText = pendientesCount;
  document.getElementById('cuotas-stat-mora').innerText = moraCount;
}

async function toggleCuotaPago(cuotaId, nuevoEstado) {
  try {
    await apiFetch(`/api/payments/${cuotaId}`, {
      method: 'PUT',
      body: { estado: nuevoEstado, fecha_pago: nuevoEstado === 'pagada' ? new Date().toISOString().split('T')[0] : null }
    });

    showToast(nuevoEstado === 'pagada' ? '¡Cobro registrado exitosamente!' : 'Estado de cuota restablecido a pendiente.', 'success');

    // Actualizar datos locales
    const cuota = activePolicyInstallments.find(c => c.id === cuotaId);
    if (cuota) {
      cuota.estado = nuevoEstado;
      cuota.fecha_pago = nuevoEstado === 'pagada' ? new Date().toISOString().split('T')[0] : null;
    }
    renderInstallmentsTable();

    // Si la tabla de pólizas está abierta, refrescarla suavemente
    if (typeof renderPoliciesPage === 'function') {
      renderPoliciesPage();
    }
  } catch (err) {
    showToast('Error al actualizar cuota: ' + err.message, 'danger');
  }
}
