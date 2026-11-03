const bcrypt = require('bcryptjs');
const db = require('../db');

const VALID_ROLES = ['admin', 'productor', 'administrativo'];

/** Listar todos los usuarios del sistema (sin exponer el hash de password) */
async function getUsers(req, res, next) {
  try {
    const users = await db.all(`
      SELECT id, usuario, rol, nombre, activo, ultimo_acceso, creado_en, actualizado_en
      FROM usuarios
      ORDER BY id ASC
    `);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

/** Dar de alta un nuevo usuario (solo admin) */
async function createUser(req, res, next) {
  const { usuario, password, rol, nombre } = req.body || {};

  if (!usuario || !password || !rol || !nombre) {
    return res.status(400).json({ error: 'Usuario, contraseña, rol y nombre completo son obligatorios.' });
  }

  const cleanUser = String(usuario).trim();
  const cleanNombre = String(nombre).trim();
  const cleanRol = String(rol).trim().toLowerCase();

  if (cleanUser.length < 3) {
    return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (!VALID_ROLES.includes(cleanRol)) {
    return res.status(400).json({ error: `Rol inválido. Valores permitidos: ${VALID_ROLES.join(', ')}.` });
  }

  try {
    const existing = await db.get('SELECT id FROM usuarios WHERE LOWER(BTRIM(usuario)) = LOWER(BTRIM(?))', [cleanUser]);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe un usuario registrado con ese identificador o correo.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = await db.run(
      `INSERT INTO usuarios (usuario, password, rol, nombre, activo)
       VALUES (?, ?, ?, ?, TRUE)`,
      [cleanUser, passwordHash, cleanRol, cleanNombre]
    );

    res.status(201).json({
      id: result.id,
      message: 'Usuario creado exitosamente.'
    });
  } catch (err) {
    next(err);
  }
}

/** Actualizar datos, rol, estado o contraseña de un usuario (solo admin) */
async function updateUser(req, res, next) {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!targetId || targetId <= 0) {
    return res.status(400).json({ error: 'ID de usuario inválido.' });
  }

  const { usuario, nombre, rol, activo, password } = req.body || {};

  try {
    const current = await db.get('SELECT * FROM usuarios WHERE id = ?', [targetId]);
    if (!current) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const nextUsuario = usuario !== undefined ? String(usuario).trim() : current.usuario;
    const nextNombre = nombre !== undefined ? String(nombre).trim() : current.nombre;
    const nextRol = rol !== undefined ? String(rol).trim().toLowerCase() : current.rol;
    const nextActivo = activo !== undefined ? Boolean(activo) : Boolean(current.activo);

    if (!nextUsuario || nextUsuario.length < 3 || !nextNombre) {
      return res.status(400).json({ error: 'Usuario (mín. 3 caracteres) y nombre completo son obligatorios.' });
    }
    if (!VALID_ROLES.includes(nextRol)) {
      return res.status(400).json({ error: `Rol inválido. Valores permitidos: ${VALID_ROLES.join(', ')}.` });
    }

    // Protección: un administrador no puede desactivarse a sí mismo ni quitarse el rol admin
    if (req.user && Number(req.user.id) === targetId) {
      if (!nextActivo) {
        return res.status(400).json({ error: 'No puede desactivar su propia cuenta de administrador.' });
      }
      if (nextRol !== 'admin') {
        return res.status(400).json({ error: 'No puede quitarse el rol de administrador a sí mismo.' });
      }
    }

    // Protección: asegurar que siempre quede al menos un administrador activo
    if (current.rol === 'admin' && (nextRol !== 'admin' || !nextActivo)) {
      const activeAdmins = await db.get(
        "SELECT COUNT(*) AS count FROM usuarios WHERE rol = 'admin' AND activo = TRUE AND id <> ?",
        [targetId]
      );
      if (Number.parseInt(activeAdmins?.count || 0, 10) === 0) {
        return res.status(400).json({ error: 'El sistema debe contar con al menos un administrador activo.' });
      }
    }

    // Verificar duplicado de nombre de usuario si cambió
    if (nextUsuario.toLowerCase() !== current.usuario.toLowerCase()) {
      const dup = await db.get(
        'SELECT id FROM usuarios WHERE LOWER(BTRIM(usuario)) = LOWER(BTRIM(?)) AND id <> ?',
        [nextUsuario, targetId]
      );
      if (dup) {
        return res.status(409).json({ error: 'Ese nombre de usuario o correo ya está asignado a otra cuenta.' });
      }
    }

    if (password !== undefined && String(password).trim() !== '') {
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      }
      const passwordHash = await bcrypt.hash(String(password), 10);
      await db.run(
        `UPDATE usuarios
         SET usuario = ?, nombre = ?, rol = ?, activo = ?, password = ?
         WHERE id = ?`,
        [nextUsuario, nextNombre, nextRol, nextActivo, passwordHash, targetId]
      );
    } else {
      await db.run(
        `UPDATE usuarios
         SET usuario = ?, nombre = ?, rol = ?, activo = ?
         WHERE id = ?`,
        [nextUsuario, nextNombre, nextRol, nextActivo, targetId]
      );
    }

    res.json({ message: 'Usuario actualizado con éxito.' });
  } catch (err) {
    next(err);
  }
}

/** Desactivar (baja lógica) un usuario preservando trazabilidad de auditoría */
async function deleteUser(req, res, next) {
  const targetId = Number.parseInt(req.params.id, 10);
  if (!targetId || targetId <= 0) {
    return res.status(400).json({ error: 'ID de usuario inválido.' });
  }

  if (req.user && Number(req.user.id) === targetId) {
    return res.status(400).json({ error: 'No puede dar de baja su propia cuenta.' });
  }

  try {
    const current = await db.get('SELECT * FROM usuarios WHERE id = ?', [targetId]);
    if (!current) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    if (current.rol === 'admin' && current.activo) {
      const activeAdmins = await db.get(
        "SELECT COUNT(*) AS count FROM usuarios WHERE rol = 'admin' AND activo = TRUE AND id <> ?",
        [targetId]
      );
      if (Number.parseInt(activeAdmins?.count || 0, 10) === 0) {
        return res.status(400).json({ error: 'No se puede desactivar el único administrador activo.' });
      }
    }

    await db.run('UPDATE usuarios SET activo = FALSE WHERE id = ?', [targetId]);
    res.json({ message: 'Usuario desactivado correctamente.' });
  } catch (err) {
    next(err);
  }
}

/** Consultar bitácora de auditoría inmutable (auditoria_eventos) con paginación */
async function getAuditLogs(req, res, next) {
  const { page, limit, tabla, accion, search } = req.query || {};
  try {
    let sql = `
      SELECT a.id, a.tabla, a.registro_id, a.accion, a.campos_cambiados,
             a.usuario_id, u.usuario AS usuario_login, u.nombre AS usuario_nombre,
             a.request_id, a.creado_en
      FROM auditoria_eventos a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (tabla) {
      sql += ` AND a.tabla = ?`;
      params.push(tabla);
    }
    if (accion) {
      sql += ` AND a.accion = ?`;
      params.push(String(accion).toUpperCase());
    }
    if (search) {
      sql += ` AND (a.tabla ILIKE ? OR a.registro_id ILIKE ? OR u.nombre ILIKE ? OR u.usuario ILIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += ` ORDER BY a.id DESC`;

    const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const offset = (parsedPage - 1) * parsedLimit;

    const countSql = `SELECT COUNT(*) AS count FROM (${sql}) AS count_q`;
    const countRes = await db.get(countSql, params);
    const total = Number.parseInt(countRes?.count || 0, 10);

    sql += ` LIMIT ? OFFSET ?`;
    params.push(parsedLimit, offset);

    const logs = await db.all(sql, params);
    res.json({
      data: logs,
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit) || 1
    });
  } catch (err) {
    next(err);
  }
}

/** Ejecutar manualmente el job diario de estados (pólizas vencidas y cuotas en mora) */
async function runMaintenance(req, res, next) {
  try {
    const result = await db.runDailyMaintenance();
    res.json({
      message: 'Sincronización de estados completada.',
      ...result
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getAuditLogs,
  runMaintenance
};

