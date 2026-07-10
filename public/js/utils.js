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
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/** Formateadores */
const formatMoney = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
const formatDate = (dateStr) => {
  if (!dateStr) return '--';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};
