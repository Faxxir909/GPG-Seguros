// =========================================================================
// clientes.js — Gestión completa de clientes, ficha detalle y sub-tabs
// =========================================================================

// Datos de provincias/localidades de Argentina
const localidadesPorProvincia = {
  "CABA": ["Agronomía","Almagro","Balvanera","Belgrano","Caballito","Flores","Palermo","Recoleta","San Telmo","Villa Urquiza","Monserrat","Puerto Madero"],
  "Buenos Aires": ["La Plata","Mar del Plata","Bahía Blanca","Tandil","Pilar","San Isidro","Vicente López","Quilmes","Lanús","Lomas de Zamora","Avellaneda","Morón","San Martín","Tigre","Necochea","Olavarría","Pergamino","Junín"],
  "Catamarca": ["San Fernando del Valle de Catamarca","Valle Viejo","Belén","Andalgalá","Tinogasta","Recreo","Santa María"],
  "Chaco": ["Resistencia","Presidencia Roque Sáenz Peña","Villa Ángela","Charata","General José de San Martín","Castelli","Las Breñas"],
  "Chubut": ["Rawson","Comodoro Rivadavia","Trelew","Puerto Madryn","Esquel","Rada Tilly","Gaiman"],
  "Córdoba": ["Córdoba Capital","Río Cuarto","Villa María","Villa Carlos Paz","San Francisco","Alta Gracia","Río Tercero","Bell Ville","La Calera","Jesús María","Villa Allende","Mendiolaza","Marcos Juárez","Cruz del Eje","Arroyito","Laboulaye","Capilla del Monte","Cosquín","La Falda","Las Varillas","Morteros","Oliva","Oncativo","Pilar","Río Segundo","Saldán","Unquillo","Valle Hermoso","Villa del Rosario","Villa Dolores","Villa General Belgrano","Mina Clavero","Nono","Santa Rosa de Calamuchita","La Cumbre","Salsipuedes","Bialet Massé","Malagueño","Brinkmann","Hernando","Corral de Bustos","Justiniano Posse","Villa Nueva"],
  "Corrientes": ["Corrientes Capital","Goya","Paso de los Libres","Curuzú Cuatiá","Mercedes","Bella Vista","Santo Tomé","Esquina"],
  "Entre Ríos": ["Paraná","Concordia","Gualeguaychú","Concepción del Uruguay","Gualeguay","Chajarí","Villaguay","Victoria","Colón"],
  "Formosa": ["Formosa Capital","Clorinda","Pirané","El Colorado","Las Lomitas","Ibarreta"],
  "Jujuy": ["San Salvador de Jujuy","San Pedro de Jujuy","Palpalá","La Quiaca","Libertador General San Martín","Tilcara","Humahuaca"],
  "La Pampa": ["Santa Rosa","General Pico","Eduardo Castex","Toay","Realicó","Intendente Alvear","25 de Mayo"],
  "La Rioja": ["La Rioja Capital","Chilecito","Aimogasta","Chamical","Chepes","Villa Unión"],
  "Mendoza": ["Mendoza Capital","San Rafael","Godoy Cruz","Luján de Cuyo","Maipú","Guaymallén","San Martín","Tunuyán","Las Heras","General Alvear","Malargüe"],
  "Misiones": ["Posadas","Oberá","Eldorado","Puerto Iguazú","San Vicente","Apóstoles","Leandro N. Alem","Montecarlo"],
  "Neuquén": ["Neuquén Capital","San Martín de los Andes","Villa La Angostura","Cutral Có","Plaza Huincul","Zapala","Plottier","Centenario","Chos Malal"],
  "Río Negro": ["Viedma","San Carlos de Bariloche","General Roca","Cipolletti","Villa Regina","Cinco Saltos","San Antonio Oeste","El Bolsón","Catriel"],
  "Salta": ["Salta Capital","San Lorenzo","Orán","Tartagal","General Güemes","Metán","Rosario de la Frontera","Cafayate"],
  "San Juan": ["San Juan Capital","Rawson","Chimbas","Rivadavia","Caucete","Santa Lucía","Pocito","Jáchal"],
  "San Luis": ["San Luis Capital","Villa Mercedes","Merlo","Juana Koslay","La Punta","Justo Daract"],
  "Santa Cruz": ["Río Gallegos","Caleta Olivia","El Calafate","Puerto Deseado","Las Heras","Pico Truncado","San Julián","28 de Noviembre"],
  "Santa Fe": ["Rosario","Santa Fe Capital","Rafaela","Venado Tuerto","Santo Tomé","Reconquista","Villa Constitución","San Lorenzo","Esperanza","Granadero Baigorria","Cañada de Gómez","Casilda","Firmat"],
  "Santiago del Estero": ["Santiago del Estero Capital","La Banda","Termas de Río Hondo","Frías","Añatuya","Clodomira"],
  "Tierra del Fuego": ["Ushuaia","Río Grande","Tolhuin"],
  "Tucumán": ["San Miguel de Tucumán","Yerba Buena","Tafí Viejo","Concepción","Banda del Río Salí","Aguilares","Famaillá","Lules","Monteros"]
};

function initProvinceAndCitySelects() {
  const provSelect = document.getElementById('cliente-province');
  const citySelect = document.getElementById('cliente-city');
  if (!provSelect || !citySelect) return;
  provSelect.innerHTML = '<option value="">-- Seleccionar Provincia --</option>';
  Object.keys(localidadesPorProvincia).forEach(prov => {
    const opt = document.createElement('option'); opt.value = prov; opt.textContent = prov; provSelect.appendChild(opt);
  });
  provSelect.addEventListener('change', () => updateLocalidadesDropdown(provSelect.value));
  updateLocalidadesDropdown('');
}

function updateLocalidadesDropdown(province, selectedCity = '') {
  const citySelect = document.getElementById('cliente-city');
  if (!citySelect) return;
  citySelect.innerHTML = '<option value="">-- Seleccionar Localidad --</option>';
  if (province && localidadesPorProvincia[province]) {
    localidadesPorProvincia[province].forEach(city => {
      const opt = document.createElement('option'); opt.value = city; opt.textContent = city;
      if (city === selectedCity) opt.selected = true;
      citySelect.appendChild(opt);
    });
  }
}

function setProvinceAndCity(provVal, cityVal) {
  const provSelect = document.getElementById('cliente-province');
  const citySelect = document.getElementById('cliente-city');
  if (!provSelect || !citySelect) return;
  provVal = provVal || ''; cityVal = cityVal || '';
  if (provVal && ![...provSelect.options].some(o => o.value === provVal)) {
    const opt = document.createElement('option'); opt.value = provVal; opt.textContent = provVal; provSelect.appendChild(opt);
  }
  provSelect.value = provVal;
  updateLocalidadesDropdown(provVal, cityVal);
  if (cityVal && ![...citySelect.options].some(o => o.value === cityVal)) {
    const opt = document.createElement('option'); opt.value = cityVal; opt.textContent = cityVal;
    citySelect.appendChild(opt); citySelect.value = cityVal;
  }
}

// ─── LISTADO DE CLIENTES ───────────────────────────────────────────────────
// Estado de carga de pestañas de la ficha de cliente
let tabLoadedStates = {
  'tab-vehicles': false,
  'tab-policies': false,
  'tab-siniestros': false,
  'tab-history': false,
  'tab-docs': false
};

function resetTabLoadedStates() {
  for (let key in tabLoadedStates) {
    tabLoadedStates[key] = false;
  }
}

async function loadTabContent(tabId) {
  if (!activeClientId) return;
  try {
    switch (tabId) {
      case 'tab-vehicles':
        await loadClientVehicles();
        break;
      case 'tab-policies':
        await loadClientPolicies();
        break;
      case 'tab-siniestros':
        await loadClientClaims();
        break;
      case 'tab-history':
        await loadClientHistory();
        break;
      case 'tab-docs':
        await loadClientDocs();
        break;
    }
  } catch (err) {
    console.error(`Error al cargar pestaña ${tabId}:`, err);
  }
}

// ─── LISTADO DE CLIENTES ───────────────────────────────────────────────────
let allClients = [];

async function loadClientsList() {
  try {
    const data = await apiFetch('/api/clients');
    allClients = data; clientsPage = 1; renderClientsPage();
  } catch (err) { console.error('Error al obtener clientes', err); }
}

function renderClientsPage() {
  const query = document.getElementById('search-client').value.toLowerCase();
  const filtered = query ? allClients.filter(c =>
    c.nombre.toLowerCase().includes(query) || c.dni_cuit.includes(query) || (c.localidad && c.localidad.toLowerCase().includes(query))
  ) : allClients;

  clientsPage = paginate({ items: filtered, page: clientsPage, pageSize: PAGE_SIZE, tbodyId: 'clients-table-body', renderFn: renderClients, wrapId: 'clients-pagination-wrap', infoId: 'clients-pagination-info', navId: 'clients-pagination' });
}

function renderClients(clients) {
  const tbody = document.getElementById('clients-table-body');
  if (clients.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">No se encontraron clientes.</td></tr>`; return; }
  let html = '';
  clients.forEach(c => {
    const riskBadge = c.riesgo_baja === 1 ? `<span class="badge bg-danger">Riesgo Alto</span>` : `<span class="badge bg-secondary">Normal</span>`;
    const statusClass = c.estado === 'activo' ? 'text-success' : 'text-danger';
    html += `
      <tr>
        <td><strong>${c.nombre}</strong> <span class="small ${statusClass}">(${c.estado})</span></td>
        <td>${c.dni_cuit}</td><td>${c.telefono || '--'}</td><td>${c.email || '--'}</td><td>${c.localidad || '--'}</td>
        <td>${riskBadge}</td>
        <td><button class="btn btn-sm btn-premium" onclick="openClientDetail(${c.id})"><i class="fa-solid fa-folder-open me-1"></i> Ficha</button></td>
      </tr>`;
  });
  tbody.innerHTML = html;
}

// ─── FICHA CLIENTE ─────────────────────────────────────────────────────────
async function openClientDetail(clientId) {
  activeClientId = clientId;
  try {
    // Forzar pestaña activa a Datos Personales (tab-info)
    const firstTabEl = document.getElementById('info-tab');
    if (firstTabEl) {
      bootstrap.Tab.getOrCreateInstance(firstTabEl).show();
    }

    // Resetear estados de carga y mostrar skeletons
    resetTabLoadedStates();
    showTableSkeleton('detail-vehicles-body', 6);
    showTableSkeleton('detail-policies-body', 7);
    showTableSkeleton('detail-claims-body', 6);
    showTimelineSkeleton('detail-timeline-body');
    showTableSkeleton('detail-docs-body', 4);

    const client = await apiFetch(`/api/clients/${clientId}`);
    document.getElementById('detail-client-name').innerText = client.nombre;
    document.getElementById('detail-client-doc').innerText = `CUIT/DNI: ${client.dni_cuit}`;
    document.getElementById('detail-client-risk-badge').classList.toggle('d-none', client.riesgo_baja !== 1);
    document.getElementById('detail-client-birth').innerText    = formatDate(client.fecha_nacimiento);
    document.getElementById('detail-client-phone').innerText    = client.telefono || '--';
    document.getElementById('detail-client-email').innerText    = client.email || '--';
    document.getElementById('detail-client-address').innerText  = client.direccion || '--';
    document.getElementById('detail-client-city').innerText     = client.localidad || '--';
    document.getElementById('detail-client-province').innerText = client.provincia || '--';
    document.getElementById('detail-client-notes').innerText    = client.observaciones || '--';

    document.getElementById('clients-list-view').classList.add('d-none');
    document.getElementById('client-detail-view').classList.remove('d-none');
  } catch (err) { showToast('Error al abrir la ficha: ' + err.message, 'danger'); }
}

// ─── SUB-TAB: VEHÍCULOS ────────────────────────────────────────────────────
async function loadClientVehicles() {
  tabLoadedStates['tab-vehicles'] = true;
  const vehicles = await apiFetch(`/api/clients/${activeClientId}/vehicles`);
  const tbody = document.getElementById('detail-vehicles-body');
  if (vehicles.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay vehículos vinculados.</td></tr>`; return; }
  let html = '';
  vehicles.forEach(v => {
    html += `
      <tr>
        <td><strong>${v.marca} ${v.modelo}</strong> <span class="small text-muted d-block">${v.version || ''}</span></td>
        <td>${v.anio || '--'}</td>
        <td><span class="badge bg-secondary font-monospace">${v.patente}</span></td>
        <td><div class="small">Chasis: ${v.chasis || '--'}</div><div class="small">Motor: ${v.motor || '--'}</div></td>
        <td class="text-capitalize">${v.uso}</td>
        <td><button class="btn btn-sm btn-link text-danger" onclick="deleteVehicle(${v.id})"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
  });
  tbody.innerHTML = html;
}

async function deleteVehicle(id) {
  const ok = await showConfirm({ title: 'Desvincular Vehículo', message: '¿Desea desvincular este vehículo del cliente?', okText: 'Sí, desvincular', okClass: 'btn-danger', icon: 'fa-car-burst text-danger' });
  if (ok) {
    try { await apiFetch(`/api/vehicles/${id}`, { method: 'DELETE' }); loadClientVehicles(); showToast('Vehículo desvinculado.', 'success'); }
    catch (err) { showToast(err.message, 'danger'); }
  }
}

async function inicializarMarcas() {
  const selectMarca = document.getElementById('vehiculo-marca');
  const selectModelo = document.getElementById('vehiculo-modelo');
  const selectVersion = document.getElementById('vehiculo-version');
  selectMarca.innerHTML = '<option value="">Seleccione Marca</option>';
  selectModelo.innerHTML = '<option value="">Seleccione Modelo</option>'; selectModelo.disabled = true;
  selectVersion.innerHTML = '<option value="">Seleccione Versión</option>'; selectVersion.disabled = true;
  try {
    const brands = await apiFetch('/api/brands');
    let html = '<option value="">Seleccione Marca</option>';
    brands.forEach(marca => { html += `<option value="${marca}">${marca}</option>`; });
    selectMarca.innerHTML = html;
  } catch (err) { console.error('Error al inicializar marcas:', err); }
}

// ─── SUB-TAB: PÓLIZAS DEL CLIENTE ─────────────────────────────────────────
async function loadClientPolicies() {
  tabLoadedStates['tab-policies'] = true;
  const policies = await apiFetch(`/api/clients/${activeClientId}/policies`);
  const tbody = document.getElementById('detail-policies-body');
  if (policies.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No hay pólizas emitidas.</td></tr>`; return; }
  let html = '';
  policies.forEach(p => {
    const vDesc = p.marca ? `${p.marca} ${p.modelo} (${p.patente})` : 'Sin vehículo';
    const renLabel = p.numero_renovacion > 0 ? ` <span class="badge bg-info text-dark" style="font-size:10px;">Ren. ${p.numero_renovacion}</span>` : '';
    html += `
      <tr>
        <td><strong>${p.numero_poliza || 'PENDIENTE'}</strong>${renLabel}</td>
        <td>${p.compania}</td>
        <td><div class="fw-bold">${p.cobertura}</div><div class="small text-muted">${vDesc}</div></td>
        <td><div class="small">Inicio: ${formatDate(p.fecha_inicio)}</div><div class="small">Vence: ${formatDate(p.fecha_vencimiento)}</div></td>
        <td class="fw-bold text-success">${formatMoney(p.valor_cuota)} <span class="small text-muted">(${p.forma_pago})</span></td>
        <td><span class="badge-status badge-${p.estado}">${p.estado}</span></td>
        <td>
          <div class="d-flex gap-1">
            ${p.estado === 'vencida' ? `<button class="btn btn-sm btn-success py-1" onclick="quickRenewPolicy(${p.id})"><i class="fa-solid fa-rotate me-1"></i> Renovar</button>` : ''}
            <button class="btn btn-sm btn-link text-danger" onclick="deletePolicy(${p.id})"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  });
  tbody.innerHTML = html;
}

// ─── SUB-TAB: SINIESTROS DEL CLIENTE ──────────────────────────────────────
async function loadClientClaims() {
  tabLoadedStates['tab-siniestros'] = true;
  const filtered = await apiFetch(`/api/clients/${activeClientId}/claims`);
  const tbody = document.getElementById('detail-claims-body');
  if (filtered.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay siniestros reportados.</td></tr>`; return; }
  let html = '';
  filtered.forEach(s => {
    html += `
      <tr>
        <td><strong>${s.numero_siniestro}</strong></td>
        <td><span class="badge bg-secondary font-monospace">${s.patente || '--'}</span></td>
        <td>${formatDate(s.fecha)}</td><td>${s.descripcion}</td>
        <td><span class="badge bg-dark">${s.estado.replace('_',' ')}</span></td>
        <td><button class="btn btn-sm btn-link text-danger" onclick="deleteClaim(${s.id})"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
  });
  tbody.innerHTML = html;
}

async function deleteClaim(id) {
  const ok = await showConfirm({ title: 'Eliminar Siniestro', message: '¿Está seguro de eliminar este siniestro?', okText: 'Sí, eliminar', okClass: 'btn-danger', icon: 'fa-car-burst text-danger' });
  if (ok) {
    try { await apiFetch(`/api/claims/${id}`, { method: 'DELETE' }); loadClientClaims(); showToast('Siniestro eliminado.', 'success'); }
    catch (err) { showToast(err.message, 'danger'); }
  }
}

// ─── SUB-TAB: HISTORIAL CRM ────────────────────────────────────────────────
async function loadClientHistory() {
  tabLoadedStates['tab-history'] = true;
  const history = await apiFetch(`/api/clients/${activeClientId}/history`);
  const container = document.getElementById('detail-timeline-body');
  if (history.length === 0) { container.innerHTML = `<p class="text-muted text-center py-3">No hay historial de contactos registrado.</p>`; return; }
  const icons = { whatsapp: 'fa-brands fa-whatsapp whatsapp', llamada: 'fa-solid fa-phone llamada', email: 'fa-solid fa-envelope email', nota: 'fa-solid fa-pen-clip nota' };
  let html = '';
  history.forEach(log => {
    const iconClass = icons[log.tipo_contacto] || 'fa-solid fa-circle';
    html += `
      <div class="timeline-item">
        <div class="timeline-icon ${log.tipo_contacto}"><i class="${iconClass.split(' ')[0]} ${iconClass.split(' ')[1]}"></i></div>
        <div class="timeline-date">${new Date(log.fecha_creacion).toLocaleString()}</div>
        <div class="timeline-content"><strong>${log.tipo_contacto.toUpperCase()}:</strong> ${log.descripcion}</div>
      </div>`;
  });
  container.innerHTML = html;
}

// ─── SUB-TAB: DOCUMENTOS ──────────────────────────────────────────────────
async function loadClientDocs() {
  tabLoadedStates['tab-docs'] = true;
  const docs = await apiFetch(`/api/clients/${activeClientId}/attachments`);
  const tbody = document.getElementById('detail-docs-body');
  if (docs.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay documentos cargados.</td></tr>`; return; }
  let html = '';
  docs.forEach(doc => {
    html += `
      <tr>
        <td><strong>${doc.nombre_archivo}</strong></td>
        <td><span class="badge bg-secondary">${doc.tipo_documento.toUpperCase()}</span></td>
        <td>${new Date(doc.fecha_subida).toLocaleDateString()}</td>
        <td><a href="${doc.ruta_archivo}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="fa-solid fa-eye"></i> Ver</a></td>
      </tr>`;
  });
  tbody.innerHTML = html;
}

// ─── INICIALIZACIÓN DE EVENT LISTENERS ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Búsqueda en tiempo real con debounce
  document.getElementById('search-client')?.addEventListener('input', debounce(() => { clientsPage = 1; renderClientsPage(); }, 350));

  // Escuchador de paginación estable
  document.getElementById('clients-pagination')?.addEventListener('pagechange', (e) => {
    clientsPage = parseInt(e.currentTarget.dataset.page || 1);
    renderClientsPage();
  });

  // Escuchadores de Bootstrap tabs para carga perezosa (lazy-loading)
  const tabElList = document.querySelectorAll('#clientTabs button[data-bs-toggle="tab"]');
  tabElList.forEach(tabEl => {
    tabEl.addEventListener('shown.bs.tab', (event) => {
      const targetId = event.target.getAttribute('data-bs-target')?.replace('#', '');
      if (targetId && targetId in tabLoadedStates && !tabLoadedStates[targetId]) {
        loadTabContent(targetId);
      }
    });
  });

  // Volver al listado
  document.getElementById('btn-back-to-clients')?.addEventListener('click', () => {
    document.getElementById('client-detail-view').classList.add('d-none');
    document.getElementById('clients-list-view').classList.remove('d-none');
    loadClientsList();
  });

  // Imprimir ficha
  document.getElementById('btn-print-client')?.addEventListener('click', () => window.print());

  // Nuevo cliente
  document.getElementById('btn-new-client')?.addEventListener('click', () => {
    document.getElementById('formCliente').reset();
    document.getElementById('cliente-id-input').value = '';
    setProvinceAndCity('', '');
    document.getElementById('modalClienteTitle').innerText = 'Nuevo Cliente';
  });

  // Guardar / actualizar cliente
  document.getElementById('formCliente')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('cliente-id-input').value;
    const payload = {
      nombre: document.getElementById('cliente-nombre').value,
      dni_cuit: document.getElementById('cliente-doc').value,
      fecha_nacimiento: document.getElementById('cliente-birth').value,
      telefono: document.getElementById('cliente-phone').value,
      email: document.getElementById('cliente-email').value,
      direccion: document.getElementById('cliente-address').value,
      localidad: document.getElementById('cliente-city').value,
      provincia: document.getElementById('cliente-province').value,
      estado: document.getElementById('cliente-estado').value,
      riesgo_baja: parseInt(document.getElementById('cliente-risk').value),
      observaciones: document.getElementById('cliente-notes').value
    };
    try {
      if (id) { await apiFetch(`/api/clients/${id}`, { method: 'PUT', body: payload }); }
      else { await apiFetch('/api/clients', { method: 'POST', body: payload }); }
      bootstrap.Modal.getInstance(document.getElementById('modalCliente')).hide();
      document.getElementById('formCliente').reset();
      document.getElementById('cliente-id-input').value = '';
      if (activeClientId && id) { openClientDetail(activeClientId); } else { loadClientsList(); }
      showToast(id ? 'Cliente actualizado correctamente.' : 'Cliente creado exitosamente.', 'success');
    } catch (err) { showToast('Error al guardar cliente: ' + err.message, 'danger'); }
  });

  // Editar cliente desde ficha
  document.getElementById('btn-edit-detail-client')?.addEventListener('click', async () => {
    try {
      const client = await apiFetch(`/api/clients/${activeClientId}`);
      document.getElementById('cliente-id-input').value   = client.id;
      document.getElementById('cliente-nombre').value     = client.nombre;
      document.getElementById('cliente-doc').value        = client.dni_cuit;
      document.getElementById('cliente-birth').value      = client.fecha_nacimiento;
      document.getElementById('cliente-phone').value      = client.telefono;
      document.getElementById('cliente-email').value      = client.email;
      document.getElementById('cliente-address').value    = client.direccion;
      setProvinceAndCity(client.provincia, client.localidad);
      document.getElementById('cliente-estado').value     = client.estado;
      document.getElementById('cliente-risk').value       = client.riesgo_baja;
      document.getElementById('cliente-notes').value      = client.observaciones;
      document.getElementById('modalClienteTitle').innerText = 'Modificar Cliente';
      new bootstrap.Modal(document.getElementById('modalCliente')).show();
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // Eliminar cliente
  document.getElementById('btn-delete-detail-client')?.addEventListener('click', async () => {
    const ok = await showConfirm({ title: 'Eliminar Cliente', message: '¿Está seguro de eliminar este cliente y toda su información vinculada?', okText: 'Sí, eliminar', okClass: 'btn-danger' });
    if (ok) {
      try {
        await apiFetch(`/api/clients/${activeClientId}`, { method: 'DELETE' });
        document.getElementById('client-detail-view').classList.add('d-none');
        document.getElementById('clients-list-view').classList.remove('d-none');
        loadClientsList();
        showToast('Cliente eliminado correctamente.', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
    }
  });

  // Agregar vehículo
  document.getElementById('btn-add-vehicle')?.addEventListener('click', () => {
    document.getElementById('formVehiculo').reset();
    document.getElementById('vehiculo-id-input').value = '';
    inicializarMarcas();
    new bootstrap.Modal(document.getElementById('modalVehiculo')).show();
  });

  // Submit vehículo
  document.getElementById('formVehiculo')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      cliente_id: activeClientId,
      marca: document.getElementById('vehiculo-marca').value,
      modelo: document.getElementById('vehiculo-modelo').value,
      version: document.getElementById('vehiculo-version').value,
      anio: parseInt(document.getElementById('vehiculo-anio').value),
      patente: document.getElementById('vehiculo-patente').value,
      chasis: document.getElementById('vehiculo-chasis').value,
      motor: document.getElementById('vehiculo-motor').value,
      uso: document.getElementById('vehiculo-uso').value
    };
    try {
      await apiFetch('/api/vehicles', { method: 'POST', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalVehiculo')).hide();
      loadClientVehicles();
      showToast('Vehículo vinculado correctamente.', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // Cascada marca → modelo → versión
  document.addEventListener('change', async (e) => {
    if (e.target?.id === 'vehiculo-marca') {
      if (isAutoFilling) return;
      const marca = e.target.value;
      const selectModelo = document.getElementById('vehiculo-modelo');
      const selectVersion = document.getElementById('vehiculo-version');
      selectModelo.innerHTML = '<option value="">Seleccione Modelo</option>'; selectModelo.disabled = true;
      selectVersion.innerHTML = '<option value="">Seleccione Versión</option>'; selectVersion.disabled = true;
      if (marca) {
        try {
          const models = await apiFetch(`/api/brands/${encodeURIComponent(marca)}/models`);
          selectModelo.disabled = false;
          models.forEach(m => { selectModelo.innerHTML += `<option value="${m}">${m}</option>`; });
        } catch (err) { console.error(err); }
      }
    }

    if (e.target?.id === 'vehiculo-modelo') {
      if (isAutoFilling) return;
      const marca = document.getElementById('vehiculo-marca').value;
      const modelo = e.target.value;
      const selectVersion = document.getElementById('vehiculo-version');
      selectVersion.innerHTML = '<option value="">Seleccione Versión</option>'; selectVersion.disabled = true;
      if (marca && modelo) {
        try {
          const versions = await apiFetch(`/api/brands/${encodeURIComponent(marca)}/models/${encodeURIComponent(modelo)}/versions`);
          selectVersion.disabled = false;
          versions.forEach(v => { selectVersion.innerHTML += `<option value="${v}">${v}</option>`; });
        } catch (err) { console.error(err); }
      }
    }
  });

  // Autocompletar patente
  document.addEventListener('blur', async (e) => {
    if (e.target?.id === 'vehiculo-patente') {
      const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if ((clean.length === 6 || clean.length === 7) && !document.getElementById('vehiculo-marca').value.trim()) {
        document.getElementById('btn-buscar-patente')?.click();
      }
    }
  }, true);

  // Agregar póliza
  document.getElementById('btn-add-policy')?.addEventListener('click', async () => {
    try {
      const vehicles = await apiFetch(`/api/clients/${activeClientId}/vehicles`);
      const select = document.getElementById('poliza-vehiculo');
      select.innerHTML = '<option value="">Ninguno</option>';
      vehicles.forEach(v => { select.innerHTML += `<option value="${v.id}">${v.marca} ${v.modelo}${v.version ? ' '+v.version : ''} [${v.patente}]</option>`; });
      document.getElementById('formPoliza').reset();
      new bootstrap.Modal(document.getElementById('modalPoliza')).show();
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // Submit póliza
  document.getElementById('formPoliza')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vId = document.getElementById('poliza-vehiculo').value;
    const payload = {
      cliente_id: activeClientId,
      numero_poliza: document.getElementById('poliza-numero').value,
      compania: document.getElementById('poliza-compania').value,
      fecha_inicio: document.getElementById('poliza-inicio').value,
      fecha_vencimiento: document.getElementById('poliza-vencimiento').value,
      vehiculo_id: vId ? parseInt(vId) : null,
      cobertura: document.getElementById('poliza-cobertura').value,
      monto_total: parseFloat(document.getElementById('poliza-monto').value),
      valor_cuota: parseFloat(document.getElementById('poliza-cuota').value),
      forma_pago: document.getElementById('poliza-pago').value,
      estado: document.getElementById('poliza-estado').value
    };
    try {
      await apiFetch('/api/policies', { method: 'POST', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalPoliza')).hide();
      loadClientPolicies();
      showToast('Póliza emitida correctamente.', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // Agregar siniestro
  document.getElementById('btn-add-claim')?.addEventListener('click', async () => {
    try {
      const policies = await apiFetch(`/api/clients/${activeClientId}/policies`);
      const select = document.getElementById('siniestro-poliza-select');
      select.innerHTML = '<option value="">Seleccione Póliza</option>';
      policies.forEach(p => { select.innerHTML += `<option value="${p.id}" data-vehiculo="${p.vehiculo_id}">${p.numero_poliza || 'Pendiente'} (${p.compania})</option>`; });
      document.getElementById('formSiniestro').reset();
      new bootstrap.Modal(document.getElementById('modalSiniestro')).show();
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // Submit siniestro
  document.getElementById('formSiniestro')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const polSelect = document.getElementById('siniestro-poliza-select');
    const polId = polSelect.value;
    const vehId = polSelect.options[polSelect.selectedIndex].getAttribute('data-vehiculo');
    const payload = {
      numero_siniestro: document.getElementById('siniestro-numero').value,
      cliente_id: activeClientId,
      poliza_id: polId ? parseInt(polId) : null,
      vehiculo_id: vehId ? parseInt(vehId) : null,
      fecha: document.getElementById('siniestro-fecha').value,
      descripcion: document.getElementById('siniestro-desc').value,
      estado: document.getElementById('siniestro-estado').value
    };
    try {
      await apiFetch('/api/claims', { method: 'POST', body: payload });
      bootstrap.Modal.getInstance(document.getElementById('modalSiniestro')).hide();
      loadClientClaims();
      showToast('Siniestro registrado correctamente.', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // CRM Log
  document.getElementById('formCRMContact')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { cliente_id: activeClientId, tipo_contacto: document.getElementById('crm-contact-type').value, descripcion: document.getElementById('crm-contact-desc').value };
    try {
      await apiFetch('/api/crm/logs', { method: 'POST', body: payload });
      document.getElementById('crm-contact-desc').value = '';
      loadClientHistory();
      showToast('Contacto registrado en el historial.', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // Upload documento
  document.getElementById('formUploadDoc')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('doc-file');
    if (fileInput.files.length === 0) return;
    const formData = new FormData();
    formData.append('archivo', fileInput.files[0]);
    formData.append('cliente_id', activeClientId);
    formData.append('tipo_documento', document.getElementById('doc-type').value);
    try {
      const response = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: formData });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Error al subir archivo'); }
      fileInput.value = '';
      loadClientDocs();
      showToast('Documento subido correctamente.', 'success');
    } catch (err) { showToast(err.message, 'danger'); }
  });

  // Importar clientes desde Excel
  document.getElementById('btn-import-clients-modal')?.addEventListener('click', () => {
    const resultDiv = document.getElementById('import-result');
    resultDiv.classList.add('d-none'); resultDiv.innerText = '';
    document.getElementById('excel-file').value = '';
  });

  document.getElementById('formImportarClientes')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('excel-file');
    const resultDiv = document.getElementById('import-result');
    const btnSubmit = document.getElementById('btn-submit-import');
    if (fileInput.files.length === 0) return;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Importando...`;
    const formData = new FormData(); formData.append('archivo', fileInput.files[0]);
    try {
      const response = await fetch('/api/clients/import', { method: 'POST', credentials: 'include', body: formData });
      const data = await response.json();
      resultDiv.classList.remove('d-none','alert-danger','alert-success');
      if (response.ok) {
        resultDiv.classList.add('alert-success');
        resultDiv.innerHTML = `<strong>¡Importación finalizada!</strong><br>• Nuevos: ${data.insertados}<br>• Actualizados: ${data.actualizados}<br>• Omitidos: ${data.omitidos}`;
        fileInput.value = ''; loadClientsList();
      } else {
        resultDiv.classList.add('alert-danger'); resultDiv.innerText = data.error || 'Error al procesar el archivo.';
      }
    } catch (err) {
      resultDiv.classList.remove('d-none','alert-success'); resultDiv.classList.add('alert-danger'); resultDiv.innerText = 'Error de conexión.';
    } finally {
      btnSubmit.disabled = false; btnSubmit.innerHTML = `<i class="fa-solid fa-upload me-1"></i> Subir e Importar`;
    }
  });
});
