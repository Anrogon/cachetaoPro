const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { findUserByEmail, findUserById, createUser, logAdminAction } = require("../services/userService");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const router = express.Router();


function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    chipsBalance: Number(user.chips_balance) || 0,
    avatarUrl: user.avatar_url || null,
    is_admin: !!user.is_admin,
    is_blocked: !!user.is_blocked,
    blocked_reason: user.blocked_reason || null,
    must_reset_password: !!user.must_reset_password,
    session_version: Number(user.session_version) || 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

router.post("/signup", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const avatarUrl = String(req.body?.avatarUrl || "").trim() || null;

    if (!username || username.length < 3) {
      return res.status(400).json({
        ok: false,
        message: "Nome de usuário deve ter pelo menos 3 caracteres.",
      });
    }

    if (!email || !email.includes("@")) {
      return res.status(400).json({
        ok: false,
        message: "E-mail inválido.",
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        ok: false,
        message: "A senha deve ter pelo menos 6 caracteres.",
      });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "Já existe uma conta com este e-mail.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await createUser({
      username,
      email,
      passwordHash,
      avatarUrl,
    });

    return res.status(201).json({
      ok: true,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("POST /signup error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno ao criar conta.",
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        message: "Informe e-mail e senha.",
      });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "E-mail ou senha inválidos.",
      });
    }

    const okPassword = await bcrypt.compare(password, user.password_hash);
    if (!okPassword) {
      return res.status(401).json({
        ok: false,
        message: "E-mail ou senha inválidos.",
      });
    }

    if (user.is_blocked === true || user.is_blocked === 1) {
    return res.status(403).json({
    ok: false,
    message: user.blocked_reason
      ? `Conta bloqueada. Motivo: ${user.blocked_reason}`
      : "Conta bloqueada.",
    });
    }



    const token = jwt.sign(
  {
    userId: user.id,
    email: user.email,
    sessionVersion: Number(user.session_version || 1),
  },
  process.env.JWT_SECRET,
  { expiresIn: "7d" }
  );

    res.cookie("pontinho_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      ok: true,
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("POST /login error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno ao fazer login.",
    });
  }
});

router.post("/logout", async (req, res) => {
  res.clearCookie("pontinho_token");
  return res.json({ ok: true });
});

router.patch("/settings", requireAuth, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const avatarUrl = String(req.body?.avatarUrl || "").trim() || null;
    const newPassword = String(req.body?.newPassword || "");

    if (!username || username.length < 3) {
      return res.status(400).json({
        ok: false,
        message: "Nome de usuário deve ter pelo menos 3 caracteres.",
      });
    }

    let passwordHashSql = "";
    const params = [username, avatarUrl, req.auth.userId];

    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({
          ok: false,
          message: "A nova senha deve ter pelo menos 6 caracteres.",
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      params.splice(2, 0, passwordHash);
      passwordHashSql = ", password_hash = $3";
    }

    const sql = newPassword
      ? `
        UPDATE users
        SET username = $1,
            avatar_url = $2,
            password_hash = $3,
            updated_at = NOW()
        WHERE id = $4
        RETURNING id, username, email, chips_balance, avatar_url, created_at, updated_at
      `
      : `
        UPDATE users
        SET username = $1,
            avatar_url = $2,
            updated_at = NOW()
        WHERE id = $3
        RETURNING id, username, email, chips_balance, avatar_url, created_at, updated_at
      `;

    const result = await require("../config/db").query(sql, params);
    const user = result.rows[0];

    return res.json({
      ok: true,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("PATCH /settings error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno ao salvar configurações.",
    });
  }
});




router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.auth.userId);

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado.",
      });
    }

    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        chipsBalance: user.chips_balance ?? user.chipsBalance ?? 0,
        avatarUrl: user.avatar_url ?? user.avatarUrl ?? null,
        is_admin: user.is_admin === true || user.is_admin === 1,
        createdAt: user.created_at ?? user.createdAt ?? null,
        updatedAt: user.updated_at ?? user.updatedAt ?? null,
      },
    });
  } catch (err) {
    console.error("GET /me error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno ao buscar usuário.",
    });
  }
});


router.get("/me/stats", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        matches_played,
        wins,
        losses,
        total_profit,
        total_loss,
        updated_at
      FROM user_stats
      WHERE user_id = $1
      LIMIT 1
      `,
      [req.auth.userId]
    );

    const stats = result.rows[0] || {
      matches_played: 0,
      wins: 0,
      losses: 0,
      total_profit: 0,
      total_loss: 0,
      updated_at: null,
    };

    return res.json({
      ok: true,
      stats: {
        matchesPlayed: Number(stats.matches_played) || 0,
        wins: Number(stats.wins) || 0,
        losses: Number(stats.losses) || 0,
        totalProfit: Number(stats.total_profit) || 0,
        totalLoss: Number(stats.total_loss) || 0,
        updatedAt: stats.updated_at || null,
      },
    });
  } catch (err) {
    console.error("GET /me/stats error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar estatísticas do perfil.",
    });
  }
});



router.post("/me/avatar", requireAuth, async (req, res) => {
  try {
    const avatarUrl = String(req.body?.avatarUrl || "").trim();

    if (!avatarUrl) {
      return res.status(400).json({
        ok: false,
        message: "Informe um avatar válido.",
      });
    }

    const isValidAvatar =
      /^\/assets\/avatars\/[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(avatarUrl);

    if (!isValidAvatar) {
      return res.status(400).json({
        ok: false,
        message: "Avatar inválido.",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        avatar_url = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        username,
        email,
        chips_balance,
        avatar_url,
        is_admin,
        is_blocked,
        blocked_reason,
        must_reset_password,
        session_version,
        created_at,
        updated_at
      `,
      [req.auth.userId, avatarUrl]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado.",
      });
    }

    return res.json({
      ok: true,
      message: "Avatar atualizado com sucesso.",
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("POST /me/avatar error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao atualizar avatar.",
    });
  }
});

/*
router.post("/change-password-required", requireAuth, async (req, res) => {
  try {
    const currentUser = await findUserById(req.auth.userId);

    if (!currentUser) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado.",
      });
    }

    const newPassword = String(req.body?.newPassword || "").trim();
    const confirmPassword = String(req.body?.confirmPassword || "").trim();

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        ok: false,
        message: "A nova senha deve ter pelo menos 4 caracteres.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: "A confirmação de senha não confere.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET
        password_hash = $2,
        must_reset_password = false,
        session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [currentUser.id, passwordHash]
    );

    return res.json({
      ok: true,
      message: "Senha alterada com sucesso. Faça login novamente.",
    });
  } catch (err) {
    console.error("POST /change-password-required error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao alterar senha.",
    });
  }
});
*/

router.post("/me/change-password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "").trim();
    const confirmPassword = String(req.body?.confirmPassword || "").trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: "Preencha a senha atual, a nova senha e a confirmação.",
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        ok: false,
        message: "A nova senha deve ter pelo menos 4 caracteres.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: "A confirmação da nova senha não confere.",
      });
    }

    const resultUser = await pool.query(
      `
      SELECT id, email, password_hash
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.auth.userId]
    );

    const user = resultUser.rows[0];

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado.",
      });
    }

    const okPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!okPassword) {
      return res.status(401).json({
        ok: false,
        message: "Senha atual incorreta.",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET
        password_hash = $2,
        must_reset_password = false,
        session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [req.auth.userId, newPasswordHash]
    );

    return res.json({
      ok: true,
      message: "Senha alterada com sucesso. Faça login novamente.",
    });
  } catch (err) {
    console.error("POST /me/change-password error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao alterar senha.",
    });
  }
});

router.post("/change-password-required", requireAuth, async (req, res) => {
  try {
    const newPassword = String(req.body?.newPassword || "").trim();
    const confirmPassword = String(req.body?.confirmPassword || "").trim();

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: "Preencha a nova senha e a confirmação.",
      });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({
        ok: false,
        message: "A nova senha deve ter pelo menos 4 caracteres.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: "A confirmação da nova senha não confere.",
      });
    }

    const resultUser = await pool.query(
      `
      SELECT id, must_reset_password
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.auth.userId]
    );

    const user = resultUser.rows[0];

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuário não encontrado.",
      });
    }

    if (user.must_reset_password !== true) {
      return res.status(403).json({
        ok: false,
        message: "Troca obrigatória de senha não está ativa para este usuário.",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET
        password_hash = $2,
        must_reset_password = false,
        session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [req.auth.userId, newPasswordHash]
    );

    return res.json({
      ok: true,
      message: "Senha alterada com sucesso. Faça login novamente.",
    });
  } catch (err) {
    console.error("POST /change-password-required error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao alterar senha.",
    });
  }
});

router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await require("../config/db").query(`
      SELECT
        id,
        username,
        email,
        chips_balance,
        avatar_url,
        is_admin,
        is_blocked,
        blocked_reason,
        must_reset_password,
        session_version,
        created_at,
        updated_at
      FROM users
      ORDER BY id DESC
    `);

    const users = result.rows.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      chipsBalance: u.chips_balance,
      avatarUrl: u.avatar_url,
      is_admin: u.is_admin === true || u.is_admin === 1,
      is_blocked: u.is_blocked === true || u.is_blocked === 1,
      blocked_reason: u.blocked_reason || null,
      must_reset_password: u.must_reset_password === true || u.must_reset_password === 1,
      session_version: Number(u.session_version) || 1,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    }));

    return res.json({
      ok: true,
      users,
    });
  } catch (err) {
    console.error("GET /admin/users error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao listar usuários.",
    });
  }
});


router.get("/admin/dashboard/stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    const usersCountResult = await pool.query(`
      SELECT COUNT(*)::int AS total_users
      FROM users
    `);

    const adminsCountResult = await pool.query(`
      SELECT COUNT(*)::int AS total_admins
      FROM users
      WHERE is_admin = true
    `);

    const blockedCountResult = await pool.query(`
      SELECT COUNT(*)::int AS total_blocked
      FROM users
      WHERE is_blocked = true
    `);

    const activeCountResult = await pool.query(`
      SELECT COUNT(*)::int AS total_active
      FROM users
      WHERE COALESCE(is_blocked, false) = false
    `);

    const recentActionsResult = await pool.query(`
      SELECT
        aa.id,
        aa.admin_user_id,
        aa.target_user_id,
        aa.action_type,
        aa.reason,
        aa.details_json,
        aa.created_at,
        admin_user.username AS admin_username,
        target_user.username AS target_username
      FROM admin_actions aa
      LEFT JOIN users admin_user ON admin_user.id = aa.admin_user_id
      LEFT JOIN users target_user ON target_user.id = aa.target_user_id
      ORDER BY aa.id DESC
      LIMIT 10
    `);

    return res.json({
      ok: true,
      stats: {
        totalUsers: usersCountResult.rows[0]?.total_users || 0,
        totalAdmins: adminsCountResult.rows[0]?.total_admins || 0,
        totalBlocked: blockedCountResult.rows[0]?.total_blocked || 0,
        totalActive: activeCountResult.rows[0]?.total_active || 0,
      },
      recentActions: recentActionsResult.rows.map((row) => ({
        id: row.id,
        adminUserId: row.admin_user_id,
        adminUsername: row.admin_username || `#${row.admin_user_id}`,
        targetUserId: row.target_user_id,
        targetUsername: row.target_username || (row.target_user_id ? `#${row.target_user_id}` : "—"),
        actionType: row.action_type,
        reason: row.reason || null,
        details: row.details_json || null,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error("GET /admin/dashboard/stats error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar dashboard admin.",
    });
  }
});



router.post("/admin/users/:id/block", requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    const reason = String(req.body?.reason || "").trim();

    if (!targetUserId) {
      return res.status(400).json({
        ok: false,
        message: "ID do usuário inválido.",
      });
    }

    if (targetUserId === req.auth.userId) {
      return res.status(400).json({
        ok: false,
        message: "Você não pode bloquear a si mesmo.",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        is_blocked = true,
        blocked_reason = $2,
        session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [targetUserId, reason || "Bloqueado pela administração."]
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({
        ok: false,
        message: "Usuário alvo não encontrado.",
      });
    }

    await logAdminAction({
      adminUserId: req.auth.userId,
      targetUserId,
      actionType: "block_user",
      reason: reason || "Bloqueado pela administração.",
      details: {
        blocked: true,
      },
    });

    return res.json({
      ok: true,
      message: "Usuário bloqueado com sucesso.",
    });
  } catch (err) {
    console.error("POST /admin/users/:id/block error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao bloquear usuário.",
    });
  }
});


router.post("/admin/users/:id/unblock", requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);

    if (!targetUserId) {
      return res.status(400).json({
        ok: false,
        message: "ID do usuário inválido.",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        is_blocked = false,
        blocked_reason = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [targetUserId]
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({
        ok: false,
        message: "Usuário alvo não encontrado.",
      });
    }

    await logAdminAction({
      adminUserId: req.auth.userId,
      targetUserId,
      actionType: "unblock_user",
      reason: "Desbloqueado pela administração.",
      details: {
        blocked: false,
      },
    });

    return res.json({
      ok: true,
      message: "Usuário desbloqueado com sucesso.",
    });
  } catch (err) {
    console.error("POST /admin/users/:id/unblock error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao desbloquear usuário.",
    });
  }
});




router.post("/admin/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    const newPassword = String(req.body?.newPassword || "").trim();

    if (!targetUserId) {
      return res.status(400).json({
        ok: false,
        message: "ID do usuário inválido.",
      });
    }

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        ok: false,
        message: "Informe uma nova senha com pelo menos 4 caracteres.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET
        password_hash = $2,
        must_reset_password = true,
        session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [targetUserId, passwordHash]
    );

    router.post("/admin/users/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    const newPassword = String(req.body?.newPassword || "").trim();

    if (!targetUserId) {
      return res.status(400).json({
        ok: false,
        message: "ID do usuário inválido.",
      });
    }

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        ok: false,
        message: "Informe uma nova senha com pelo menos 4 caracteres.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      `
      UPDATE users
      SET
        password_hash = $2,
        must_reset_password = true,
        session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [targetUserId, passwordHash]
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({
        ok: false,
        message: "Usuário alvo não encontrado.",
      });
    }

    await logAdminAction({
      adminUserId: req.auth.userId,
      targetUserId,
      actionType: "reset_password",
      reason: "Senha temporária definida pela administração.",
      details: {
        must_reset_password: true,
      },
    });

    return res.json({
      ok: true,
      message: "Senha temporária definida. O usuário deverá trocá-la no próximo login.",
    });
  } catch (err) {
    console.error("POST /admin/users/:id/reset-password error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao redefinir senha.",
    });
  }
  });

  } catch (err) {
    console.error("POST /admin/users/:id/reset-password error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao redefinir senha.",
    });
  }
});



router.post("/admin/users/:id/end-sessions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);

    if (!targetUserId) {
      return res.status(400).json({
        ok: false,
        message: "ID do usuário inválido.",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
      WHERE id = $1
      `,
      [targetUserId]
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({
        ok: false,
        message: "Usuário alvo não encontrado.",
      });
    }

    await logAdminAction({
      adminUserId: req.auth.userId,
      targetUserId,
      actionType: "end_sessions",
      reason: "Sessões encerradas pela administração.",
      details: {
        ended_sessions: true,
      },
    });

    return res.json({
      ok: true,
      message: "Sessões encerradas com sucesso.",
    });
  } catch (err) {
    console.error("POST /admin/users/:id/end-sessions error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao encerrar sessões.",
    });
  }
});

module.exports = router;