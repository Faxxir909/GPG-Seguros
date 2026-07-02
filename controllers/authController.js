const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'gpg_seguros_secret_key_12345';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function login(req, res) {
  const { usuario, password } = req.body;
  try {
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
    }

    const user = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    if (!user) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    // Generar token JWT
    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, rol: user.rol, nombre: user.nombre },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        usuario: user.usuario,
        rol: user.rol,
        nombre: user.nombre
      }
    });
  } catch (err) {
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

    // Buscar al usuario por su email de Google
    let user = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [email]);

    if (!user) {
      // Registrar automáticamente al usuario nuevo con el rol de productor
      const dummyPassword = bcrypt.hashSync(Math.random().toString(36), 10);
      const result = await db.run(
        'INSERT INTO usuarios (usuario, password, rol, nombre) VALUES (?, ?, ?, ?)',
        [email, dummyPassword, 'productor', nombre]
      );
      user = {
        id: result.id,
        usuario: email,
        rol: 'productor',
        nombre: nombre
      };
      console.log(`[Google Auth]: Nuevo usuario registrado automáticamente: ${email}`);
    }

    // Generar token JWT interno del CRM
    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, rol: user.rol, nombre: user.nombre },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
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

module.exports = {
  login,
  googleLogin
};
