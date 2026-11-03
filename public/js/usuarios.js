// =========================================================================
// usuarios.js — Gestión de Usuarios, Auditoría y Mantenimiento (Rol Admin)
// =========================================================================

let allUsers = [];
let auditCurrentPage = 1;

async function loadUsersPanel() {
  await Promise.all([
    loadUsersList(),
    loadAuditLogs(1)
  ]);
}

async function loadUsersList() {
  showTableSkeleton('users-table-body', 6, 4);
  try {
    allUsers = await apiFetch('/api/users');
    renderUsersTable(allUsers);
  } catch (err) {
    console.error(err);
    showTableError('users-table-body', 6, 'Error al cargar usuarios: ' + err.message, 'loadUsersList()');
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  if (!users || users.length === 0) {
    showTableEmpty('users-table-body', 6, 'No hay usuarios registrados.', 'fa-users-slash');
    return;
  }

  const roleBadges = {
    admin: '<span class="badge bg-dark">Administrador</span>',
    productor: '<span class="badge bg-primary">Productor</span>',
    administrativo: '<span class="badge bg-info text-dark">Administrativo</span>'
  };

  let html = '';
  users.forEach(u => {
    const isSelf = currentUser && Number(currentUser.id) === Number(u.id);
    const statusBadge = u.activo
      ? '<span class="badge bg-success-subtle text-success border border-success-subtle">Activo</span>'
      : '<span class="badge bg-secondary-subtle text-secondary border">Inactivo</span>';
    const lastAccess = u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleString('es-AR') : '<span class="text-muted small">Sin ingresos</span>';

    html += `
      <tr>
        <td>
          <div class="fw-bold text-dark">${escapeHtml(u.nombre)} ${isSelf ? '<span class="badge bg-light text-primary border ms-1">Tú</span>' : ''}</div>
        </td>
        <td><code>${escapeHtml(u.usuario)}</code></td>
        <td>${roleBadges[u.rol] || escapeHtml(u.rol)}</td>
        <td>${statusBadge}</td>
        <td class="small">${lastAccess}</td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-outline-primary py-1" title="Editar usuario / Cambiar contraseña" onclick="openEditUserModal(${u.id})">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            ${!isSelf && u.activo ? `
              <button class="btn btn-sm btn-outline-danger py-1" title="Desactivar cuenta" onclick="deactivateUser(${u.id})">
                <i class="fa-solid fa-user-slash"></i>
              </button>` : ''}
          </div>
        </td>
      </tr>`;
  });

  tbody.innerHTML = html;
}

function openNewUserModal() {
  document.getElementById('formUsuario')?.reset();
  document.getElementById('user-id-input').value = '';
  document.getElementById('modalUsuarioTitle').innerText = 'Nuevo Usuario';
  document.getElementById('user-activo-input').value = 'true';
  const pwdInput = document.getElementById('user-password-input');
  if (pwdInput) {
    pwdInput.required = true;
    pwdInput.placeholder = 'Mínimo 6 caracteres';
  }
  document.getElementById('user-password-label').innerText = 'Contraseña *';
  document.getElementById('user-password-help').innerText = 'Mínimo 6 caracteres para el primer ingreso.';
  new bootstrap.Modal(document.getElementById('modalUsuario')).show();
}

function openEditUserModal(userId) {
  const user = allUsers.find(u => Number(u.id) === Number(userId));
  if (!user) return;

  document.getElementById('formUsuario')?.reset();
  document.getElementById('user-id-input').value = user.id;
  document.getElementById('modalUsuarioTitle').innerText = `Editar Usuario: ${user.nombre}`;
  document.getElementById('user-nombre-input').value = user.nombre || '';
  document.getElementById('user-usuario-input').value = user.usuario || '';
  document.getElementById('user-rol-input').value = user.rol || 'productor';
  document.getElementById('user-activo-input').value = user.activo ? 'true' : 'false';

  const pwdInput = document.getElementById('user-password-input');
  if (pwdInput) {
    pwdInput.required = false;
    pwdInput.value = '';
    pwdInput.placeholder = 'Dejar en blanco para mantener la actual';
  }
  document.getElementById('user-password-label').innerText = 'Nueva Contraseña (opcional)';
  document.getElementById('user-password-help').innerText = 'Complete este campo únicamente si desea restablecer la contraseña.';
  new bootstrap.Modal(document.getElementById('modalUsuario')).show();
}

async function deactivateUser(userId) {
  const user = allUsers.find(u => Number(u.id) === Number(userId));
  if (!user) return;

  const ok = await showConfirm({
    title: 'Desactivar Usuario',
    message: `¿Confirma que desea dar de baja el acceso de "${user.nombre}" (${user.usuario})?`,
    okText: 'Desactivar',
    okClass: 'btn-danger'
  });
  if (!ok) return;

  try {
    await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
    showToast('Usuario desactivado correctamente.', 'info');
    loadUsersList();
    loadAuditLogs(auditCurrentPage);
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadAuditLogs(page = 1) {
  auditCurrentPage = page;
  const tabla = document.getElementById('filter-audit-table')?.value || '';
  const accion = document.getElementById('filter-audit-action')?.value || '';
  const params = new URLSearchParams({ page: String(page), limit: '12' });
  if (tabla) params.set('tabla', tabla);
  if (accion) params.set('accion', accion);

  try {
    const res = await apiFetch(`/api/audit-logs?${params.toString()}`);
    renderAuditLogsTable(res.data || []);
    renderAuditPagination(res.page || 1, res.totalPages || 1, res.total || 0);
  } catch (err) {
    console.error(err);
    showTableError('audit-table-body', 6, 'Error al cargar auditoría: ' + err.message, 'loadAuditLogs(1)');
  }
}

function renderAuditLogsTable(logs) {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;
  if (!logs || logs.length === 0) {
    showTableEmpty('audit-table-body', 6, 'No hay eventos registrados con los filtros seleccionados.', 'fa-shield-halved');
    return;
  }

  const actionBadges = {
    INSERT: '<span class="badge bg-success-subtle text-success border border-success-subtle">INSERT</span>',
    UPDATE: '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">UPDATE</span>',
    DELETE: '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">DELETE</span>'
  };

  let html = '';
  logs.forEach(item => {
    const fecha = item.creado_en ? new Date(item.creado_en).toLocaleString('es-AR') : '--';
    const actor = item.usuario_nombre
      ? `${escapeHtml(item.usuario_nombre)} <span class="text-muted">(${escapeHtml(item.usuario_login)})</span>`
      : '<span class="text-muted">Sistema / DB</span>';
    const changedFields = Array.isArray(item.campos_cambiados) && item.campos_cambiados.length > 0
      ? item.campos_cambiados.map(c => `<code class="me-1">${escapeHtml(c)}</code>`).join('')
      : '<span class="text-muted small">Registro completo</span>';

    html += `
      <tr>
        <td class="text-muted font-monospace">#${item.id}</td>
        <td>${fecha}</td>
        <td>${actor}</td>
        <td>${actionBadges[item.accion] || escapeHtml(item.accion)}</td>
        <td><strong>${escapeHtml(item.tabla)}</strong> <span class="text-muted">(ID: ${escapeHtml(item.registro_id || '-')})</span></td>
        <td>${changedFields}</td>
      </tr>`;
  });
  tbody.innerHTML = html;
}

function renderAuditPagination(page, totalPages, total) {
  const infoEl = document.getElementById('audit-pagination-info');
  const navEl = document.getElementById('audit-pagination');
  if (infoEl) {
    infoEl.textContent = `Total: ${total} eventos (Página ${page} de ${totalPages})`;
  }
  if (!navEl) return;
  if (totalPages <= 1) {
    navEl.innerHTML = '';
    return;
  }
  let html = `
    <li class="page-item ${page <= 1 ? 'disabled' : ''}">
      <a class="page-link" href="#" onclick="event.preventDefault(); if(${page} > 1) loadAuditLogs(${page - 1});">&laquo;</a>
    </li>`;
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let p = start; p <= end; p++) {
    html += `
      <li class="page-item ${p === page ? 'active' : ''}">
        <a class="page-link" href="#" onclick="event.preventDefault(); loadAuditLogs(${p});">${p}</a>
      </li>`;
  }
  html += `
    <li class="page-item ${page >= totalPages ? 'disabled' : ''}">
      <a class="page-link" href="#" onclick="event.preventDefault(); if(${page} < ${totalPages}) loadAuditLogs(${page + 1});">&raquo;</a>
    </li>`;
  navEl.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-new-user')?.addEventListener('click', openNewUserModal);

  document.getElementById('formUsuario')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('user-id-input').value;
    const payload = {
      nombre: document.getElementById('user-nombre-input').value.trim(),
      usuario: document.getElementById('user-usuario-input').value.trim(),
      rol: document.getElementById('user-rol-input').value,
      activo: document.getElementById('user-activo-input').value === 'true'
    };
    const password = document.getElementById('user-password-input').value;
    if (password && password.trim() !== '') {
      payload.password = password;
    }

    try {
      if (id) {
        await apiFetch(`/api/users/${id}`, { method: 'PUT', body: payload });
        showToast('Usuario actualizado correctamente.', 'success');
      } else {
        await apiFetch('/api/users', { method: 'POST', body: payload });
        showToast('Usuario creado correctamente.', 'success');
      }
      bootstrap.Modal.getInstance(document.getElementById('modalUsuario'))?.hide();
      loadUsersList();
      loadAuditLogs(1);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });

  document.getElementById('btn-run-maintenance')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-run-maintenance');
    const resultEl = document.getElementById('maintenance-last-result');
    if (btn) btn.disabled = true;
    try {
      const res = await apiFetch('/api/admin/maintenance/run', { method: 'POST', body: {} });
      if (resultEl) {
        resultEl.innerHTML = `Última ejecución (${new Date(res.executedAt).toLocaleTimeString('es-AR')}): <strong>${res.expiredPoliciesUpdated}</strong> pólizas vencidas y <strong>${res.overdueInstallmentsUpdated}</strong> cuotas en mora actualizadas.`;
      }
      showToast('Sincronización diaria ejecutada con éxito.', 'success');
      loadAuditLogs(1);
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('filter-audit-table')?.addEventListener('change', () => loadAuditLogs(1));
  document.getElementById('filter-audit-action')?.addEventListener('change', () => loadAuditLogs(1));
});

