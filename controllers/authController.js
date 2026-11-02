const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { getJwtSecret, getSessionHours, getCookieOptions, getClearCookieOptions } = require('../config/security');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const SESSION_HOURS = getSessionHours();

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

    const cleanUser = String(usuario).trim();
    const user = await db.get('SELECT * FROM usuarios WHERE LOWER(usuario) = LOWER(?)', [cleanUser]);
    if (!user || user.activo === false) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const token = issueToken(user);
    await db.run('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [user.id]);

    // Enviar token en cookie httpOnly con opciones centralizadas y validadas
    res.cookie('gpg_token', token, getCookieOptions());

    res.json({
      user: {
        id: user.id,
        usuario: user.usuario,
        rol: user.rol,
        nombre: user.nombre
      }
    });
  } catch (err) {
    console.error('[Login Error]:', err.message);
    res.status(500).json({ error: 'Error interno del servidor al procesar la autenticación.' });
  }
}

async function googleLogin(req, res) {
  const { credential } = req.body;
  try {
    if (!credential) {
      return res.status(400).json({ error: 'Token de Google es requerido.' });
    }

    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: 'La autenticación con Google no está habilitada en este servidor.' });
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload['email'];

    const user = await db.get('SELECT * FROM usuarios WHERE LOWER(usuario) = LOWER(?)', [email]);

    if (!user || user.activo === false) {
      return res.status(403).json({
        error: 'Acceso no autorizado. Su cuenta de Google no se encuentra dada de alta en el sistema. Solicite acceso al administrador.'
      });
    }

    const token = issueToken(user);
    await db.run('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [user.id]);

    res.cookie('gpg_token', token, getCookieOptions());

    res.json({
      user: {
        id: user.id,
        usuario: user.usuario,
        rol: user.rol,
        nombre: user.nombre
      }
    });
  } catch (err) {
    console.error('[Google Auth Error]:', err.message);
    res.status(400).json({ error: 'Autenticación con Google fallida. Verifique sus credenciales.' });
  }
}

function logout(req, res) {
  // Borrar la cookie httpOnly con exactamente los mismos atributos relevantes
  res.clearCookie('gpg_token', getClearCookieOptions());
  res.json({ message: 'Sesión cerrada correctamente.' });
}

async function me(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  try {
    const user = await db.get('SELECT id, usuario, rol, nombre, activo FROM usuarios WHERE id = ?', [req.user.id]);
    if (!user || user.activo === false) {
      res.clearCookie('gpg_token', getClearCookieOptions());
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
    }
    res.json({
      user: {
        id: user.id,
        usuario: user.usuario,
        rol: user.rol,
        nombre: user.nombre
      }
    });
  } catch (err) {
    console.error('[Auth Me Error]:', err.message);
    res.status(500).json({ error: 'Error al verificar sesión.' });
  }
}

module.exports = { login, googleLogin, logout, me };
