const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'gpg_seguros_secret_key_12345';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Opciones de la cookie httpOnly (segura, no accesible desde JS)
const COOKIE_OPTIONS = {
  httpOnly: true,           // No accesible desde JavaScript del cliente → protege contra XSS
  sameSite: 'Lax',          // Protege contra CSRF en la mayoría de casos
  secure: process.env.NODE_ENV === 'production', // Solo HTTPS en producción
  maxAge: 24 * 60 * 60 * 1000 // 24 horas en ms
};

function issueToken(user) {
  return jwt.sign(
    { id: user.id, usuario: user.usuario, rol: user.rol, nombre: user.nombre },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

async function login(req, res) {
  const { usuario, password } = req.body;
  console.log('[Login Attempt]:', { usuario, passwordLength: password ? password.length : 0 });
  try {
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }

    const user = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    console.log('[Login DB User]:', user ? { id: user.id, usuario: user.usuario, hasPassword: !!user.password } : 'Not found');
    if (!user) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    console.log('[Login Bcrypt Match]:', isMatch);
    if (!isMatch) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = issueToken(user);

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
    const nombre = payload['name'] || email;

    let user = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [email]);

    if (!user) {
      const dummyPassword = bcrypt.hashSync(Math.random().toString(36), 10);
      const result = await db.run(
        'INSERT INTO usuarios (usuario, password, rol, nombre) VALUES (?, ?, ?, ?)',
        [email, dummyPassword, 'productor', nombre]
      );
      user = { id: result.id, usuario: email, rol: 'productor', nombre };
      console.log(`[Google Auth]: Nuevo usuario registrado: ${email}`);
    }

    const token = issueToken(user);

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
