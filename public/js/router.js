// =========================================================================
// router.js — SPA Router e inicialización principal de la aplicación
// =========================================================================

const PAGE_SIZE = 15;

// Variables de estado globales del SPA
let activeClientId = null;
let clientsPage = 1;
let policiesPage = 1;
let quotesPage = 1;
let claimsPage = 1;
let chartComisionesObj = null;
let chartProduccionObj = null;
let isAutoFilling = false;

function hideSplashScreen(delayMs = 400) {
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('splash-fade');
      setTimeout(() => splash.remove(), 600);
    }
  }, delayMs);
}

function bootstrapApp() {
  // Ocultar siempre la pantalla de carga incluso si algún módulo secundario demora
  hideSplashScreen(400);

  const user = checkAuth();
  if (!user) return;

  try { initUserUI(user); } catch (e) { console.error('Error en initUserUI:', e); }
  try { startSessionTimer(); } catch (e) { console.error('Error en startSessionTimer:', e); }
  try { initLogoutButton(); } catch (e) { console.error('Error en initLogoutButton:', e); }
  try { initSidebarMobile(); } catch (e) { console.error('Error en initSidebarMobile:', e); }
  try { initNavigation(); } catch (e) { console.error('Error en initNavigation:', e); }
  try {
    if (typeof initProvinceAndCitySelects === 'function') {
      initProvinceAndCitySelects();
    }
  } catch (e) {
    console.error('Error en initProvinceAndCitySelects:', e);
  }

  try {
    loadPanel('dashboard');
  } catch (e) {
    console.error('Error al cargar panel inicial:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}

// Failsafe absoluto para que nunca quede bloqueada la pantalla de carga
setTimeout(() => hideSplashScreen(0), 2500);

/** Sidebar toggle para móviles */
function initSidebarMobile() {
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

  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 992) {
        sidebar.classList.remove('show');
        overlay.classList.remove('show');
      }
    });
  });
}

/** Inicializa navegación SPA */
function initNavigation() {
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      loadPanel(link.getAttribute('data-target'));
    });
  });
}

/** Carga y muestra el panel correspondiente */
function loadPanel(panelId) {
  document.querySelectorAll('.panel-section').forEach(sec => sec.classList.add('d-none'));

  const targetSec = document.getElementById(`panel-${panelId}`);
  if (targetSec) targetSec.classList.remove('d-none');

  if (panelId === 'clientes') {
    document.getElementById('client-detail-view').classList.add('d-none');
    document.getElementById('clients-list-view').classList.remove('d-none');
  }

  const titles = {
    dashboard:    { t: 'Dashboard',               s: 'Resumen en tiempo real de operaciones y vencimientos' },
    clientes:     { t: 'Gestión de Clientes',      s: 'Administración de asegurados, vehículos y fichas históricas' },
    polizas:      { t: 'Pólizas de Seguros',       s: 'Control de coberturas, renovaciones y cobranzas' },
    cotizaciones: { t: 'Cotizaciones y Leads',     s: 'Comparativas de seguros y embudo comercial CRM' },
    siniestros:   { t: 'Gestión de Siniestros',    s: 'Seguimiento de incidentes, peritajes y documentación' },
    agenda:       { t: 'Agenda y Seguimiento',     s: 'Recordatorios, tareas pendientes y renovaciones próximas' },
    comisiones:   { t: 'Gestión de Comisiones',    s: 'Liquidación de comisiones de seguros y producción' },
    reportes:     { t: 'Reportes y Estadísticas',  s: 'Exportación de datos a PDF/Excel y análisis anual' },
    usuarios:     { t: 'Usuarios y Sistema',       s: 'Administración de cuentas, permisos, mantenimiento y auditoría' }
  };

  if (titles[panelId]) {
    document.getElementById('panel-title').innerText  = titles[panelId].t;
    document.getElementById('panel-subtitle').innerText = titles[panelId].s;
  }

  switch (panelId) {
    case 'dashboard':    loadDashboardData();    break;
    case 'clientes':     loadClientsList();      break;
    case 'polizas':      loadPoliciesList();     break;
    case 'cotizaciones': loadQuotesList();       break;
    case 'siniestros':   loadClaimsList();       break;
    case 'agenda':       loadAgendaList();       break;
    case 'comisiones':   loadCommissionsList();  break;
    case 'reportes':     loadReportsData();      break;
    case 'usuarios':     if (typeof loadUsersPanel === 'function') loadUsersPanel(); break;
  }
}
