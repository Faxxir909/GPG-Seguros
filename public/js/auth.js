// =========================================================================
// auth.js — Autenticación del lado del cliente
// =========================================================================

// NOTA: El token JWT ya NO se guarda en localStorage.
// Viaja exclusivamente en una cookie httpOnly que el servidor setea.
// Solo guardamos el objeto "user" (sin datos sensibles) en localStorage
// para mostrar nombre/rol en la UI.

let currentUser = null;

/** Verifica sesión activa. Si no hay datos de usuario, revalida con el servidor o redirige al login. */
function checkAuth() {
  const userStr = localStorage.getItem('gpg_user');
  if (userStr) {
    try {
      currentUser = JSON.parse(userStr);
    } catch {
      localStorage.removeItem('gpg_user');
      currentUser = null;
    }
  }

  // Revalidar siempre la cookie de sesión en el servidor
  if (typeof apiFetch === 'function') {
    apiFetch('/api/auth/me').then(data => {
      if (data && data.user) {
        currentUser = data.user;
        localStorage.setItem('gpg_user', JSON.stringify(data.user));
        if (typeof initUserUI === 'function') {
          initUserUI(data.user);
        }
      }
    }).catch(() => {
      // Si el token expiró, apiFetch borra datos locales y redirige a /index.html
    });
  }

  if (!currentUser) {
    // Fallback temporal mientras /api/auth/me responde si entró con cookie válida
    currentUser = { id: 0, nombre: 'Usuario', rol: 'productor', usuario: '' };
  }

  return currentUser;
}

/** Timer de sesión en sidebar */
function startSessionTimer() {
  const sessionStart = Date.now();
  const display = document.getElementById('session-time-display');
  if (!display) return;
  setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    display.textContent = elapsed >= 3600 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }, 1000);
}

/** Inicializa la UI del usuario en el sidebar */
function initUserUI(user) {
  if (!user) return;
  const nombre = String(user.nombre || user.usuario || 'Usuario');
  const rol = String(user.rol || '');

  const nameEl = document.getElementById('nav-user-name');
  const roleEl = document.getElementById('nav-user-role');
  const avatarEl = document.getElementById('nav-user-avatar');
  const dateEl = document.getElementById('current-date-badge');

  if (nameEl) nameEl.innerText = nombre;
  if (roleEl) roleEl.innerText = rol;
  if (avatarEl) avatarEl.innerText = nombre.substring(0, 1).toUpperCase();
  if (dateEl) dateEl.innerText = `Hoy: ${new Date().toLocaleDateString()}`;

  // Controlar visibilidad según rol
  if (rol === 'admin' || rol === 'productor') {
    document.getElementById('menu-comisiones')?.classList.remove('d-none');
    document.getElementById('btn-delete-detail-client')?.classList.remove('d-none');
  }
  if (rol === 'admin') {
    document.getElementById('menu-usuarios')?.classList.remove('d-none');
  }
}

/** Cerrar sesión: llama al endpoint que borra la cookie httpOnly */
async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {
    console.warn('Error al llamar logout endpoint:', e);
  }
  localStorage.removeItem('gpg_user');
  window.location.href = '/index.html';
}

/** Inicializa el botón de logout con confirmación */
function initLogoutButton() {
  const btnLogout = document.getElementById('btnLogout');
  if (!btnLogout) return;
  btnLogout.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: 'Cerrar Sesión',
      message: '¿Está seguro que desea cerrar la sesión actual?',
      okText: 'Cerrar Sesión',
      okClass: 'btn-danger',
      icon: 'fa-power-off text-danger'
    });
    if (ok) await logout();
  });
}
