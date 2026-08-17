// =========================================================================
// agenda.js
// =========================================================================
async function loadAgendaList() {
  showTableSkeleton('agenda-table-body', 5, 4);
  try {
    const data = await apiFetch('/api/agenda');
    const tbody = document.getElementById('agenda-table-body');
    if (!data || data.length === 0) {
      showTableEmpty('agenda-table-body', 5, 'No hay tareas pendientes en la agenda.', 'fa-calendar-check');
      return;
    }
    let html = '';
    data.forEach(task => {
      const completadoClass = task.completado ? 'text-decoration-line-through text-muted' : '';
      const checked = task.completado ? 'checked' : '';
      html += `
        <tr class="${completadoClass}">
          <td>
            <div class="d-flex align-items-center gap-2">
              <input class="form-check-input" type="checkbox" ${checked} onchange="toggleTaskComplete(${task.id}, ${task.completado ? 0 : 1})">
              <div>
                <strong>${task.titulo}</strong>
                <div class="small text-muted">${task.descripcion || ''}</div>
              </div>
            </div>
          </td>
          <td>${associatedClient}</td>
          <td>${renderExpirationCell(task.fecha_vencimiento)}</td>
          <td><span class="badge bg-secondary text-uppercase">${task.tipo}</span></td>
          <td><button class="btn btn-sm btn-link text-danger" onclick="deleteTask(${task.id})"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
    });
    tbody.innerHTML = html;
    document.getElementById('quick-notes-area').value = localStorage.getItem('gpg_quick_notes') || '';
  } catch (err) {
    console.error(err);
    showTableError('agenda-table-body', 5, 'Error al cargar la agenda: ' + err.message, 'loadAgendaList()');
  }
}

async function toggleTaskComplete(id, completedVal) {
  try {
    const tasks = await apiFetch('/api/agenda');
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    await apiFetch(`/api/agenda/${id}`, { method: 'PUT', body: { titulo: task.titulo, descripcion: task.descripcion, fecha_vencimiento: task.fecha_vencimiento, tipo: task.tipo, completado: completedVal } });
    loadAgendaList();
  } catch (err) { showToast(err.message, 'danger'); }
}

async function deleteTask(id) {
  const ok = await showConfirm({ title: 'Eliminar Tarea', message: '¿Desea eliminar esta tarea de la agenda?', okText: 'Sí, eliminar', okClass: 'btn-danger', icon: 'fa-calendar-xmark text-danger' });
  if (ok) {
    try { await apiFetch(`/api/agenda/${id}`, { method: 'DELETE' }); loadAgendaList(); showToast('Tarea eliminada.', 'success'); }
    catch (err) { showToast(err.message, 'danger'); }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-save-quick-notes')?.addEventListener('click', () => {
    localStorage.setItem('gpg_quick_notes', document.getElementById('quick-notes-area').value);
    showToast('Notas guardadas localmente.', 'success');
  });

  document.getElementById('btn-add-task')?.addEventListener('click', async () => {
    try {
      const clients = await apiFetch('/api/clients');
      const select = document.getElementById('agenda-cliente-select');
      select.innerHTML = '<option value="">Ninguno</option>';
      clients.forEach(c => { select.innerHTML += `<option value="${c.id}">${c.nombre}</option>`; });
      document.getElementById('formAgenda').reset();
      new bootstrap.Modal(document.getElementById('modalAgenda')).show();
    } catch (err) { showToast(err.message, 'danger'); }
  });

  document.getElementById('formAgenda')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cId = document.getElementById('agenda-cliente-select').value;
    const payload = { cliente_id: cId ? parseInt(cId) : null, titulo: document.getElementById('agenda-titulo').value, descripcion: document.getElementById('agenda-desc').value, fecha_vencimiento: document.getElementById('agenda-fecha').value, tipo: document.getElementById('agenda-tipo').value };
    try {
      await apiFetch('/api/agenda', { method: 'POST', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalAgenda')).hide();
      loadAgendaList();
      showToast('Tarea agregada a la agenda.', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  });
});
