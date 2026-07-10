// =========================================================================
// auth.js — Autenticación del lado del cliente
// =========================================================================

// NOTA: El token JWT ya NO se guarda en localStorage.
// Viaja exclusivamente en una cookie httpOnly que el servidor setea.
// Solo guardamos el objeto "user" (sin datos sensibles) en localStorage
// para mostrar nombre/rol en la UI.

let currentUser = null;

/** Verifica sesión activa. Si no hay datos de usuario, redirige al login. */
function checkAuth() {
  const userStr = localStorage.getItem('gpg_user');
  if (!userStr) {
    window.location.href = '/index.html';
    return null;
  }
  try {
    currentUser = JSON.parse(userStr);
    return currentUser;
  } catch {
    localStorage.removeItem('gpg_user');
    window.location.href = '/index.html';
    return null;
  }
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
  document.getElementById('nav-user-name').innerText = user.nombre;
  document.getElementById('nav-user-role').innerText = user.rol;
  document.getElementById('nav-user-avatar').innerText = user.nombre.substring(0, 1).toUpperCase();
  document.getElementById('current-date-badge').innerText = `Hoy: ${new Date().toLocaleDateString()}`;

  // Controlar visibilidad según rol
  if (user.rol === 'admin' || user.rol === 'productor') {
    document.getElementById('menu-comisiones')?.classList.remove('d-none');
    document.getElementById('btn-delete-detail-client')?.classList.remove('d-none');
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
