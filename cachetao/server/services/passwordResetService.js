
const crypto = require("crypto");
const pool = require("../config/db");

const TOKEN_EXPIRATION_MINUTES = 30;

async function createPasswordResetToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      [userId]
    );

    await client.query(
      `INSERT INTO password_reset_tokens
         (user_id, token_hash, expires_at)
       VALUES
         ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [userId, tokenHash]
    );

    await client.query("COMMIT");

    return token;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resetPasswordWithToken(token, passwordHash) {
  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND expires_at > NOW()
       FOR UPDATE`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    const { user_id } = result.rows[0];

    await client.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [passwordHash, user_id]
    );

    await client.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      [user_id]
    );

    await client.query("COMMIT");

    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createPasswordResetToken,
  resetPasswordWithToken
};
