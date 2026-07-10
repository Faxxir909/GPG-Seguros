// =========================================================================
// cotizaciones.js — Cotizaciones y CRM Comercial (Funnel)
// =========================================================================
let allQuotes = [];

async function loadQuotesList() {
  try {
    const data = await apiFetch('/api/quotes');
    allQuotes = data;
    renderQuotesTable(data);
    renderCommercialFunnel(data);
  } catch (err) { console.error(err); }
}

function renderQuotesTable(quotes) {
  const tbody = document.getElementById('quotes-table-body');
  tbody.innerHTML = '';
  if (quotes.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">No se encontraron cotizaciones.</td></tr>`; return; }
  quotes.forEach(q => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${q.cliente_nombre}</strong></td>
        <td>${q.compania}</td>
        <td>${q.cobertura}</td>
        <td class="fw-bold text-success">${formatMoney(q.valor_cuota)}</td>
        <td>${q.notas || '--'}</td>
        <td><span class="badge bg-info text-capitalize">${q.estado}</span></td>
        <td>
          ${q.estado === 'pendiente' || q.estado === 'enviada' ? `
            <button class="btn btn-sm btn-success" onclick="openConvertQuoteModal(${q.id})">
              <i class="fa-solid fa-file-signature"></i> Póliza
            </button>` : ''}
        </td>
      </tr>`;
  });
}

function renderCommercialFunnel(quotes) {
  const stages = {
    pendiente: document.getElementById('funnel-pending-body'),
    enviada:   document.getElementById('funnel-sent-body'),
    aceptada:  document.getElementById('funnel-accepted-body'),
    rechazada: document.getElementById('funnel-rejected-body')
  };
  Object.values(stages).forEach(s => { if (s) s.innerHTML = ''; });
  const counts = { pendiente: 0, enviada: 0, aceptada: 0, rechazada: 0 };

  quotes.forEach(q => {
    const body = stages[q.estado];
    if (body) {
      counts[q.estado]++;
      const card = document.createElement('div');
      card.className = 'funnel-card';
      card.innerHTML = `
        <div class="funnel-card-title">${q.cliente_nombre}</div>
        <div class="funnel-card-meta">${q.compania} | ${q.cobertura.substring(0, 15)}...</div>
        <div class="funnel-card-meta fw-bold text-success mt-1">${formatMoney(q.valor_cuota)}</div>
        <div class="d-flex justify-content-between mt-2 align-items-center">
          <span class="small text-muted" style="font-size:10px;">${new Date(q.fecha_creacion).toLocaleDateString()}</span>
          <div class="dropdown">
            <button class="btn btn-sm p-0 text-muted" type="button" data-bs-toggle="dropdown">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end" style="font-size:0.8rem;">
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id},'pendiente')">Mover a Pendiente</a></li>
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id},'enviada')">Mover a Enviado</a></li>
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id},'aceptada')">Aceptar Propuesta</a></li>
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id},'rechazada')">Rechazar</a></li>
              ${q.estado === 'aceptada' ? `<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-success fw-bold" href="#" onclick="openConvertQuoteModal(${q.id})">Emitir Póliza</a></li>` : ''}
            </ul>
          </div>
        </div>`;
      body.appendChild(card);
    }
  });

  const map = { pendiente: 'pending', enviada: 'sent', aceptada: 'accepted', rechazada: 'rejected' };
  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById(`funnel-count-${map[k]}`);
    if (el) el.innerText = v;
  });
}

async function updateQuoteStatus(quoteId, newStatus) {
  try {
    const q = allQuotes.find(x => x.id === quoteId);
    if (!q) return;
    await apiFetch(`/api/quotes/${quoteId}`, { method: 'PUT', body: { compania: q.compania, cobertura: q.cobertura, monto_total: q.monto_total, valor_cuota: q.valor_cuota, estado: newStatus, notas: q.notas } });
    loadQuotesList();
  } catch (err) { showToast(err.message, 'danger'); }
}

function openConvertQuoteModal(quoteId) {
  document.getElementById('convert-cot-id').value = quoteId;
  document.getElementById('formConvertirCotizacion').reset();
  document.getElementById('convert-inicio').value = new Date().toISOString().split('T')[0];
  const fin = new Date(); fin.setFullYear(fin.getFullYear() + 1);
  document.getElementById('convert-vencimiento').value = fin.toISOString().split('T')[0];
  new bootstrap.Modal(document.getElementById('modalConvertirCotizacion')).show();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('formConvertirCotizacion')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('convert-cot-id').value;
    const payload = {
      numero_poliza: document.getElementById('convert-numero').value,
      fecha_inicio: document.getElementById('convert-inicio').value,
      fecha_vencimiento: document.getElementById('convert-vencimiento').value,
      forma_pago: document.getElementById('convert-pago').value
    };
    try {
      await apiFetch(`/api/quotes/${id}/convert`, { method: 'POST', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalConvertirCotizacion')).hide();
      showToast('Póliza emitida y archivada correctamente.', 'success');
      loadQuotesList();
    } catch (err) { showToast(err.message, 'danger'); }
  });

  document.getElementById('btn-new-quote-global')?.addEventListener('click', async () => {
    try {
      const clients = await apiFetch('/api/clients');
      const select = document.getElementById('cot-cliente-select');
      select.innerHTML = '<option value="">Seleccione Cliente</option>';
      clients.forEach(c => { select.innerHTML += `<option value="${c.id}">${c.nombre} (DNI: ${c.dni_cuit})</option>`; });
      document.getElementById('formCotizacion').reset();
      new bootstrap.Modal(document.getElementById('modalCotizacion')).show();
    } catch (err) { showToast(err.message, 'danger'); }
  });

  document.getElementById('cot-cliente-select')?.addEventListener('change', async (e) => {
    const cId = e.target.value;
    const selectVeh = document.getElementById('cot-vehiculo-select');
    selectVeh.innerHTML = '<option value="">Seleccione Vehículo</option>';
    if (!cId) return;
    try {
      const vehicles = await apiFetch(`/api/clients/${cId}/vehicles`);
      vehicles.forEach(v => { selectVeh.innerHTML += `<option value="${v.id}">${v.marca} ${v.modelo}${v.version ? ' ' + v.version : ''} [${v.patente}]</option>`; });
    } catch (err) { console.error(err); }
  });

  document.getElementById('formCotizacion')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cId = document.getElementById('cot-cliente-select').value;
    const vId = document.getElementById('cot-vehiculo-select').value;
    const payload = {
      cliente_id: parseInt(cId), vehiculo_id: vId ? parseInt(vId) : null,
      compania: document.getElementById('cot-compania').value,
      cobertura: document.getElementById('cot-cobertura').value,
      monto_total: parseFloat(document.getElementById('cot-monto').value),
      valor_cuota: parseFloat(document.getElementById('cot-cuota').value),
      estado: document.getElementById('cot-estado').value,
      notas: document.getElementById('cot-notes').value
    };
    try {
      await apiFetch('/api/quotes', { method: 'POST', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalCotizacion')).hide();
      loadQuotesList();
      showToast('Cotización registrada correctamente.', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  });
});
