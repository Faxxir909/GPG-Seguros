// =========================================================================
// utils.js — Utilidades globales compartidas por todos los módulos
// =========================================================================

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

/** API Fetch autenticado — usa cookie httpOnly automáticamente (no necesita token manual) */
async function apiFetch(url, options = {}) {
  if (!options.headers) options.headers = {};

  // Las cookies httpOnly se envían automáticamente por el browser con credentials: 'include'
  options.credentials = 'include';

  if (options.body && !(options.body instanceof FormData)) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    if (response.status === 401) {
      // Sesión expirada: limpiar datos locales y redirigir
      localStorage.removeItem('gpg_user');
      window.location.href = '/index.html';
      return new Promise(() => {});
    }
    let errorMsg = `Error HTTP! Estado: ${response.status}`;
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.error) errorMsg = parsed.error;
      } catch {
        if (text && text.trim().length > 0 && text.length < 150) {
          errorMsg = text.trim();
        }
      }
    } catch {}
    throw new Error(errorMsg);
  }
  return response.json();
}

/** Formateadores */
const formatMoney = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
const formatDate = (dateStr) => {
  if (!dateStr) return '--';
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

/** Formateador enriquecido para fechas de vencimiento con insignia de urgencia y barra de vigencia */
function renderExpirationCell(dateStr, compact = false, startDateStr = null) {
  if (!dateStr) return '<span class="text-muted small">--</span>';
  const cleanDate = String(dateStr).split('T')[0];
  const parts = cleanDate.split('-');
  if (parts.length !== 3) return `<span class="text-muted small">${dateStr}</span>`;

  const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  expDate.setHours(0, 0, 0, 0);

  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  let badgeHtml = '';
  let progressPercent = 0;
  let progressColor = 'bg-success';

  if (startDateStr) {
    const cleanStart = String(startDateStr).split('T')[0];
    const sParts = cleanStart.split('-');
    if (sParts.length === 3) {
      const sDate = new Date(parseInt(sParts[0]), parseInt(sParts[1]) - 1, parseInt(sParts[2]));
      sDate.setHours(0, 0, 0, 0);
      const totalPeriod = expDate.getTime() - sDate.getTime();
      const elapsed = today.getTime() - sDate.getTime();
      if (totalPeriod > 0) {
        progressPercent = Math.min(100, Math.max(0, Math.round((elapsed / totalPeriod) * 100)));
        if (progressPercent >= 90) progressColor = 'bg-danger';
        else if (progressPercent >= 75) progressColor = 'bg-warning';
        else progressColor = 'bg-success';
      }
    }
  }

  if (diffDays < 0) {
    const daysAgo = Math.abs(diffDays);
    badgeHtml = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><i class="fa-solid fa-triangle-exclamation me-1"></i>Vencida (${daysAgo === 1 ? 'ayer' : `hace ${daysAgo}d`})</span>`;
    progressPercent = 100;
    progressColor = 'bg-danger';
  } else if (diffDays === 0) {
    badgeHtml = `<span class="badge bg-danger text-white px-2 py-1 pulse-badge shadow-sm"><i class="fa-solid fa-clock me-1"></i>¡Vence Hoy!</span>`;
    progressPercent = 100;
    progressColor = 'bg-danger';
  } else if (diffDays === 1) {
    badgeHtml = `<span class="badge bg-warning text-dark px-2 py-1 shadow-sm"><i class="fa-solid fa-clock me-1"></i>Vence Mañana</span>`;
    progressColor = 'bg-danger';
  } else if (diffDays <= 7) {
    badgeHtml = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1 fw-bold"><i class="fa-solid fa-fire me-1"></i>En ${diffDays} días</span>`;
    progressColor = 'bg-danger';
  } else if (diffDays <= 15) {
    badgeHtml = `<span class="badge bg-warning-subtle text-dark border border-warning px-2 py-1"><i class="fa-solid fa-hourglass-half me-1"></i>En ${diffDays} días</span>`;
    progressColor = 'bg-warning';
  } else if (diffDays <= 30) {
    badgeHtml = `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2 py-1"><i class="fa-solid fa-hourglass-start me-1"></i>En ${diffDays} días</span>`;
    progressColor = 'bg-warning';
  } else if (diffDays <= 60) {
    badgeHtml = `<span class="badge bg-info-subtle text-info-emphasis border border-info-subtle px-2 py-1"><i class="fa-solid fa-calendar-day me-1"></i>En ${diffDays} días</span>`;
    progressColor = 'bg-info';
  } else {
    const months = Math.round(diffDays / 30);
    badgeHtml = `<span class="badge bg-success-subtle text-success-emphasis border border-success-subtle px-2 py-1"><i class="fa-solid fa-circle-check me-1"></i>Vigente (${months}m)</span>`;
  }

  const progressBar = (startDateStr && progressPercent > 0) ? `
    <div class="progress mt-1 w-100" style="height: 4px; background-color: #e2e8f0;" title="Vigencia transcurrida: ${progressPercent}%">
      <div class="progress-bar ${progressColor}" role="progressbar" style="width: ${progressPercent}%"></div>
    </div>
  ` : '';

  if (compact) {
    return `<div class="d-flex align-items-center gap-2"><span class="fw-bold font-monospace text-dark">${formattedDate}</span>${badgeHtml}</div>`;
  }

  return `
    <div class="d-inline-flex flex-column align-items-start gap-1" style="min-width: 140px;">
      <span class="fw-bold font-monospace text-dark" style="font-size: 0.92rem;"><i class="fa-regular fa-calendar me-1 text-primary"></i>${formattedDate}</span>
      ${badgeHtml}
      ${progressBar}
    </div>
  `;
}

/** Debounce para retrasar ejecuciones repetitivas */
function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/** Mostrar filas de tabla con esqueleto de carga shimmer */
function showTableSkeleton(tbodyId, colsCount = 6, rowsCount = 4) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  let html = '';
  const widths = ['65%', '80%', '50%', '70%', '45%', '60%', '75%', '55%', '90%'];
  for (let i = 0; i < rowsCount; i++) {
    html += '<tr>';
    for (let j = 0; j < colsCount; j++) {
      const w = widths[(i + j) % widths.length];
      html += `<td><div class="skeleton-shimmer" style="height: 16px; border-radius: 4px; width: ${w};"></div></td>`;
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;
}

/** Mostrar timeline con esqueleto de carga shimmer */
function showTimelineSkeleton(containerId, count = 3) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="timeline-item skeleton">
        <div class="timeline-icon bg-light"><div class="skeleton-shimmer" style="width:100%; height:100%; border-radius:50%;"></div></div>
        <div class="timeline-date"><div class="skeleton-shimmer" style="height: 12px; width: 80px; border-radius: 4px;"></div></div>
        <div class="timeline-content">
          <div class="skeleton-shimmer" style="height: 14px; width: 40%; border-radius: 4px; margin-bottom: 6px;"></div>
          <div class="skeleton-shimmer" style="height: 12px; width: 90%; border-radius: 4px;"></div>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

/** Mostrar estado vacío estilizado para tablas */
function showTableEmpty(tbodyId, colsCount = 6, message = 'No se encontraron registros.', icon = 'fa-folder-open') {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="${colsCount}" class="text-center py-5 text-muted">
        <div class="empty-state d-flex flex-column align-items-center justify-content-center">
          <i class="fa-solid ${icon} fs-1 text-secondary opacity-50 mb-2"></i>
          <span class="fw-medium">${message}</span>
        </div>
      </td>
    </tr>`;
}

/** Mostrar estado de error para tablas con opción a reintentar */
function showTableError(tbodyId, colsCount = 6, errorMessage = 'Error al cargar los datos.', retryCallStr = '') {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const retryBtn = retryCallStr ? `<button class="btn btn-sm btn-outline-danger mt-2" onclick="${retryCallStr}"><i class="fa-solid fa-rotate-right me-1"></i> Reintentar</button>` : '';
  tbody.innerHTML = `
    <tr>
      <td colspan="${colsCount}" class="text-center py-4 text-danger">
        <div class="d-flex flex-column align-items-center justify-content-center">
          <i class="fa-solid fa-circle-exclamation fs-2 mb-2 text-danger"></i>
          <span class="fw-semibold">${errorMessage}</span>
          ${retryBtn}
        </div>
      </td>
    </tr>`;
}
