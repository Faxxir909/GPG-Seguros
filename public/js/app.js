// =========================================================================
// GPG Seguros - Core Frontend Application JS (SPA Router & Module Logic)
// =========================================================================

// ==========================================
// 0. UTILIDADES GLOBALES
// ==========================================

/** TOAST - reemplaza todos los alert() */
function showToast(message, type = 'success', duration = 4000) {
  const container = document.getElementById('toast-container');
  const id = `toast-${Date.now()}`;
  const icons = { success: 'fa-circle-check', danger: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const iconClass = icons[type] || icons.info;

  const toastEl = document.createElement('div');
  toastEl.id = id;
  toastEl.className = `toast align-items-center border-0 text-white bg-${type} show`;
  toastEl.setAttribute('role', 'alert');
  toastEl.innerHTML = `
    <div class="d-flex">
      <div class="toast-body d-flex align-items-center gap-2">
        <i class="fa-solid ${iconClass}"></i>
        <span>${message}</span>
      </div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;

  container.appendChild(toastEl);
  setTimeout(() => toastEl.remove(), duration + 500);
  return toastEl;
}

/** CONFIRM MODAL - reemplaza todos los confirm() */
function showConfirm({ title = '¿Está seguro?', message = 'Esta acción no se puede deshacer.', okText = 'Confirmar', okClass = 'btn-danger', icon = 'fa-triangle-exclamation text-danger' } = {}) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.className = `btn ${okClass}`;
    okBtn.innerText = okText;
    document.getElementById('confirm-icon').className = `fa-solid ${icon} fs-1`;

    const modal = new bootstrap.Modal(document.getElementById('modalConfirmar'));
    modal.show();

    const handler = () => {
      modal.hide();
      okBtn.removeEventListener('click', handler);
      resolve(true);
    };
    const dismissHandler = () => {
      document.getElementById('modalConfirmar').removeEventListener('hidden.bs.modal', dismissHandler);
      okBtn.removeEventListener('click', handler);
      resolve(false);
    };

    okBtn.addEventListener('click', handler);
    document.getElementById('modalConfirmar').addEventListener('hidden.bs.modal', dismissHandler, { once: true });
  });
}

/** PAGINACIÓN genérica */
function paginate({ items, page, pageSize, tbodyId, renderFn, wrapId, infoId, navId }) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(page, totalPages);
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);

  renderFn(slice);

  const info = document.getElementById(infoId);
  const nav = document.getElementById(navId);
  if (!info || !nav) return page;

  if (total === 0) { info.textContent = ''; nav.innerHTML = ''; return page; }
  info.textContent = `Mostrando ${start + 1}-${Math.min(start + pageSize, total)} de ${total}`;

  nav.innerHTML = '';
  const prevLi = document.createElement('li');
  prevLi.className = `page-item ${page === 1 ? 'disabled' : ''}`;
  prevLi.innerHTML = `<a class="page-link" href="#"><i class="fa-solid fa-chevron-left"></i></a>`;
  prevLi.addEventListener('click', (e) => { e.preventDefault(); if (page > 1) nav.dataset.page = page - 1, nav.dispatchEvent(new Event('pagechange')); });
  nav.appendChild(prevLi);

  const maxVisible = 5;
  let startPage = Math.max(1, page - 2);
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

  for (let i = startPage; i <= endPage; i++) {
    const li = document.createElement('li');
    li.className = `page-item ${i === page ? 'active' : ''}`;
    li.innerHTML = `<a class="page-link" href="#">${i}</a>`;
    const pageNum = i;
    li.addEventListener('click', (e) => { e.preventDefault(); nav.dataset.page = pageNum; nav.dispatchEvent(new Event('pagechange')); });
    nav.appendChild(li);
  }

  const nextLi = document.createElement('li');
  nextLi.className = `page-item ${page === totalPages ? 'disabled' : ''}`;
  nextLi.innerHTML = `<a class="page-link" href="#"><i class="fa-solid fa-chevron-right"></i></a>`;
  nextLi.addEventListener('click', (e) => { e.preventDefault(); if (page < totalPages) nav.dataset.page = page + 1, nav.dispatchEvent(new Event('pagechange')); });
  nav.appendChild(nextLi);

  return page;
}

// 1. GLOBALS & AUTH CHECK
let currentUser = null;
let activeClientId = null; // Guardar ID del cliente seleccionado para la Ficha
let chartComisionesObj = null;
let chartProduccionObj = null;
let clientsPage = 1;
let policiesPage = 1;
const PAGE_SIZE = 15;
let isAutoFilling = false; // Flag para evitar doble carga al autocompletar

// Session timer
let sessionStart = Date.now();
function startSessionTimer() {
  const display = document.getElementById('session-time-display');
  setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    display.textContent = elapsed >= 3600 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  // Ocultar splash en cuanto carga
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) { splash.classList.add('splash-fade'); setTimeout(() => splash.remove(), 600); }
  }, 800);

  // Verificar autenticación
  const token = localStorage.getItem('gpg_token');
  const userStr = localStorage.getItem('gpg_user');
  if (!token || !userStr) {
    window.location.href = '/index.html';
    return;
  }
  currentUser = JSON.parse(userStr);

  // Inicializar cabecera de usuario en sidebar
  document.getElementById('nav-user-name').innerText = currentUser.nombre;
  document.getElementById('nav-user-role').innerText = currentUser.rol;
  document.getElementById('nav-user-avatar').innerText = currentUser.nombre.substring(0, 1).toUpperCase();
  document.getElementById('current-date-badge').innerText = `Hoy: ${new Date().toLocaleDateString()}`;

  // Controlar accesos según rol
  if (currentUser.rol === 'admin' || currentUser.rol === 'productor') {
    document.getElementById('menu-comisiones').classList.remove('d-none');
    document.getElementById('btn-delete-detail-client').classList.remove('d-none');
  }

  // Inicializar navegación SPA
  initNavigation();

  // Session timer
  startSessionTimer();

  // Cerrar sesión con confirmación
  document.getElementById('btnLogout').addEventListener('click', async () => {
    const ok = await showConfirm({
      title: 'Cerrar Sesión',
      message: '¿Está seguro que desea cerrar la sesión actual?',
      okText: 'Cerrar Sesión',
      okClass: 'btn-danger',
      icon: 'fa-power-off text-danger'
    });
    if (ok) {
      localStorage.removeItem('gpg_user');
      localStorage.removeItem('gpg_token');
      window.location.href = '/index.html';
    }
  });

  // Sidebar toggle en móviles
  const sidebar = document.querySelector('.sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('show');
      overlay.classList.toggle('show');
    });
  }

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('show');
    overlay.classList.remove('show');
  });

  // Cerrar sidebar al hacer clic en un enlace en móvil
  const menuLinks = document.querySelectorAll('.sidebar-link');
  menuLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 992) {
        sidebar.classList.remove('show');
        overlay.classList.remove('show');
      }
    });
  });

  // Cargar Panel Inicial (Dashboard)
  loadPanel('dashboard');
});

// 2. SPA ROUTER
function initNavigation() {
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Remover clase activa de todos y añadir al clickeado
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      const target = link.getAttribute('data-target');
      loadPanel(target);
    });
  });
}

function loadPanel(panelId) {
  // Ocultar todos los paneles
  document.querySelectorAll('.panel-section').forEach(sec => {
    sec.classList.add('d-none');
  });

  // Mostrar el panel objetivo
  const targetSec = document.getElementById(`panel-${panelId}`);
  if (targetSec) {
    targetSec.classList.remove('d-none');
  }

  // Si estábamos en ficha cliente y cambiamos a Clientes, volver al listado por si acaso
  if (panelId === 'clientes') {
    document.getElementById('client-detail-view').classList.add('d-none');
    document.getElementById('clients-list-view').classList.remove('d-none');
  }

  // Actualizar títulos
  const titles = {
    dashboard: { t: 'Dashboard', s: 'Resumen en tiempo real de operaciones y vencimientos' },
    clientes: { t: 'Gestión de Clientes', s: 'Administración de asegurados, vehículos y fichas históricas' },
    polizas: { t: 'Pólizas de Seguros', s: 'Control de coberturas, renovaciones y cobranzas' },
    cotizaciones: { t: 'Cotizaciones y Leads', s: 'Comparativas de seguros y embudo comercial CRM' },
    siniestros: { t: 'Gestión de Siniestros', s: 'Seguimiento de incidentes, peritajes y documentación' },
    agenda: { t: 'Agenda y Seguimiento', s: 'Recordatorios, tareas pendientes y renovaciones próximas' },
    comisiones: { t: 'Gestión de Comisiones', s: 'Liquidación de comisiones de seguros y producción' },
    reportes: { t: 'Reportes y Estadísticas', s: 'Exportación de datos a PDF/Excel y análisis anual' }
  };

  if (titles[panelId]) {
    document.getElementById('panel-title').innerText = titles[panelId].t;
    document.getElementById('panel-subtitle').innerText = titles[panelId].s;
  }

  // Disparar carga de datos según panel
  switch(panelId) {
    case 'dashboard':
      loadDashboardData();
      break;
    case 'clientes':
      loadClientsList();
      break;
    case 'polizas':
      loadPoliciesList();
      break;
    case 'cotizaciones':
      loadQuotesList();
      break;
    case 'siniestros':
      loadClaimsList();
      break;
    case 'agenda':
      loadAgendaList();
      break;
    case 'comisiones':
      loadCommissionsList();
      break;
    case 'reportes':
      loadReportsData();
      break;
  }
}

// Helper para hacer llamadas autenticadas con Headers
async function apiFetch(url, options = {}) {
  if (!options.headers) {
    options.headers = {};
  }
  
  const token = localStorage.getItem('gpg_token');
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (options.body && !(options.body instanceof FormData)) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('gpg_token');
      localStorage.removeItem('gpg_user');
      window.location.href = '/index.html';
      return new Promise(() => {}); // Detener flujo posterior
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// Formateadores
const formatMoney = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
const formatDate = (dateStr) => {
  if (!dateStr) return '--';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

// ==========================================
// 3. LOGICA DEL DASHBOARD
// ==========================================
async function loadDashboardData() {
  try {
    const data = await apiFetch('/api/dashboard');
    
    // Rellenar métricas
    document.getElementById('stat-clientes-activos').innerText = data.clientesActivos;
    document.getElementById('stat-polizas-vigentes').innerText = data.polizasVigentes;
    document.getElementById('stat-vencimientos-30').innerText = data.porVencer30;
    document.getElementById('stat-siniestros-abiertos').innerText = data.siniestrosAbiertos;
    document.getElementById('stat-produccion-mes').innerText = formatMoney(data.produccionMes);
    document.getElementById('stat-comisiones-mes').innerText = formatMoney(data.comisionesMes);

    // Rellenar lista de vencimientos
    const tbody = document.getElementById('dashboard-vencimientos-body');
    tbody.innerHTML = '';

    if (data.listadoVencimientos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay vencimientos próximos.</td></tr>`;
    } else {
      data.listadoVencimientos.forEach(p => {
        // Enlace rápido de recordatorio de WhatsApp
        const waMsg = encodeURIComponent(`Hola ${p.cliente_nombre}, te recordamos que tu póliza Nº ${p.numero_poliza} (${p.cobertura}) en ${p.compania} vence el ${formatDate(p.fecha_vencimiento)}. Por favor contáctanos para coordinar la renovación.`);
        const waUrl = `https://wa.me/${p.cliente_telefono}?text=${waMsg}`;

        tbody.innerHTML += `
          <tr>
            <td><strong>${p.cliente_nombre}</strong></td>
            <td>${p.compania}</td>
            <td class="text-danger fw-bold">${formatDate(p.fecha_vencimiento)}</td>
            <td>
              <a href="${waUrl}" target="_blank" class="btn-whatsapp-share">
                <i class="fa-brands fa-whatsapp"></i> Avisar
              </a>
            </td>
          </tr>
        `;
      });
    }

    // Inicializar Gráfico
    initComisionesChart(data.comisionesMes);
  } catch (err) {
    console.error('Error al cargar dashboard', err);
  }
}

function initComisionesChart(montoMesActual) {
  const ctx = document.getElementById('chartComisiones').getContext('2d');
  if (chartComisionesObj) {
    chartComisionesObj.destroy();
  }

  // Simulación de evolución mensual histórica
  chartComisionesObj = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'],
      datasets: [{
        label: 'Comisiones Mensuales ($)',
        data: [montoMesActual * 0.7, montoMesActual * 0.8, montoMesActual * 0.9, montoMesActual * 0.95, montoMesActual * 0.9, montoMesActual],
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14, 165, 233, 0.1)',
        tension: 0.3,
        fill: true,
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

// Predefinir provincias y localidades de Argentina
const localidadesPorProvincia = {
  "CABA": ["Agronomía", "Almagro", "Balvanera", "Belgrano", "Caballito", "Flores", "Palermo", "Recoleta", "San Telmo", "Villa Urquiza", "Monserrat", "Puerto Madero"],
  "Buenos Aires": ["La Plata", "Mar del Plata", "Bahía Blanca", "Tandil", "Pilar", "San Isidro", "Vicente López", "Quilmes", "Lanús", "Lomas de Zamora", "Avellaneda", "Morón", "San Martín", "Tigre", "Necochea", "Olavarría", "Pergamino", "Junín"],
  "Catamarca": ["San Fernando del Valle de Catamarca", "Valle Viejo", "Belén", "Andalgalá", "Tinogasta", "Recreo", "Santa María"],
  "Chaco": ["Resistencia", "Presidencia Roque Sáenz Peña", "Villa Ángela", "Charata", "General José de San Martín", "Castelli", "Las Breñas"],
  "Chubut": ["Rawson", "Comodoro Rivadavia", "Trelew", "Puerto Madryn", "Esquel", "Rada Tilly", "Gaiman"],
  "Córdoba": ["Córdoba Capital", "Río Cuarto", "Villa María", "Villa Carlos Paz", "San Francisco", "Alta Gracia", "Río Tercero", "Bell Ville", "La Calera", "Jesús María", "Villa Allende", "Mendiolaza", "Marcos Juárez", "Cruz del Eje", "Arroyito", "Laboulaye", "Capilla del Monte", "Cosquín", "La Falda", "Las Varillas", "Morteros", "Oliva", "Oncativo", "Pilar", "Río Segundo", "Saldán", "Unquillo", "Valle Hermoso", "Villa del Rosario", "Villa Dolores", "Villa General Belgrano", "Mina Clavero", "Nono", "Santa Rosa de Calamuchita", "La Cumbre", "Salsipuedes", "Bialet Massé", "Malagueño", "Brinkmann", "Hernando", "Corral de Bustos", "Justiniano Posse", "Villa Nueva"],
  "Corrientes": ["Corrientes Capital", "Goya", "Paso de los Libres", "Curuzú Cuatiá", "Mercedes", "Bella Vista", "Santo Tomé", "Esquina"],
  "Entre Ríos": ["Paraná", "Concordia", "Gualeguaychú", "Concepción del Uruguay", "Gualeguay", "Chajarí", "Villaguay", "Victoria", "Colón"],
  "Formosa": ["Formosa Capital", "Clorinda", "Pirané", "El Colorado", "Las Lomitas", "Ibarreta"],
  "Jujuy": ["San Salvador de Jujuy", "San Pedro de Jujuy", "Palpalá", "La Quiaca", "Libertador General San Martín", "Tilcara", "Humahuaca"],
  "La Pampa": ["Santa Rosa", "General Pico", "Eduardo Castex", "Toay", "Realicó", "Intendente Alvear", "25 de Mayo"],
  "La Rioja": ["La Rioja Capital", "Chilecito", "Aimogasta", "Chamical", "Chepes", "Villa Unión"],
  "Mendoza": ["Mendoza Capital", "San Rafael", "Godoy Cruz", "Luján de Cuyo", "Maipú", "Guaymallén", "San Martín", "Tunuyán", "Las Heras", "General Alvear", "Malargüe"],
  "Misiones": ["Posadas", "Oberá", "Eldorado", "Puerto Iguazú", "San Vicente", "Apóstoles", "Leandro N. Alem", "Montecarlo"],
  "Neuquén": ["Neuquén Capital", "San Martín de los Andes", "Villa La Angostura", "Cutral Có", "Plaza Huincul", "Zapala", "Plottier", "Centenario", "Chos Malal"],
  "Río Negro": ["Viedma", "San Carlos de Bariloche", "General Roca", "Cipolletti", "Villa Regina", "Cinco Saltos", "San Antonio Oeste", "El Bolsón", "Catriel"],
  "Salta": ["Salta Capital", "San Lorenzo", "Orán", "Tartagal", "General Güemes", "Metán", "Rosario de la Frontera", "Cafayate"],
  "San Juan": ["San Juan Capital", "Rawson", "Chimbas", "Rivadavia", "Caucete", "Santa Lucía", "Pocito", "Jáchal"],
  "San Luis": ["San Luis Capital", "Villa Mercedes", "Merlo", "Juana Koslay", "La Punta", "Justo Daract"],
  "Santa Cruz": ["Río Gallegos", "Caleta Olivia", "El Calafate", "Puerto Deseado", "Las Heras", "Pico Truncado", "San Julián", "28 de Noviembre"],
  "Santa Fe": ["Rosario", "Santa Fe Capital", "Rafaela", "Venado Tuerto", "Santo Tomé", "Reconquista", "Villa Constitución", "San Lorenzo", "Esperanza", "Granadero Baigorria", "Cañada de Gómez", "Casilda", "Firmat"],
  "Santiago del Estero": ["Santiago del Estero Capital", "La Banda", "Termas de Río Hondo", "Frías", "Añatuya", "Clodomira"],
  "Tierra del Fuego": ["Ushuaia", "Río Grande", "Tolhuin"],
  "Tucumán": ["San Miguel de Tucumán", "Yerba Buena", "Tafí Viejo", "Concepción", "Banda del Río Salí", "Aguilares", "Famaillá", "Lules", "Monteros"]
};

// Función para inicializar los selectores de provincia y localidad en el modal
function initProvinceAndCitySelects() {
  const provSelect = document.getElementById('cliente-province');
  const citySelect = document.getElementById('cliente-city');
  if (!provSelect || !citySelect) return;

  // Llenar provincias
  provSelect.innerHTML = '<option value="">-- Seleccionar Provincia --</option>';
  Object.keys(localidadesPorProvincia).forEach(prov => {
    const opt = document.createElement('option');
    opt.value = prov;
    opt.textContent = prov;
    provSelect.appendChild(opt);
  });

  // Evento al cambiar de provincia
  provSelect.addEventListener('change', () => {
    updateLocalidadesDropdown(provSelect.value);
  });

  // Inicializar localidades vacías
  updateLocalidadesDropdown('');
}

function updateLocalidadesDropdown(province, selectedCity = '') {
  const citySelect = document.getElementById('cliente-city');
  if (!citySelect) return;

  citySelect.innerHTML = '<option value="">-- Seleccionar Localidad --</option>';
  
  if (province && localidadesPorProvincia[province]) {
    localidadesPorProvincia[province].forEach(city => {
      const opt = document.createElement('option');
      opt.value = city;
      opt.textContent = city;
      if (city === selectedCity) {
        opt.selected = true;
      }
      citySelect.appendChild(opt);
    });
  }
}

function setProvinceAndCity(provVal, cityVal) {
  const provSelect = document.getElementById('cliente-province');
  const citySelect = document.getElementById('cliente-city');
  if (!provSelect || !citySelect) return;

  provVal = provVal || '';
  cityVal = cityVal || '';

  // Asegurar que la opción de provincia exista en el select
  if (provVal && ![...provSelect.options].some(o => o.value === provVal)) {
    const opt = document.createElement('option');
    opt.value = provVal;
    opt.textContent = provVal;
    provSelect.appendChild(opt);
  }
  provSelect.value = provVal;

  // Actualizar localidades para esa provincia
  updateLocalidadesDropdown(provVal, cityVal);

  // Asegurar que la opción de localidad exista en el select
  if (cityVal && ![...citySelect.options].some(o => o.value === cityVal)) {
    const opt = document.createElement('option');
    opt.value = cityVal;
    opt.textContent = cityVal;
    citySelect.appendChild(opt);
    citySelect.value = cityVal;
  }
}

// ==========================================
// 4. LOGICA DE CLIENTES
// ==========================================
// renderizado de clientes con soporte de paginación
let allClients = [];

async function loadClientsList() {
  try {
    const data = await apiFetch('/api/clients');
    allClients = data;
    clientsPage = 1;
    renderClientsPage();
  } catch (err) {
    console.error('Error al obtener clientes', err);
  }
}

function renderClientsPage() {
  const query = document.getElementById('search-client').value.toLowerCase();
  const filtered = query ? allClients.filter(c =>
    c.nombre.toLowerCase().includes(query) ||
    c.dni_cuit.includes(query) ||
    (c.localidad && c.localidad.toLowerCase().includes(query))
  ) : allClients;

  clientsPage = paginate({
    items: filtered,
    page: clientsPage,
    pageSize: PAGE_SIZE,
    tbodyId: 'clients-table-body',
    renderFn: renderClients,
    wrapId: 'clients-pagination-wrap',
    infoId: 'clients-pagination-info',
    navId: 'clients-pagination'
  });

  // Escuchar cambios de página
  const nav = document.getElementById('clients-pagination');
  nav.onpagechange = null;
  nav.addEventListener('pagechange', () => {
    clientsPage = parseInt(nav.dataset.page);
    renderClientsPage();
  }, { once: true });
}

function renderClients(clients) {
  const tbody = document.getElementById('clients-table-body');
  tbody.innerHTML = '';

  if (clients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">No se encontraron clientes.</td></tr>`;
    return;
  }

  clients.forEach(c => {
    const riskBadge = c.riesgo_baja === 1 ? `<span class="badge bg-danger">Riesgo Alto</span>` : `<span class="badge bg-secondary">Normal</span>`;
    const statusClass = c.estado === 'activo' ? 'text-success' : 'text-danger';
    
    tbody.innerHTML += `
      <tr>
        <td><strong>${c.nombre}</strong> <span class="small ${statusClass}">(${c.estado})</span></td>
        <td>${c.dni_cuit}</td>
        <td>${c.telefono || '--'}</td>
        <td>${c.email || '--'}</td>
        <td>${c.localidad || '--'}</td>
        <td>${riskBadge}</td>
        <td>
          <button class="btn btn-sm btn-premium" onclick="openClientDetail(${c.id})">
            <i class="fa-solid fa-folder-open me-1"></i> Ficha
          </button>
        </td>
      </tr>
    `;
  });
}

// Buscar cliente en tiempo real
document.getElementById('search-client').addEventListener('keyup', (e) => {
  clientsPage = 1;
  renderClientsPage();
});

// Abrir ficha de cliente detallada
async function openClientDetail(clientId) {
  activeClientId = clientId;
  try {
    const client = await apiFetch(`/api/clients/${clientId}`);
    
    // Llenar Ficha Cabecera
    document.getElementById('detail-client-name').innerText = client.nombre;
    document.getElementById('detail-client-doc').innerText = `CUIT/DNI: ${client.dni_cuit}`;
    
    if (client.riesgo_baja === 1) {
      document.getElementById('detail-client-risk-badge').classList.remove('d-none');
    } else {
      document.getElementById('detail-client-risk-badge').classList.add('d-none');
    }

    // Llenar Ficha Datos Personales
    document.getElementById('detail-client-birth').innerText = formatDate(client.fecha_nacimiento);
    document.getElementById('detail-client-phone').innerText = client.telefono || '--';
    document.getElementById('detail-client-email').innerText = client.email || '--';
    document.getElementById('detail-client-address').innerText = client.direccion || '--';
    document.getElementById('detail-client-city').innerText = client.localidad || '--';
    document.getElementById('detail-client-province').innerText = client.provincia || '--';
    document.getElementById('detail-client-notes').innerText = client.observaciones || '--';

    // Cargar datos de pestañas vinculadas
    loadClientVehicles();
    loadClientPolicies();
    loadClientClaims();
    loadClientHistory();
    loadClientDocs();

    // Toggle views
    document.getElementById('clients-list-view').classList.add('d-none');
    document.getElementById('client-detail-view').classList.remove('d-none');
  } catch (err) {
    showToast('Error al abrir la ficha: ' + err.message, 'danger');
  }
}

document.getElementById('btn-back-to-clients').addEventListener('click', () => {
  document.getElementById('client-detail-view').classList.add('d-none');
  document.getElementById('clients-list-view').classList.remove('d-none');
  loadClientsList();
});

// Guardar / Crear Cliente
document.getElementById('formCliente').addEventListener('submit', async (e) => {
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
    let response;
    if (id) {
      // Editar
      response = await apiFetch(`/api/clients/${id}`, { method: 'PUT', body: payload });
    } else {
      // Crear nuevo
      response = await apiFetch('/api/clients', { method: 'POST', body: payload });
    }

    // Ocultar modal y refrescar
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalCliente'));
    modal.hide();
    
    document.getElementById('formCliente').reset();
    document.getElementById('cliente-id-input').value = '';
    
    if (activeClientId && id) {
      // Si editábamos desde la ficha, recargar la ficha
      openClientDetail(activeClientId);
    } else {
      loadClientsList();
    }
    showToast(id ? 'Cliente actualizado correctamente.' : 'Cliente creado exitosamente.', 'success');
  } catch (err) {
    showToast('Error al guardar cliente: ' + err.message, 'danger');
  }
});

// Cargar formulario para Editar Cliente
document.getElementById('btn-edit-detail-client').addEventListener('click', async () => {
  try {
    const client = await apiFetch(`/api/clients/${activeClientId}`);
    document.getElementById('cliente-id-input').value = client.id;
    document.getElementById('cliente-nombre').value = client.nombre;
    document.getElementById('cliente-doc').value = client.dni_cuit;
    document.getElementById('cliente-birth').value = client.fecha_nacimiento;
    document.getElementById('cliente-phone').value = client.telefono;
    document.getElementById('cliente-email').value = client.email;
    document.getElementById('cliente-address').value = client.direccion;
    setProvinceAndCity(client.provincia, client.localidad);
    document.getElementById('cliente-estado').value = client.estado;
    document.getElementById('cliente-risk').value = client.riesgo_baja;
    document.getElementById('cliente-notes').value = client.observaciones;

    document.getElementById('modalClienteTitle').innerText = 'Modificar Cliente';
    const modal = new bootstrap.Modal(document.getElementById('modalCliente'));
    modal.show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('btn-new-client').addEventListener('click', () => {
  document.getElementById('formCliente').reset();
  document.getElementById('cliente-id-input').value = '';
  setProvinceAndCity('', '');
  document.getElementById('modalClienteTitle').innerText = 'Nuevo Cliente';
});

// Eliminar Cliente
document.getElementById('btn-delete-detail-client').addEventListener('click', async () => {
  const ok = await showConfirm({
    title: 'Eliminar Cliente',
    message: '¿Está seguro de eliminar este cliente y toda su información vinculada (pólizas, vehículos)? Esta acción no se puede deshacer.',
    okText: 'Sí, eliminar',
    okClass: 'btn-danger'
  });
  if (ok) {
    try {
      await apiFetch(`/api/clients/${activeClientId}`, { method: 'DELETE' });
      document.getElementById('client-detail-view').classList.add('d-none');
      document.getElementById('clients-list-view').classList.remove('d-none');
      loadClientsList();
      showToast('Cliente eliminado correctamente.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
});

// Imprimir ficha de cliente
document.getElementById('btn-print-client').addEventListener('click', () => {
  window.print();
});

// 4.1 SUB-TAB: VEHICULOS
async function loadClientVehicles() {
  try {
    const vehicles = await apiFetch(`/api/clients/${activeClientId}/vehicles`);
    const tbody = document.getElementById('detail-vehicles-body');
    tbody.innerHTML = '';

    if (vehicles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay vehículos vinculados.</td></tr>`;
      return;
    }

    vehicles.forEach(v => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${v.marca} ${v.modelo}</strong> <span class="small text-muted d-block">${v.version || ''}</span></td>
          <td>${v.anio || '--'}</td>
          <td><span class="badge bg-secondary font-monospace">${v.patente}</span></td>
          <td>
            <div class="small">Chasis: ${v.chasis || '--'}</div>
            <div class="small">Motor: ${v.motor || '--'}</div>
          </td>
          <td class="text-capitalize">${v.uso}</td>
          <td>
            <button class="btn btn-sm btn-link text-danger" onclick="deleteVehicle(${v.id})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('btn-add-vehicle').addEventListener('click', () => {
  document.getElementById('formVehiculo').reset();
  document.getElementById('vehiculo-id-input').value = '';
  inicializarMarcas();
  const modal = new bootstrap.Modal(document.getElementById('modalVehiculo'));
  modal.show();
});

document.getElementById('formVehiculo').addEventListener('submit', async (e) => {
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
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

async function deleteVehicle(id) {
  const ok = await showConfirm({
    title: 'Desvincular Vehículo',
    message: '¿Desea desvincular este vehículo del cliente?',
    okText: 'Sí, desvincular',
    okClass: 'btn-danger',
    icon: 'fa-car-burst text-danger'
  });
  if (ok) {
    try {
      await apiFetch(`/api/vehicles/${id}`, { method: 'DELETE' });
      loadClientVehicles();
      showToast('Vehículo desvinculado.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
}

// Catálogo de Marcas, Modelos y Versiones de Autos (Cargados dinámicamente desde base de datos)
async function inicializarMarcas() {
  const selectMarca = document.getElementById('vehiculo-marca');
  const selectModelo = document.getElementById('vehiculo-modelo');
  const selectVersion = document.getElementById('vehiculo-version');
  
  selectMarca.innerHTML = '<option value="">Seleccione Marca</option>';
  selectModelo.innerHTML = '<option value="">Seleccione Modelo</option>';
  selectModelo.disabled = true;
  selectVersion.innerHTML = '<option value="">Seleccione Versión</option>';
  selectVersion.disabled = true;

  try {
    const brands = await apiFetch('/api/brands');
    brands.forEach(marca => {
      selectMarca.innerHTML += `<option value="${marca}">${marca}</option>`;
    });
  } catch (err) {
    console.error('Error al inicializar marcas desde la base de datos:', err);
  }
}

// Escuchar cambios en la selección de marca y modelo para actualizar desplegables dependientes
document.addEventListener('change', async (e) => {
  if (e.target && e.target.id === 'vehiculo-marca') {
    // Si el autocompletado de patente está en curso, no cargar modelos de nuevo
    if (isAutoFilling) return;

    const marcaSelected = e.target.value;
    const selectModelo = document.getElementById('vehiculo-modelo');
    const selectVersion = document.getElementById('vehiculo-version');
    
    selectModelo.innerHTML = '<option value="">Seleccione Modelo</option>';
    selectModelo.disabled = true;
    selectVersion.innerHTML = '<option value="">Seleccione Versión</option>';
    selectVersion.disabled = true;
    
    if (marcaSelected) {
      try {
        const models = await apiFetch(`/api/brands/${encodeURIComponent(marcaSelected)}/models`);
        selectModelo.disabled = false;
        models.forEach(modelo => {
          selectModelo.innerHTML += `<option value="${modelo}">${modelo}</option>`;
        });
      } catch (err) {
        console.error('Error al cargar modelos desde la base de datos:', err);
      }
    }
  }

  if (e.target && e.target.id === 'vehiculo-modelo') {
    if (isAutoFilling) return;

    const marcaSelected = document.getElementById('vehiculo-marca').value;
    const modeloSelected = e.target.value;
    const selectVersion = document.getElementById('vehiculo-version');
    
    selectVersion.innerHTML = '<option value="">Seleccione Versión</option>';
    selectVersion.disabled = true;
    
    if (marcaSelected && modeloSelected) {
      try {
        const versions = await apiFetch(`/api/brands/${encodeURIComponent(marcaSelected)}/models/${encodeURIComponent(modeloSelected)}/versions`);
        selectVersion.disabled = false;
        versions.forEach(version => {
          selectVersion.innerHTML += `<option value="${version}">${version}</option>`;
        });
      } catch (err) {
        console.error('Error al cargar versiones desde la base de datos:', err);
      }
    }
  }
});

// Buscar datos de la patente en el modal de vehículos (deshabilitado según requerimiento)
// La carga por patente se encontraba usando endpoint: /api/vehicles/lookup


// Autocompletar automáticamente al perder foco si tiene longitud válida (6 o 7 chars)
document.addEventListener('blur', async (e) => {
  if (e.target && e.target.id === 'vehiculo-patente') {
    const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length === 6 || clean.length === 7) {
      const marcaVal = document.getElementById('vehiculo-marca').value.trim();
      if (!marcaVal) {
        document.getElementById('btn-buscar-patente').click();
      }
    }
  }
}, true);

// 4.2 SUB-TAB: PÓLIZAS
async function loadClientPolicies() {
  try {
    const policies = await apiFetch(`/api/clients/${activeClientId}/policies`);
    const tbody = document.getElementById('detail-policies-body');
    tbody.innerHTML = '';

    if (policies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No hay pólizas emitidas.</td></tr>`;
      return;
    }

    policies.forEach(p => {
      const vDesc = p.marca ? `${p.marca} ${p.modelo} (${p.patente})` : 'Sin vehículo';
      const renLabel = p.numero_renovacion > 0 ? ` <span class="badge bg-info text-dark" style="font-size: 10px;">Ren. ${p.numero_renovacion}</span>` : '';
      tbody.innerHTML += `
        <tr>
          <td><strong>${p.numero_poliza || 'PENDIENTE'}</strong>${renLabel}</td>
          <td>${p.compania}</td>
          <td>
            <div class="fw-bold">${p.cobertura}</div>
            <div class="small text-muted">${vDesc}</div>
          </td>
          <td>
            <div class="small">Inicio: ${formatDate(p.fecha_inicio)}</div>
            <div class="small">Vence: ${formatDate(p.fecha_vencimiento)}</div>
          </td>
          <td class="fw-bold text-success">${formatMoney(p.valor_cuota)} <span class="small text-muted">(${p.forma_pago})</span></td>
          <td><span class="badge-status badge-${p.estado}">${p.estado}</span></td>
          <td>
            <div class="d-flex gap-1">
              ${p.estado === 'vencida' ? `
                <button class="btn btn-sm btn-success py-1" onclick="quickRenewPolicy(${p.id})" title="Renovar Póliza">
                  <i class="fa-solid fa-rotate me-1"></i> Renovar
                </button>
              ` : ''}
              <button class="btn btn-sm btn-link text-danger" onclick="deletePolicy(${p.id})"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error(err);
  }
}

// Función para abrir el modal de renovación
function quickRenewPolicy(policyId) {
  document.getElementById('renovar-poliza-id').value = policyId;
  document.getElementById('ren-nuevo-numero').value = '';
  document.getElementById('ren-tipo-cuatrimestral').checked = true;
  document.getElementById('div-nuevo-numero-poliza').classList.add('d-none');
  
  const modal = new bootstrap.Modal(document.getElementById('modalRenovacion'));
  modal.show();
}

// Lógica de mostrar/ocultar el input del nuevo número en caso de renovación anual
document.addEventListener('change', (e) => {
  if (e.target && e.target.name === 'tipoRenovacion') {
    const divNuevoNum = document.getElementById('div-nuevo-numero-poliza');
    if (e.target.value === 'anual') {
      divNuevoNum.classList.remove('d-none');
      document.getElementById('ren-nuevo-numero').required = true;
    } else {
      divNuevoNum.classList.add('d-none');
      document.getElementById('ren-nuevo-numero').required = false;
    }
  }
});

// Enviar formulario de renovación
document.addEventListener('submit', async (e) => {
  if (e.target && e.target.id === 'formRenovacion') {
    e.preventDefault();
    const policyId = document.getElementById('renovar-poliza-id').value;
    const tipo = document.querySelector('input[name="tipoRenovacion"]:checked').value;
    const numero_poliza = document.getElementById('ren-nuevo-numero').value.trim();

    const payload = { tipo };
    if (tipo === 'anual') {
      if (!numero_poliza) {
        showToast('Por favor, ingrese el nuevo número de póliza.', 'warning');
        return;
      }
      payload.numero_poliza = numero_poliza;
    }

    try {
      await apiFetch(`/api/policies/${policyId}/renew`, {
        method: 'POST',
        body: payload
      });

      bootstrap.Modal.getInstance(document.getElementById('modalRenovacion')).hide();
      showToast('Póliza renovada con éxito.', 'success');
      
      // Recargar listas según vista activa
      if (document.getElementById('panel-polizas').classList.contains('d-none')) {
        loadClientPolicies();
      } else {
        loadPoliciesList();
      }
    } catch (err) {
      showToast('Error al renovar póliza: ' + err.message, 'danger');
    }
  }
});

async function deletePolicy(policyId) {
  const ok = await showConfirm({
    title: 'Eliminar Póliza',
    message: '¿Está seguro de eliminar esta póliza? Esta acción no se puede deshacer.',
    okText: 'Sí, eliminar',
    okClass: 'btn-danger'
  });
  if (ok) {
    try {
      await apiFetch(`/api/policies/${policyId}`, { method: 'DELETE' });
      loadClientPolicies();
      showToast('Póliza eliminada.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
}

document.getElementById('btn-add-policy').addEventListener('click', async () => {
  // Llenar selector de vehículos del cliente
  try {
    const vehicles = await apiFetch(`/api/clients/${activeClientId}/vehicles`);
    const select = document.getElementById('poliza-vehiculo');
    select.innerHTML = '<option value="">Ninguno</option>';
    vehicles.forEach(v => {
      const verStr = v.version ? ` ${v.version}` : '';
      select.innerHTML += `<option value="${v.id}">${v.marca} ${v.modelo}${verStr} [${v.patente}]</option>`;
    });

    document.getElementById('formPoliza').reset();
    const modal = new bootstrap.Modal(document.getElementById('modalPoliza'));
    modal.show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('formPoliza').addEventListener('submit', async (e) => {
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
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// 4.3 SUB-TAB: SINIESTROS
async function loadClientClaims() {
  try {
    const claims = await apiFetch(`/api/claims`);
    // Filtrar los del cliente activo
    const filtered = claims.filter(s => s.cliente_id === activeClientId);
    const tbody = document.getElementById('detail-claims-body');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay siniestros reportados.</td></tr>`;
      return;
    }

    filtered.forEach(s => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${s.numero_siniestro}</strong></td>
          <td><span class="badge bg-secondary font-monospace">${s.patente || '--'}</span></td>
          <td>${formatDate(s.fecha)}</td>
          <td>${s.descripcion}</td>
          <td><span class="badge bg-dark">${s.estado.replace('_', ' ')}</span></td>
          <td>
            <button class="btn btn-sm btn-link text-danger" onclick="deleteClaim(${s.id})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('btn-add-claim').addEventListener('click', async () => {
  try {
    // Llenar listado de pólizas vigentes para asociar
    const policies = await apiFetch(`/api/clients/${activeClientId}/policies`);
    const select = document.getElementById('siniestro-poliza-select');
    select.innerHTML = '<option value="">Seleccione Póliza</option>';
    policies.forEach(p => {
      select.innerHTML += `<option value="${p.id}" data-vehiculo="${p.vehiculo_id}">${p.numero_poliza || 'Pendiente'} (${p.compania})</option>`;
    });

    document.getElementById('formSiniestro').reset();
    const modal = new bootstrap.Modal(document.getElementById('modalSiniestro'));
    modal.show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('formSiniestro').addEventListener('submit', async (e) => {
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
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

async function deleteClaim(id) {
  const ok = await showConfirm({
    title: 'Eliminar Siniestro',
    message: '¿Está seguro de eliminar este siniestro?',
    okText: 'Sí, eliminar',
    okClass: 'btn-danger',
    icon: 'fa-car-burst text-danger'
  });
  if (ok) {
    try {
      await apiFetch(`/api/claims/${id}`, { method: 'DELETE' });
      loadClientClaims();
      showToast('Siniestro eliminado.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
}

// 4.4 SUB-TAB: HISTORIAL CRM TIMELINE
async function loadClientHistory() {
  try {
    const history = await apiFetch(`/api/clients/${activeClientId}/history`);
    const container = document.getElementById('detail-timeline-body');
    container.innerHTML = '';

    if (history.length === 0) {
      container.innerHTML = `<p class="text-muted text-center py-3">No hay historial de contactos registrado.</p>`;
      return;
    }

    const icons = {
      whatsapp: 'fa-brands fa-whatsapp whatsapp',
      llamada: 'fa-solid fa-phone llamada',
      email: 'fa-solid fa-envelope email',
      nota: 'fa-solid fa-pen-clip nota'
    };

    history.forEach(log => {
      const iconClass = icons[log.tipo_contacto] || 'fa-solid fa-circle';
      container.innerHTML += `
        <div class="timeline-item">
          <div class="timeline-icon ${log.tipo_contacto}">
            <i class="${iconClass.split(' ')[0]} ${iconClass.split(' ')[1]}"></i>
          </div>
          <div class="timeline-date">${new Date(log.fecha_creacion).toLocaleString()}</div>
          <div class="timeline-content">
            <strong>${log.tipo_contacto.toUpperCase()}:</strong> ${log.descripcion}
          </div>
        </div>
      `;
    });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('formCRMContact').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    cliente_id: activeClientId,
    tipo_contacto: document.getElementById('crm-contact-type').value,
    descripcion: document.getElementById('crm-contact-desc').value
  };

  try {
    await apiFetch('/api/crm/logs', { method: 'POST', body: payload });
    document.getElementById('crm-contact-desc').value = '';
    loadClientHistory();
    showToast('Contacto registrado en el historial.', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// 4.5 SUB-TAB: DOCUMENTOS DIGITALES
async function loadClientDocs() {
  try {
    const docs = await apiFetch(`/api/clients/${activeClientId}/attachments`);
    const tbody = document.getElementById('detail-docs-body');
    tbody.innerHTML = '';

    if (docs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay documentos cargados.</td></tr>`;
      return;
    }

    docs.forEach(doc => {
      tbody.innerHTML += `
        <tr>
          <td><strong>${doc.nombre_archivo}</strong></td>
          <td><span class="badge bg-secondary">${doc.tipo_documento.toUpperCase()}</span></td>
          <td>${new Date(doc.fecha_subida).toLocaleDateString()}</td>
          <td>
            <a href="${doc.ruta_archivo}" target="_blank" class="btn btn-sm btn-outline-primary">
              <i class="fa-solid fa-eye"></i> Ver
            </a>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('formUploadDoc').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('doc-file');
  const docType = document.getElementById('doc-type').value;

  if (fileInput.files.length === 0) return;

  const formData = new FormData();
  formData.append('archivo', fileInput.files[0]);
  formData.append('cliente_id', activeClientId);
  formData.append('tipo_documento', docType);

  try {
    // Al subir archivos usamos FormData, no JSON
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'x-user-role': currentUser.rol
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Error al subir archivo');
    }

    fileInput.value = '';
    loadClientDocs();
    showToast('Documento subido correctamente.', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
});


// ==========================================
// 5. LISTADO GENERAL DE PÓLIZAS (con paginación)
// ==========================================
let allPolicies = [];

async function loadPoliciesList() {
  try {
    const data = await apiFetch('/api/policies');
    allPolicies = data;
    policiesPage = 1;
    renderPoliciesPage();
  } catch (err) {
    console.error(err);
  }
}

function renderPoliciesPage() {
  const query = document.getElementById('search-policy').value.toLowerCase();
  const status = document.getElementById('filter-policy-status').value;
  const company = document.getElementById('filter-policy-company').value;

  const filtered = allPolicies.filter(p => {
    const matchSearch = (p.numero_poliza || '').toLowerCase().includes(query) || (p.cliente_nombre || '').toLowerCase().includes(query);
    const matchStatus = status === '' || p.estado === status;
    const matchCompany = company === '' || p.compania === company;
    return matchSearch && matchStatus && matchCompany;
  });

  policiesPage = paginate({
    items: filtered,
    page: policiesPage,
    pageSize: PAGE_SIZE,
    tbodyId: 'policies-table-body',
    renderFn: renderPolicies,
    wrapId: 'policies-pagination-wrap',
    infoId: 'policies-pagination-info',
    navId: 'policies-pagination'
  });

  const nav = document.getElementById('policies-pagination');
  nav.addEventListener('pagechange', () => {
    policiesPage = parseInt(nav.dataset.page);
    renderPoliciesPage();
  }, { once: true });
}

function renderPolicies(policies) {
  const tbody = document.getElementById('policies-table-body');
  tbody.innerHTML = '';

  if (policies.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">No se encontraron pólizas.</td></tr>`;
    return;
  }

  policies.forEach(p => {
    const vDesc = p.marca ? `${p.marca} ${p.modelo} <span class="small font-monospace bg-light p-1">(${p.patente})</span>` : 'Sin vehículo';
    const renLabel = p.numero_renovacion > 0 ? ` <span class="badge bg-info text-dark" style="font-size: 10px;">Ren. ${p.numero_renovacion}</span>` : '';
    tbody.innerHTML += `
      <tr>
        <td><strong>${p.numero_poliza || 'PENDIENTE'}</strong>${renLabel}</td>
        <td>${p.cliente_nombre}</td>
        <td>${vDesc}</td>
        <td>${p.compania}</td>
        <td>${p.cobertura}</td>
        <td class="fw-bold">${formatDate(p.fecha_vencimiento)}</td>
        <td>
          <div class="fw-bold text-success">${formatMoney(p.valor_cuota)}/mes</div>
          <div class="small text-muted">${p.forma_pago}</div>
        </td>
        <td><span class="badge-status badge-${p.estado}">${p.estado}</span></td>
        <td>
          <div class="d-flex gap-1">
            ${p.estado === 'vencida' ? `
              <button class="btn btn-sm btn-success py-1" onclick="quickRenewPolicy(${p.id})" title="Renovar Póliza">
                <i class="fa-solid fa-rotate"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  });
}

// Filtros de pólizas
function filterPolicies() {
  policiesPage = 1;
  renderPoliciesPage();
}

document.getElementById('search-policy').addEventListener('keyup', filterPolicies);
document.getElementById('filter-policy-status').addEventListener('change', filterPolicies);
document.getElementById('filter-policy-company').addEventListener('change', filterPolicies);


// ==========================================
// 6. COTIZACIONES Y CRM COMERCIAL (FUNNEL)
// ==========================================
let allQuotes = [];

async function loadQuotesList() {
  try {
    const data = await apiFetch('/api/quotes');
    allQuotes = data;
    renderQuotesTable(data);
    renderCommercialFunnel(data);
  } catch (err) {
    console.error(err);
  }
}

function renderQuotesTable(quotes) {
  const tbody = document.getElementById('quotes-table-body');
  tbody.innerHTML = '';

  if (quotes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">No se encontraron cotizaciones.</td></tr>`;
    return;
  }

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
          <div class="d-flex gap-1">
            ${q.estado === 'pendiente' || q.estado === 'enviada' ? `
              <button class="btn btn-sm btn-success" onclick="openConvertQuoteModal(${q.id})">
                <i class="fa-solid fa-file-signature"></i> Póliza
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  });
}

function renderCommercialFunnel(quotes) {
  const stages = {
    pendiente: document.getElementById('funnel-pending-body'),
    enviada: document.getElementById('funnel-sent-body'),
    aceptada: document.getElementById('funnel-accepted-body'),
    rechazada: document.getElementById('funnel-rejected-body')
  };

  // Limpiar contenedores
  Object.keys(stages).forEach(k => {
    stages[k].innerHTML = '';
    document.getElementById(`funnel-count-${k === 'pendiente' ? 'pending' : k === 'enviada' ? 'sent' : k === 'aceptada' ? 'accepted' : 'rejected'}`).innerText = '0';
  });

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
          <span class="small text-muted" style="font-size: 10px;">${new Date(q.fecha_creacion).toLocaleDateString()}</span>
          <div class="dropdown">
            <button class="btn btn-sm p-0 text-muted" type="button" data-bs-toggle="dropdown">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end" style="font-size: 0.8rem;">
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id}, 'pendiente')">Mover a Pendiente</a></li>
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id}, 'enviada')">Mover a Enviado</a></li>
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id}, 'aceptada')">Aceptar Propuesta</a></li>
              <li><a class="dropdown-item" href="#" onclick="updateQuoteStatus(${q.id}, 'rechazada')">Rechazar</a></li>
              ${q.estado === 'aceptada' ? `
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-success fw-bold" href="#" onclick="openConvertQuoteModal(${q.id})">Emitir Póliza</a></li>
              ` : ''}
            </ul>
          </div>
        </div>
      `;
      body.appendChild(card);
    }
  });

  // Actualizar contadores
  document.getElementById('funnel-count-pending').innerText = counts.pendiente;
  document.getElementById('funnel-count-sent').innerText = counts.enviada;
  document.getElementById('funnel-count-accepted').innerText = counts.aceptada;
  document.getElementById('funnel-count-rejected').innerText = counts.rechazada;
}

// Cambiar estado de cotización en el CRM
async function updateQuoteStatus(quoteId, newStatus) {
  try {
    const q = allQuotes.find(quote => quote.id === quoteId);
    if (!q) return;

    await apiFetch(`/api/quotes/${quoteId}`, {
      method: 'PUT',
      body: {
        compania: q.compania,
        cobertura: q.cobertura,
        monto_total: q.monto_total,
        valor_cuota: q.valor_cuota,
        estado: newStatus,
        notas: q.notas
      }
    });

    loadQuotesList();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Convertir cotización a póliza modal
function openConvertQuoteModal(quoteId) {
  document.getElementById('convert-cot-id').value = quoteId;
  document.getElementById('formConvertirCotizacion').reset();
  
  // Rellenar fecha de hoy
  document.getElementById('convert-inicio').value = new Date().toISOString().split('T')[0];
  
  // Vencimiento por defecto a 1 año
  const fin = new Date();
  fin.setFullYear(fin.getFullYear() + 1);
  document.getElementById('convert-vencimiento').value = fin.toISOString().split('T')[0];

  const modal = new bootstrap.Modal(document.getElementById('modalConvertirCotizacion'));
  modal.show();
}

document.getElementById('formConvertirCotizacion').addEventListener('submit', async (e) => {
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
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// Botón global de generar cotización
document.getElementById('btn-new-quote-global').addEventListener('click', async () => {
  try {
    // Llenar selector de clientes en cotización
    const clients = await apiFetch('/api/clients');
    const select = document.getElementById('cot-cliente-select');
    select.innerHTML = '<option value="">Seleccione Cliente</option>';
    clients.forEach(c => {
      select.innerHTML += `<option value="${c.id}">${c.nombre} (DNI: ${c.dni_cuit})</option>`;
    });

    document.getElementById('formCotizacion').reset();
    const modal = new bootstrap.Modal(document.getElementById('modalCotizacion'));
    modal.show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// Vincular autos del cliente seleccionado en cotización
document.getElementById('cot-cliente-select').addEventListener('change', async (e) => {
  const cId = e.target.value;
  const selectVeh = document.getElementById('cot-vehiculo-select');
  selectVeh.innerHTML = '<option value="">Seleccione Vehículo</option>';
  if (!cId) return;

  try {
    const vehicles = await apiFetch(`/api/clients/${cId}/vehicles`);
    vehicles.forEach(v => {
      const verStr = v.version ? ` ${v.version}` : '';
      selectVeh.innerHTML += `<option value="${v.id}">${v.marca} ${v.modelo}${verStr} [${v.patente}]</option>`;
    });
  } catch (err) {
    console.error(err);
  }
});

document.getElementById('formCotizacion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cId = document.getElementById('cot-cliente-select').value;
  const vId = document.getElementById('cot-vehiculo-select').value;

  const payload = {
    cliente_id: parseInt(cId),
    vehiculo_id: vId ? parseInt(vId) : null,
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
  } catch (err) {
    showToast(err.message, 'danger');
  }
});


// ==========================================
// 7. GESTIÓN GLOBAL DE SINIESTROS
// ==========================================
let allClaims = [];

async function loadClaimsList() {
  try {
    const data = await apiFetch('/api/claims');
    allClaims = data;
    renderClaimsTable(data);
  } catch (err) {
    console.error(err);
  }
}

function renderClaimsTable(claims) {
  const tbody = document.getElementById('claims-table-body');
  tbody.innerHTML = '';

  if (claims.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No se encontraron siniestros.</td></tr>`;
    return;
  }

  claims.forEach(s => {
    const pInfo = s.numero_poliza ? `${s.compania} | ${s.numero_poliza}` : 'Sin póliza';
    const vInfo = s.marca ? `${s.marca} ${s.modelo} (${s.patente})` : 'Sin patente';

    tbody.innerHTML += `
      <tr>
        <td><strong>${s.numero_siniestro}</strong></td>
        <td>${s.cliente_nombre}</td>
        <td>${pInfo}</td>
        <td>${vInfo}</td>
        <td>${formatDate(s.fecha)}</td>
        <td>${s.descripcion}</td>
        <td>
          <select class="form-select form-select-sm" style="width: 150px;" onchange="updateClaimStatus(${s.id}, this.value)">
            <option value="denunciado" ${s.estado === 'denunciado' ? 'selected' : ''}>Denunciado</option>
            <option value="en_proceso" ${s.estado === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
            <option value="doc_pendiente" ${s.estado === 'doc_pendiente' ? 'selected' : ''}>Doc. Pendiente</option>
            <option value="resuelto" ${s.estado === 'resuelto' ? 'selected' : ''}>Resuelto</option>
          </select>
        </td>
        <td>
          <button class="btn btn-sm btn-premium" onclick="openClientDetail(${s.cliente_id})">
            <i class="fa-solid fa-user-gear"></i>
          </button>
        </td>
      </tr>
    `;
  });
}

async function updateClaimStatus(claimId, newStatus) {
  try {
    const claim = allClaims.find(c => c.id === claimId);
    if (!claim) return;

    await apiFetch(`/api/claims/${claimId}`, {
      method: 'PUT',
      body: {
        numero_siniestro: claim.numero_siniestro,
        fecha: claim.fecha,
        descripcion: claim.descripcion,
        estado: newStatus
      }
    });

    loadClaimsList();
    showToast('Estado del siniestro actualizado.', 'info');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ==========================================
// 8. AGENDA Y SEGUIMIENTO
// ==========================================
async function loadAgendaList() {
  try {
    const data = await apiFetch('/api/agenda');
    const tbody = document.getElementById('agenda-table-body');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4">No hay tareas pendientes en la agenda.</td></tr>`;
      return;
    }

    data.forEach(task => {
      const completadoClass = task.completado === 1 ? 'text-decoration-line-through text-muted' : '';
      const checked = task.completado === 1 ? 'checked' : '';
      const associatedClient = task.cliente_nombre ? `${task.cliente_nombre} (${task.cliente_telefono || '--'})` : 'General / PAS';

      tbody.innerHTML += `
        <tr class="${completadoClass}">
          <td>
            <div class="d-flex align-items-center gap-2">
              <input class="form-check-input" type="checkbox" ${checked} onchange="toggleTaskComplete(${task.id}, ${task.completado === 1 ? 0 : 1})">
              <div>
                <strong>${task.titulo}</strong>
                <div class="small text-muted">${task.descripcion || ''}</div>
              </div>
            </div>
          </td>
          <td>${associatedClient}</td>
          <td class="fw-bold">${formatDate(task.fecha_vencimiento)}</td>
          <td><span class="badge bg-secondary text-uppercase">${task.tipo}</span></td>
          <td>
            <button class="btn btn-sm btn-link text-danger" onclick="deleteTask(${task.id})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>
      `;
    });

    // Cargar nota local
    document.getElementById('quick-notes-area').value = localStorage.getItem('gpg_quick_notes') || '';
  } catch (err) {
    console.error(err);
  }
}

async function toggleTaskComplete(id, completedVal) {
  try {
    const tasks = await apiFetch('/api/agenda');
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    await apiFetch(`/api/agenda/${id}`, {
      method: 'PUT',
      body: {
        titulo: task.titulo,
        descripcion: task.descripcion,
        fecha_vencimiento: task.fecha_vencimiento,
        tipo: task.tipo,
        completado: completedVal
      }
    });

    loadAgendaList();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function deleteTask(id) {
  const ok = await showConfirm({
    title: 'Eliminar Tarea',
    message: '¿Desea eliminar esta tarea de la agenda?',
    okText: 'Sí, eliminar',
    okClass: 'btn-danger',
    icon: 'fa-calendar-xmark text-danger'
  });
  if (ok) {
    try {
      await apiFetch(`/api/agenda/${id}`, { method: 'DELETE' });
      loadAgendaList();
      showToast('Tarea eliminada.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
}

// Botón de guardar nota local
document.getElementById('btn-save-quick-notes').addEventListener('click', () => {
  const txt = document.getElementById('quick-notes-area').value;
  localStorage.setItem('gpg_quick_notes', txt);
  showToast('Notas guardadas localmente.', 'success');
});

// Modal de agregar tarea
document.getElementById('btn-add-task').addEventListener('click', async () => {
  try {
    const clients = await apiFetch('/api/clients');
    const select = document.getElementById('agenda-cliente-select');
    select.innerHTML = '<option value="">Ninguno</option>';
    clients.forEach(c => {
      select.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
    });

    document.getElementById('formAgenda').reset();
    const modal = new bootstrap.Modal(document.getElementById('modalAgenda'));
    modal.show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('formAgenda').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cId = document.getElementById('agenda-cliente-select').value;
  const payload = {
    cliente_id: cId ? parseInt(cId) : null,
    titulo: document.getElementById('agenda-titulo').value,
    descripcion: document.getElementById('agenda-desc').value,
    fecha_vencimiento: document.getElementById('agenda-fecha').value,
    tipo: document.getElementById('agenda-tipo').value
  };

  try {
    await apiFetch('/api/agenda', { method: 'POST', body: payload });
    bootstrap.Modal.getInstance(document.getElementById('modalAgenda')).hide();
    loadAgendaList();
    showToast('Tarea agregada a la agenda.', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
});


// ==========================================
// 9. GESTIÓN DE COMISIONES (ADMIN/PROD)
// ==========================================
let allCommissions = [];

async function loadCommissionsList() {
  try {
    const data = await apiFetch('/api/commissions');
    allCommissions = data;
    renderCommissions(data);

    // Cargar selector de periodos únicos
    const periodSelect = document.getElementById('filter-com-period');
    periodSelect.innerHTML = '<option value="">Todos los Períodos</option>';
    const periods = [...new Set(data.map(c => c.periodo))].sort().reverse();
    periods.forEach(p => {
      periodSelect.innerHTML += `<option value="${p}">${p}</option>`;
    });
  } catch (err) {
    console.error(err);
  }
}

function renderCommissions(commissions) {
  const tbody = document.getElementById('comisiones-table-body');
  tbody.innerHTML = '';

  if (commissions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">No hay comisiones registradas.</td></tr>`;
    return;
  }

  commissions.forEach(c => {
    const isPaid = c.estado_pago === 'pagado';
    const statusBadge = isPaid ? `<span class="badge bg-success">Cobrado</span>` : `<span class="badge bg-warning">Pendiente</span>`;
    const actionBtn = !isPaid && currentUser.rol === 'admin' ? `
      <button class="btn btn-sm btn-success" onclick="markCommissionPaid(${c.id})">
        <i class="fa-solid fa-cash-register me-1"></i> Cobrar
      </button>
    ` : '--';

    tbody.innerHTML += `
      <tr>
        <td><strong>${c.numero_poliza}</strong></td>
        <td>${c.cliente_nombre}</td>
        <td>${c.compania}</td>
        <td>${c.periodo}</td>
        <td>${formatMoney(c.monto_poliza)}</td>
        <td>${c.tasa_comision * 100}%</td>
        <td class="fw-bold text-success">${formatMoney(c.monto_comision)}</td>
        <td>${statusBadge}</td>
        <td class="action-col">${actionBtn}</td>
      </tr>
    `;
  });
}

async function markCommissionPaid(id) {
  const ok = await showConfirm({
    title: 'Marcar como Cobrado',
    message: '¿Desea marcar esta comisión como cobrada/liquidada?',
    okText: 'Confirmar Cobro',
    okClass: 'btn-success',
    icon: 'fa-cash-register text-success'
  });
  if (ok) {
    try {
      await apiFetch(`/api/commissions/${id}`, {
        method: 'PUT',
        body: { estado_pago: 'pagado' }
      });
      loadCommissionsList();
      showToast('Comisión marcada como cobrada.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
}

function filterCommissions() {
  const period = document.getElementById('filter-com-period').value;
  const company = document.getElementById('filter-com-company').value;

  const filtered = allCommissions.filter(c => {
    const matchPeriod = period === '' || c.periodo === period;
    const matchCompany = company === '' || c.compania === company;
    return matchPeriod && matchCompany;
  });

  renderCommissions(filtered);
}

document.getElementById('filter-com-period').addEventListener('change', filterCommissions);
document.getElementById('filter-com-company').addEventListener('change', filterCommissions);


// ==========================================
// 10. REPORTES Y EXPORTACIÓN
// ==========================================
async function loadReportsData() {
  // Cargar gráfico de distribución de compañías para la visualización del panel
  try {
    const policies = await apiFetch('/api/policies');
    const counts = {};
    policies.forEach(p => {
      counts[p.compania] = (counts[p.compania] || 0) + 1;
    });

    const labels = Object.keys(counts);
    const chartData = Object.values(counts);

    const ctx = document.getElementById('chartProduccionCompania').getContext('2d');
    if (chartProduccionObj) {
      chartProduccionObj.destroy();
    }

    chartProduccionObj = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Sin datos'],
        datasets: [{
          data: chartData.length ? chartData : [1],
          backgroundColor: ['#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { boxWidth: 12, font: { size: 10 } }
          }
        }
      }
    });
  } catch (err) {
    console.error(err);
  }
}

// Descargar archivos
document.getElementById('btn-export-pdf').addEventListener('click', () => {
  const type = document.getElementById('report-select-type').value;
  // Trigger directo al endpoint de descarga
  window.open(`/api/reports/pdf?type=${type}&x-user-role=${currentUser.rol}`, '_blank');
});

document.getElementById('btn-export-excel').addEventListener('click', () => {
  const type = document.getElementById('report-select-type').value;
  window.open(`/api/reports/excel?type=${type}&x-user-role=${currentUser.rol}`, '_blank');
});

// ==========================================
// 11. IMPORTAR CLIENTES DESDE EXCEL
// ==========================================
document.getElementById('formImportarClientes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('excel-file');
  const resultDiv = document.getElementById('import-result');
  const btnSubmit = document.getElementById('btn-submit-import');

  if (fileInput.files.length === 0) return;

  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status"></span> Importando...`;

  const formData = new FormData();
  formData.append('archivo', fileInput.files[0]);

  try {
    const response = await fetch('/api/clients/import', {
      method: 'POST',
      headers: {
        'x-user-role': currentUser.rol
      },
      body: formData
    });

    const data = await response.json();

    resultDiv.classList.remove('d-none', 'alert-danger', 'alert-success');
    if (response.ok) {
      resultDiv.classList.add('alert-success');
      resultDiv.innerHTML = `
        <strong>¡Importación finalizada!</strong><br>
        • Clientes nuevos: ${data.insertados}<br>
        • Clientes actualizados (modificados): ${data.actualizados}<br>
        • Filas omitidas: ${data.omitidos}
      `;
      fileInput.value = '';
      loadClientsList();
    } else {
      resultDiv.classList.add('alert-danger');
      resultDiv.innerText = data.error || 'Error al procesar el archivo.';
    }
  } catch (err) {
    resultDiv.classList.remove('d-none', 'alert-success');
    resultDiv.classList.add('alert-danger');
    resultDiv.innerText = 'Error al comunicarse con el servidor.';
    console.error(err);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<i class="fa-solid fa-upload me-1"></i> Subir e Importar`;
  }
});

// Limpiar modal al abrir
document.getElementById('btn-import-clients-modal').addEventListener('click', () => {
  const resultDiv = document.getElementById('import-result');
  resultDiv.classList.add('d-none');
  resultDiv.innerText = '';
  document.getElementById('excel-file').value = '';
});

// Inicializar selectores de clientes
initProvinceAndCitySelects();


