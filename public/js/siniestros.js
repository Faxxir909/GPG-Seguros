// =========================================================================
// siniestros.js
// =========================================================================
let allClaims = [];

async function loadClaimsList() {
  showTableSkeleton('claims-table-body', 8, 4);
  try {
    const data = await apiFetch('/api/claims');
    allClaims = data;
    filterClaims();
  } catch (err) {
    console.error(err);
    showTableError('claims-table-body', 8, 'Error al cargar siniestros: ' + err.message, 'loadClaimsList()');
  }
}

function filterClaims() {
  const searchEl = document.getElementById('search-claim');
  const term = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const filtered = !term ? allClaims : allClaims.filter(s => {
    const num = (s.numero_siniestro || '').toLowerCase();
    const cli = (s.cliente_nombre || '').toLowerCase();
    const pat = (s.patente || '').toLowerCase();
    const desc = (s.descripcion || '').toLowerCase();
    return num.includes(term) || cli.includes(term) || pat.includes(term) || desc.includes(term);
  });
  renderClaimsTable(filtered, !!term);
}

function renderClaimsTable(claims, hasSearch = false) {
  const tbody = document.getElementById('claims-table-body');
  if (!claims || claims.length === 0) {
    const msg = hasSearch ? 'No se encontraron siniestros que coincidan con la búsqueda.' : 'No hay siniestros reportados.';
    showTableEmpty('claims-table-body', 8, msg, 'fa-car-burst');
    return;
  }
  let html = '';
  claims.forEach(s => {
    const pInfo = s.numero_poliza ? `${s.compania} | ${s.numero_poliza}` : 'Sin póliza';
    const vInfo = s.marca ? `${s.marca} ${s.modelo} (${s.patente})` : 'Sin patente';
    html += `<tr><td><strong>${s.numero_siniestro}</strong></td><td>${s.cliente_nombre}</td><td>${pInfo}</td><td>${vInfo}</td><td>${formatDate(s.fecha)}</td><td>${s.descripcion}</td><td><select class="form-select form-select-sm" style="width:150px;" onchange="updateClaimStatus(${s.id},this.value)"><option value="denunciado" ${s.estado==='denunciado'?'selected':''}>Denunciado</option><option value="en_proceso" ${s.estado==='en_proceso'?'selected':''}>En Proceso</option><option value="doc_pendiente" ${s.estado==='doc_pendiente'?'selected':''}>Doc. Pendiente</option><option value="resuelto" ${s.estado==='resuelto'?'selected':''}>Resuelto</option></select></td><td><button class="btn btn-sm btn-premium" onclick="openClientDetail(${s.cliente_id})"><i class="fa-solid fa-user-gear"></i></button></td></tr>`;
  });
  tbody.innerHTML = html;
}

async function updateClaimStatus(claimId, newStatus) {
  try {
    const claim = allClaims.find(c => c.id === claimId);
    if (!claim) return;
    await apiFetch(`/api/claims/${claimId}`, { method: 'PUT', body: { numero_siniestro: claim.numero_siniestro, fecha: claim.fecha, descripcion: claim.descripcion, estado: newStatus } });
    loadClaimsList();
    showToast('Estado del siniestro actualizado.', 'info');
  } catch (err) { showToast(err.message, 'danger'); }
}

document.addEventListener('DOMContentLoaded', () => {
  const searchClaim = document.getElementById('search-claim');
  if (searchClaim) {
    searchClaim.addEventListener('input', debounce(filterClaims, 300));
  }
});

