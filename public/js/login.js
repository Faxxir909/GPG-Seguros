// login.js — Lógica de inicio de sesión y Google Sign-In desacoplada de index.html

// Redirección si ya está logueado (comprobamos si hay user guardado; el token está en cookie httpOnly)
if (localStorage.getItem('gpg_user')) {
  window.location.href = '/dashboard.html';
}

const form = document.getElementById('loginForm');
const alertBox = document.getElementById('alertBox');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (alertBox) alertBox.classList.add('d-none');

    const usuario = document.getElementById('usuario')?.value?.trim();
    const password = document.getElementById('password')?.value;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ usuario, password })
      });

      const data = await response.json();

      if (response.ok) {
        // El token JWT viaja exclusivamente en cookie httpOnly (no en localStorage ni body)
        localStorage.setItem('gpg_user', JSON.stringify(data.user));
        window.location.href = '/dashboard.html';
      } else {
        if (alertBox) {
          alertBox.innerText = data.error || 'Error al conectar con el servidor';
          alertBox.classList.remove('d-none');
        }
      }
    } catch (err) {
      console.error(err);
      if (alertBox) {
        alertBox.innerText = 'Error de conexión con el servidor.';
        alertBox.classList.remove('d-none');
      }
    }
  });
}

// Google Sign-In
window.addEventListener('load', () => {
  fetch('/api/auth/google-client-id')
    .then(r => r.json())
    .then(data => {
      if (!data.clientId || typeof google === 'undefined' || !google.accounts) return;
      google.accounts.id.initialize({
        client_id: data.clientId,
        callback: handleGoogleCredential,
      });
      const container = document.getElementById('googleBtnContainer');
      if (container) {
        google.accounts.id.renderButton(
          container,
          {
            theme: 'filled_blue',
            size: 'large',
            width: '100%',
            text: 'signin_with',
            shape: 'pill',
            logo_alignment: 'left'
          }
        );
      }
    })
    .catch(err => console.warn('Google Sign-In no disponible:', err));
});

async function handleGoogleCredential(response) {
  if (alertBox) alertBox.classList.add('d-none');
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('gpg_user', JSON.stringify(data.user));
      window.location.href = '/dashboard.html';
    } else {
      if (alertBox) {
        alertBox.innerText = data.error || 'Error al autenticar con Google';
        alertBox.classList.remove('d-none');
      }
    }
  } catch (err) {
    console.error(err);
    if (alertBox) {
      alertBox.innerText = 'Error de conexión con el servidor.';
      alertBox.classList.remove('d-none');
    }
  }
}
