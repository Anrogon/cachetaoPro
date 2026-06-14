const jwt = require("jsonwebtoken");
const pool = require("../config/db");

async function requireAuth(req, res, next) {
  try {
    const token =
      req.cookies?.pontinho_token ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);

    if (!token) {
      return res.status(401).json({ ok: false, message: "Não autenticado." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `
      SELECT id, email, is_admin, is_blocked, session_version
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ ok: false, message: "Usuário não encontrado." });
    }

    if (user.is_blocked === true) {
      return res.status(403).json({ ok: false, message: "Conta bloqueada." });
    }

    const tokenSessionVersion = Number(decoded.sessionVersion || 1);
    const dbSessionVersion = Number(user.session_version || 1);

    if (tokenSessionVersion !== dbSessionVersion) {
      return res.status(401).json({ ok: false, message: "Sessão expirada." });
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      is_admin: user.is_admin === true || user.is_admin === 1,
      sessionVersion: dbSessionVersion,
    };

    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Sessão inválida." });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const result = await pool.query(
      `
      SELECT id, is_admin, is_blocked
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.auth?.userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ ok: false, message: "Usuário não encontrado." });
    }

    if (user.is_blocked === true) {
      return res.status(403).json({ ok: false, message: "Conta bloqueada." });
    }

    if (!(user.is_admin === true || user.is_admin === 1)) {
      return res.status(403).json({ ok: false, message: "Acesso negado. Somente administradores." });
    }

    next();
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Erro ao validar administrador." });
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
};