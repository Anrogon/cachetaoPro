const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { CHIP_PACKAGES, getChipPackage } = require("../config/chipPackages");
const { createPixPayment, getPaymentById } = require("../services/mercadoPago");



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

    const txResult = await pool.query(
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
      RETURNING *
      `,
      [req.auth.userId, pack.priceCents, pack.chips]
    );

    const transaction = txResult.rows[0];

    const mpPayment = await createPixPayment({
      amountCents: pack.priceCents,
      description: `Compra de ${pack.chips} fichas`,
      payerEmail: req.auth.email || "cliente@pontinhoplay.com.br",
      externalReference: transaction.id,
    });

    const paymentId = mpPayment?.id || null;

    const qrCode =
      mpPayment?.point_of_interaction
        ?.transaction_data
        ?.qr_code || null;

    const qrCodeBase64 =
      mpPayment?.point_of_interaction
        ?.transaction_data
        ?.qr_code_base64 || null;

    await pool.query(
      `
      UPDATE wallet_transactions
      SET
        provider_payment_id = $1,
        pix_qr_code = $2,
        pix_qr_code_base64 = $3,
        updated_at = NOW()
      WHERE id = $4
      `,
      [
        String(paymentId || ""),
        qrCode,
        qrCodeBase64,
        transaction.id
      ]
    );

    return res.json({
      ok: true,
      transactionId: transaction.id,
      paymentId,
      qrCode,
      qrCodeBase64,
      amount: pack.priceCents / 100,
      chips: pack.chips,
    });

  } catch (err) {
    console.error("POST /wallet/deposit error:", err);

    return res.status(500).json({
      ok: false,
      message: "Erro ao gerar PIX.",
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

async function creditApprovedDepositByPaymentId(paymentId) {
  const paymentIdStr = String(paymentId || "");

  if (!paymentIdStr) {
    return { ok: false, message: "paymentId vazio." };
  }

  const mpPayment = await getPaymentById(paymentIdStr);
  const mpStatus = String(mpPayment?.status || "unknown");

  const txResult = await pool.query(
    `
    SELECT *
    FROM wallet_transactions
    WHERE provider_payment_id = $1
    LIMIT 1
    `,
    [paymentIdStr]
  );

  const tx = txResult.rows[0];

  if (!tx) {
    return {
      ok: false,
      status: mpStatus,
      message: "Transação não encontrada.",
    };
  }

  if (mpStatus !== "approved") {
    await pool.query(
      `
      UPDATE wallet_transactions
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1 AND status <> 'approved'
      `,
      [tx.id, mpStatus]
    );

    return {
      ok: true,
      status: mpStatus,
      credited: false,
      message: "Pagamento ainda não aprovado.",
    };
  }

  await pool.query("BEGIN");

  try {
    const lockResult = await pool.query(
      `
      SELECT *
      FROM wallet_transactions
      WHERE id = $1
      FOR UPDATE
      `,
      [tx.id]
    );

    const lockedTx = lockResult.rows[0];

    if (!lockedTx) {
      await pool.query("ROLLBACK");
      return { ok: false, message: "Transação não encontrada no lock." };
    }

    if (lockedTx.status === "approved") {
      await pool.query("COMMIT");
      return {
        ok: true,
        status: "approved",
        credited: false,
        message: "Transação já estava aprovada.",
      };
    }

    await pool.query(
      `
      UPDATE users
      SET chips_balance = COALESCE(chips_balance, 0) + $1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [lockedTx.chips_amount, lockedTx.user_id]
    );

    await pool.query(
      `
      UPDATE wallet_transactions
      SET status = 'approved',
          updated_at = NOW()
      WHERE id = $1
      `,
      [lockedTx.id]
    );

    await pool.query("COMMIT");

    return {
      ok: true,
      status: "approved",
      credited: true,
      chips: lockedTx.chips_amount,
      userId: lockedTx.user_id,
      message: "Pagamento aprovado e fichas creditadas.",
    };
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}


router.get("/deposit/:transactionId/status", requireAuth, async (req, res) => {
  try {
    const transactionId = Number(req.params.transactionId);

    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Transação inválida.",
      });
    }

    const txResult = await pool.query(
      `
      SELECT *
      FROM wallet_transactions
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [transactionId, req.auth.userId]
    );

    const tx = txResult.rows[0];

    if (!tx) {
      return res.status(404).json({
        ok: false,
        message: "Transação não encontrada.",
      });
    }

    if (tx.status === "approved") {
      return res.json({
        ok: true,
        status: "approved",
        credited: true,
        chips: tx.chips_amount,
        message: "Pagamento já aprovado.",
      });
    }

    if (!tx.provider_payment_id) {
      return res.status(400).json({
        ok: false,
        message: "Pagamento ainda não foi gerado.",
      });
    }

    const mpPayment = await getPaymentById(tx.provider_payment_id);
    const mpStatus = String(mpPayment?.status || "unknown");

    if (mpStatus !== "approved") {
      await pool.query(
        `
        UPDATE wallet_transactions
        SET status = $2, updated_at = NOW()
        WHERE id = $1 AND status <> 'approved'
        `,
        [tx.id, mpStatus]
      );

      return res.json({
        ok: true,
        status: mpStatus,
        credited: false,
        message: "Pagamento ainda não aprovado.",
      });
    }

    await pool.query("BEGIN");

    const lockResult = await pool.query(
      `
      SELECT *
      FROM wallet_transactions
      WHERE id = $1 AND user_id = $2
      FOR UPDATE
      `,
      [tx.id, req.auth.userId]
    );

    const lockedTx = lockResult.rows[0];

    if (!lockedTx) {
      await pool.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        message: "Transação não encontrada.",
      });
    }

    if (lockedTx.status === "approved") {
      await pool.query("COMMIT");
      return res.json({
        ok: true,
        status: "approved",
        credited: true,
        chips: lockedTx.chips_amount,
        message: "Pagamento já aprovado.",
      });
    }

    await pool.query(
      `
      UPDATE users
      SET chips_balance = COALESCE(chips_balance, 0) + $1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [lockedTx.chips_amount, req.auth.userId]
    );

    await pool.query(
      `
      UPDATE wallet_transactions
      SET status = 'approved',
          updated_at = NOW()
      WHERE id = $1
      `,
      [lockedTx.id]
    );

    await pool.query("COMMIT");

    return res.json({
      ok: true,
      status: "approved",
      credited: true,
      chips: lockedTx.chips_amount,
      message: "Pagamento aprovado. Fichas creditadas.",
    });

  } catch (err) {
    try {
      await pool.query("ROLLBACK");
    } catch {}

    console.error("GET /wallet/deposit/:transactionId/status error:", err);

    return res.status(500).json({
      ok: false,
      message: "Erro ao consultar pagamento.",
    });
  }
});



module.exports = router;