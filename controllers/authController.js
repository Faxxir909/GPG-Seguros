const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'gpg_seguros_secret_key_12345';

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

module.exports = {
  login
};
