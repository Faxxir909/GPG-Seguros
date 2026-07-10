// =========================================================================
// siniestros.js
// =========================================================================
let allClaims = [];

async function loadClaimsList() {
  try {
    const data = await apiFetch('/api/claims');
    allClaims = data;
    renderClaimsTable(data);
  } catch (err) { console.error(err); }
}

function renderClaimsTable(claims) {
  const tbody = document.getElementById('claims-table-body');
  tbody.innerHTML = '';
  if (claims.length === 0) { tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No se encontraron siniestros.</td></tr>`; return; }
  claims.forEach(s => {
    const pInfo = s.numero_poliza ? `${s.compania} | ${s.numero_poliza}` : 'Sin póliza';
    const vInfo = s.marca ? `${s.marca} ${s.modelo} (${s.patente})` : 'Sin patente';
    tbody.innerHTML += `<tr><td><strong>${s.numero_siniestro}</strong></td><td>${s.cliente_nombre}</td><td>${pInfo}</td><td>${vInfo}</td><td>${formatDate(s.fecha)}</td><td>${s.descripcion}</td><td><select class="form-select form-select-sm" style="width:150px;" onchange="updateClaimStatus(${s.id},this.value)"><option value="denunciado" ${s.estado==='denunciado'?'selected':''}>Denunciado</option><option value="en_proceso" ${s.estado==='en_proceso'?'selected':''}>En Proceso</option><option value="doc_pendiente" ${s.estado==='doc_pendiente'?'selected':''}>Doc. Pendiente</option><option value="resuelto" ${s.estado==='resuelto'?'selected':''}>Resuelto</option></select></td><td><button class="btn btn-sm btn-premium" onclick="openClientDetail(${s.cliente_id})"><i class="fa-solid fa-user-gear"></i></button></td></tr>`;
  });
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
