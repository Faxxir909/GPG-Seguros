// =========================================================================
// globalSearch.js — Buscador Global Spotlight (Ctrl + K)
// =========================================================================

let globalSearchTimeout = null;
let currentResults = [];
let selectedIndex = -1;

function initGlobalSearch() {
  const searchInput = document.getElementById('global-search-input');
  const btnOpenSearch = document.getElementById('btn-open-global-search');
  const modalEl = document.getElementById('modalGlobalSearch');

  if (!modalEl) return;
  const searchModal = new bootstrap.Modal(modalEl);

  // Abrir modal con botón
  btnOpenSearch?.addEventListener('click', () => {
    searchModal.show();
  });

  // Atajo de teclado global Ctrl + K o Cmd + K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchModal.show();
    }
  });

  // Focus en el input al abrir modal
  modalEl.addEventListener('shown.bs.modal', () => {
    searchInput?.focus();
    if (searchInput) searchInput.value = '';
    renderSearchResults([]);
  });

  // Input listener con debounce
  searchInput?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (globalSearchTimeout) clearTimeout(globalSearchTimeout);

    if (q.length < 2) {
      renderSearchResults([]);
      return;
    }

    globalSearchTimeout = setTimeout(async () => {
      try {
        const data = await apiFetch(`/api/search/global?q=${encodeURIComponent(q)}`);
        currentResults = data.results || [];
        selectedIndex = -1;
        renderSearchResults(currentResults);
      } catch (err) {
        console.error('Error en búsqueda global:', err);
      }
    }, 200);
  });

  // Navegación con teclado (Flecha Arriba, Flecha Abajo, Enter)
  searchInput?.addEventListener('keydown', (e) => {
    const items = document.querySelectorAll('.global-search-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelectedSearchItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelectedSearchItem(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < currentResults.length) {
        handleSelectSearchResult(currentResults[selectedIndex]);
      } else if (items.length > 0) {
        handleSelectSearchResult(currentResults[0]);
      }
    }
  });
}

function updateSelectedSearchItem(items) {
  items.forEach((item, idx) => {
    if (idx === selectedIndex) {
      item.classList.add('active', 'bg-light');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active', 'bg-light');
    }
  });
}

function renderSearchResults(results) {
  const list = document.getElementById('global-search-results-list');
  const placeholder = document.getElementById('global-search-placeholder');
  if (!list || !placeholder) return;

  if (!results || results.length === 0) {
    list.innerHTML = '';
    placeholder.classList.remove('d-none');
    return;
  }

  placeholder.classList.add('d-none');
  let html = '';

  results.forEach((item, idx) => {
    html += `
      <a href="#" class="list-group-item list-group-item-action d-flex align-items-center gap-3 p-3 border-0 border-bottom global-search-item" data-index="${idx}" onclick="event.preventDefault(); handleSelectSearchResult(currentResults[${idx}]);">
        <div class="stats-icon bg-${item.badgeColor || 'primary'}-subtle text-${item.badgeColor || 'primary'} rounded-3 d-flex align-items-center justify-content-center" style="width: 42px; height: 42px; min-width: 42px;">
          <i class="fa-solid ${item.icon || 'fa-magnifying-glass'}"></i>
        </div>
        <div class="flex-grow-1 overflow-hidden">
          <div class="d-flex align-items-center gap-2">
            <span class="fw-bold text-dark text-truncate">${item.title}</span>
            <span class="badge bg-${item.badgeColor || 'secondary'}-subtle text-${item.badgeColor || 'secondary'} border border-${item.badgeColor || 'secondary'}-subtle small">${item.category}</span>
          </div>
          <div class="small text-muted text-truncate mt-0.5">${item.subtitle}</div>
        </div>
        <i class="fa-solid fa-chevron-right text-muted opacity-50"></i>
      </a>
    `;
  });

  list.innerHTML = html;
}

function handleSelectSearchResult(item) {
  if (!item) return;
  const modalEl = document.getElementById('modalGlobalSearch');
  const searchModal = bootstrap.Modal.getInstance(modalEl);
  if (searchModal) searchModal.hide();

  if (item.type === 'cliente') {
    // Abrir ficha del cliente
    if (typeof openClientDetail === 'function') {
      openClientDetail(item.id);
    }
  } else if (item.type === 'poliza') {
    // Ir al panel de pólizas y filtrar
    const searchPolInput = document.getElementById('search-policy');
    if (searchPolInput) {
      searchPolInput.value = item.title.replace('Póliza Nº ', '');
      document.querySelector('a.sidebar-link[data-target="polizas"]')?.click();
      if (typeof filterPolicies === 'function') filterPolicies();
    }
  } else if (item.type === 'vehiculo' && item.clienteId) {
    // Abrir ficha del cliente con la pestaña de vehículos
    if (typeof openClientDetail === 'function') {
      openClientDetail(item.clienteId);
      setTimeout(() => {
        document.getElementById('tab-btn-vehicles')?.click();
      }, 300);
    }
  } else if (item.type === 'siniestro' && item.clienteId) {
    if (typeof openClientDetail === 'function') {
      openClientDetail(item.clienteId);
      setTimeout(() => {
        document.getElementById('tab-btn-claims')?.click();
      }, 300);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initGlobalSearch();
});
