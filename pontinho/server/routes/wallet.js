const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { CHIP_PACKAGES, getChipPackage } = require("../config/chipPackages");

const router = express.Router();

router.get("/packages", requireAuth, async (req, res) => {
  return res.json({
    ok: true,
    packages: CHIP_PACKAGES,
  });
});

router.post("/deposit", requireAuth, async (req, res) => {
  try {
    const packageId = String(req.body?.packageId || "");
    const pack = getChipPackage(packageId);

    if (!pack) {
      return res.status(400).json({
        ok: false,
        message: "Pacote inválido.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO wallet_transactions (
        user_id,
        type,
        status,
        amount_cents,
        chips_amount,
        provider
      )
      VALUES ($1, 'deposit', 'pending', $2, $3, 'mercado_pago')
      RETURNING id, type, status, amount_cents, chips_amount, created_at
      `,
      [req.auth.userId, pack.priceCents, pack.chips]
    );

    return res.json({
      ok: true,
      transaction: result.rows[0],
      message: "Depósito criado com sucesso.",
    });
  } catch (err) {
    console.error("POST /wallet/deposit error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao criar depósito.",
    });
  }
});

router.get("/history", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        type,
        status,
        amount_cents,
        chips_amount,
        provider,
        provider_payment_id,
        created_at,
        updated_at
      FROM wallet_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [req.auth.userId]
    );

    return res.json({
      ok: true,
      transactions: result.rows,
    });
  } catch (err) {
    console.error("GET /wallet/history error:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar histórico.",
    });
  }
});

module.exports = router;