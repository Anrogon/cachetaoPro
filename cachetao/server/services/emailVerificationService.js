"use strict";

const crypto = require("crypto");
const pool = require("../config/db");

// Validade do link de confirmação: 24 horas
const TOKEN_EXPIRATION_HOURS = 24;

// Gera um token seguro para enviar por e-mail.
// O banco armazena somente o hash, nunca o token original.
function generateVerificationToken() {
  const token = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  return { token, tokenHash };
}

// Cria um token de confirmação para o usuário.
// Invalida tokens anteriores do mesmo usuário.
async function createEmailVerificationToken(userId) {
  const { token, tokenHash } = generateVerificationToken();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM email_verification_tokens
       WHERE user_id = $1`,
      [userId]
    );

    await client.query(
      `INSERT INTO email_verification_tokens
         (user_id, token_hash, expires_at)
       VALUES
         ($1, $2, NOW() + INTERVAL '24 hours')`,
      [userId, tokenHash]
    );

    await client.query("COMMIT");

    return token;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Confirma o e-mail usando um token válido.
// A confirmação e o consumo do token são atômicos.
async function verifyEmailToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    return { success: false, reason: "invalid" };
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT user_id
       FROM email_verification_tokens
       WHERE token_hash = $1
         AND expires_at > NOW()
       FOR UPDATE`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return { success: false, reason: "invalid_or_expired" };
    }

    const userId = result.rows[0].user_id;

    await client.query(
      `UPDATE users
       SET email_verified = TRUE,
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    await client.query(
      `DELETE FROM email_verification_tokens
       WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    return { success: true, userId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createEmailVerificationToken,
  verifyEmailToken
};