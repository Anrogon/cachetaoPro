const pool = require("../config/db");

async function findUserByEmail(email) {
  const sql = `
    SELECT
      id,
      username,
      email,
      password_hash,
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
    WHERE email = $1
    LIMIT 1
  `;
  const result = await pool.query(sql, [email]);
  return result.rows[0] || null;
}

async function findUserById(id) {
  const sql = `
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
    WHERE id = $1
    LIMIT 1
  `;
  const result = await pool.query(sql, [id]);
  return result.rows[0] || null;
}

async function logAdminAction({
  adminUserId,
  targetUserId = null,
  actionType,
  reason = null,
  details = null,
}) {
  const sql = `
    INSERT INTO admin_actions (
      admin_user_id,
      target_user_id,
      action_type,
      reason,
      details_json
    )
    VALUES ($1, $2, $3, $4, $5)
  `;

  await pool.query(sql, [
    adminUserId,
    targetUserId,
    actionType,
    reason,
    details ? JSON.stringify(details) : null,
  ]);
}

async function createUser({ username, email, passwordHash, avatarUrl = null }) {
  const sql = `
    INSERT INTO users (username, email, password_hash, avatar_url)
    VALUES ($1, $2, $3, $4)
    RETURNING id, username, email, chips_balance, avatar_url, created_at, updated_at
  `;
  const result = await pool.query(sql, [username, email, passwordHash, avatarUrl]);
  return result.rows[0];
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  logAdminAction,
};