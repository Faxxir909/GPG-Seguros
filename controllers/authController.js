const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { getJwtSecret, getSessionHours } = require('../config/security');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const SESSION_HOURS = getSessionHours();

// Opciones de la cookie httpOnly (segura, no accesible desde JS)
const COOKIE_OPTIONS = {
  httpOnly: true,           // No accesible desde JavaScript del cliente → protege contra XSS
  sameSite: 'Lax',          // Protege contra CSRF en la mayoría de casos
  secure: process.env.NODE_ENV === 'production', // Solo HTTPS en producción
  maxAge: SESSION_HOURS * 60 * 60 * 1000
};

function issueToken(user) {
  return jwt.sign(
    { id: user.id, usuario: user.usuario, rol: user.rol, nombre: user.nombre },
    getJwtSecret(),
    {
      expiresIn: `${SESSION_HOURS}h`,
      algorithm: 'HS256',
      issuer: 'gpg-seguros',
      audience: 'gpg-seguros-crm'
    }
  );
}

async function login(req, res) {
  const { usuario, password } = req.body;
  try {
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }

    const user = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    if (!user || user.activo === false) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = issueToken(user);
    await db.run('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [user.id]);

    // Enviar token en cookie httpOnly (no en el body → protege contra XSS)
    res.cookie('gpg_token', token, COOKIE_OPTIONS);

    res.json({
      user: {
        id: user.id,
        usuario: user.usuario,
        rol: user.rol,
        nombre: user.nombre
      }
    });
  } catch (err) {
    console.error('[Login Error]:', err);
    res.status(500).json({ error: 'Error del servidor: ' + err.message });
  }
}

async function googleLogin(req, res) {
  const { credential } = req.body;
  try {
    if (!credential) {
      return res.status(400).json({ error: 'Token de Google es requerido.' });
    }

    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: 'La variable de entorno GOOGLE_CLIENT_ID no está configurada en el servidor.' });
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload['email'];

    const user = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [email]);

    if (!user || user.activo === false) {
      console.warn(`[Google Auth Warning]: Intento de inicio de sesión con cuenta de Google no autorizada: ${email}`);
      return res.status(403).json({
        error: 'Acceso no autorizado. Su cuenta de Google (' + email + ') no se encuentra dada de alta en el sistema. Solicite acceso al administrador.'
      });
    }

    const token = issueToken(user);
    await db.run('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [user.id]);

    res.cookie('gpg_token', token, COOKIE_OPTIONS);

    res.json({
      user: {
        id: user.id,
        usuario: user.usuario,
        rol: user.rol,
        nombre: user.nombre
      }
    });
  } catch (err) {
    console.error('[Google Auth Error]:', err);
    res.status(400).json({ error: 'Autenticación con Google fallida: ' + err.message });
  }
}

function logout(req, res) {
  // Borrar la cookie httpOnly
  res.clearCookie('gpg_token', { httpOnly: true, sameSite: 'Lax' });
  res.json({ message: 'Sesión cerrada correctamente.' });
}

module.exports = { login, googleLogin, logout };
