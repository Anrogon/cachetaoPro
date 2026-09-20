const express = require("express");
const pool = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { CHIP_PACKAGES, CASH_PACKAGES, getChipPackage, getCashPackage} = require("../config/chipPackages");
const { createPixPayment, getPaymentById } = require("../services/mercadoPago");
const { createWithdrawalRequest,} = require("../services/cashWalletService");



const router = express.Router();

router.get("/packages", requireAuth, async (req, res) => {
  const purpose = String(req.query?.purpose || "CHIPS").toUpperCase();

  if (purpose !== "CHIPS" && purpose !== "CASH") {
    return res.status(400).json({
      ok: false,
      message: "Finalidade inválida.",
    });
  }

  return res.json({
    ok: true,
    purpose,
    packages:
      purpose === "CASH"
        ? CASH_PACKAGES
        : CHIP_PACKAGES,
  });
});


router.post("/deposit", requireAuth, async (req, res) => {
  try {
    const packageId = String(req.body?.packageId || "");

    // Mantém compatibilidade com o frontend atual:
    // se purpose não vier, continua sendo compra de fichas.
    const purpose = String(req.body?.purpose || "CHIPS").toUpperCase();

    if (purpose !== "CHIPS" && purpose !== "CASH") {
      return res.status(400).json({
        ok: false,
        message: "Finalidade do pagamento inválida.",
      });
    }

    // =====================================================
    // DEFINE O PACOTE CONFORME A FINALIDADE
    // =====================================================

    let amountCents = 0;
    let chipsAmount = 0;
    let description = "";

    if (purpose === "CHIPS") {
      const pack = getChipPackage(packageId);

      if (!pack) {
        return res.status(400).json({
          ok: false,
          message: "Pacote de fichas inválido.",
        });
      }

      amountCents = Number(pack.priceCents) || 0;
      chipsAmount = Number(pack.chips) || 0;
      description = `Compra de ${chipsAmount} fichas`;
    }

    if (purpose === "CASH") {
      const pack = getCashPackage(packageId);

      if (!pack) {
        return res.status(400).json({
          ok: false,
          message: "Pacote de depósito inválido.",
        });
      }

      amountCents = Number(pack.amountCents) || 0;
      chipsAmount = 0;
      description = `Depósito de R$ ${(amountCents / 100)
        .toFixed(2)
        .replace(".", ",")}`;
    }

    // =====================================================
    // CRIA A TRANSAÇÃO LOCAL
    // =====================================================

    const txResult = await pool.query(
      `
      INSERT INTO wallet_transactions (
        user_id,
        type,
        purpose,
        status,
        amount_cents,
        chips_amount,
        provider
      )
      VALUES ($1, 'deposit', $2, 'pending', $3, $4, 'mercado_pago')
      RETURNING *
      `,
      [
        req.auth.userId,
        purpose,
        amountCents,
        chipsAmount
      ]
    );

    const transaction = txResult.rows[0];

    // =====================================================
    // GERA O PIX NO MERCADO PAGO
    // =====================================================

    const mpPayment = await createPixPayment({
      amountCents,
      description,
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

    // =====================================================
    // SALVA OS DADOS DO PIX
    // =====================================================

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

    // =====================================================
    // RESPOSTA
    // =====================================================

    return res.json({
      ok: true,
      transactionId: transaction.id,
      paymentId,
      purpose,
      qrCode,
      qrCodeBase64,
      amount: amountCents / 100,
      chips: chipsAmount,
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
  let dbClient = null;

  try {
    const transactionId = Number(req.params.transactionId);

    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Transação inválida.",
      });
    }

    // =====================================================
    // 1) LOCALIZA A TRANSAÇÃO DO USUÁRIO
    // =====================================================

    const txResult = await pool.query(
      `
      SELECT *
      FROM wallet_transactions
      WHERE id = $1
        AND user_id = $2
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

    const txPurpose = String(tx.purpose || "CHIPS").toUpperCase();

    // =====================================================
    // 2) SE JÁ FOI APROVADA, NÃO CREDITA NOVAMENTE
    // =====================================================

    if (tx.status === "approved") {
      return res.json({
        ok: true,
        status: "approved",
        credited: true,
        purpose: txPurpose,
        chips: txPurpose === "CHIPS"
          ? Number(tx.chips_amount) || 0
          : 0,
        amount: Number(tx.amount_cents || 0) / 100,
        message:
          txPurpose === "CASH"
            ? "Depósito já aprovado."
            : "Pagamento já aprovado.",
      });
    }

    if (!tx.provider_payment_id) {
      return res.status(400).json({
        ok: false,
        message: "Pagamento ainda não foi gerado.",
      });
    }

    // =====================================================
    // 3) CONSULTA O PAGAMENTO NO MERCADO PAGO
    // =====================================================

    const mpPayment = await getPaymentById(tx.provider_payment_id);
    const mpStatus = String(mpPayment?.status || "unknown");

    if (mpStatus !== "approved") {
      await pool.query(
        `
        UPDATE wallet_transactions
        SET status = $2,
            updated_at = NOW()
        WHERE id = $1
          AND status <> 'approved'
        `,
        [tx.id, mpStatus]
      );

      return res.json({
        ok: true,
        status: mpStatus,
        credited: false,
        purpose: txPurpose,
        message: "Pagamento ainda não aprovado.",
      });
    }

    // =====================================================
    // 4) PAGAMENTO APROVADO
    //
    // Daqui em diante tudo usa a MESMA conexão.
    // =====================================================

    dbClient = await pool.connect();

    await dbClient.query("BEGIN");

    const lockResult = await dbClient.query(
      `
      SELECT *
      FROM wallet_transactions
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [tx.id, req.auth.userId]
    );

    const lockedTx = lockResult.rows[0];

    if (!lockedTx) {
      await dbClient.query("ROLLBACK");

      return res.status(404).json({
        ok: false,
        message: "Transação não encontrada.",
      });
    }

    const purpose = String(
      lockedTx.purpose || "CHIPS"
    ).toUpperCase();

    // Outra requisição pode ter concluído a transação
    // enquanto esta aguardava o FOR UPDATE.
    if (lockedTx.status === "approved") {
      await dbClient.query("COMMIT");

      return res.json({
        ok: true,
        status: "approved",
        credited: true,
        purpose,
        chips:
          purpose === "CHIPS"
            ? Number(lockedTx.chips_amount) || 0
            : 0,
        amount: Number(lockedTx.amount_cents || 0) / 100,
        message:
          purpose === "CASH"
            ? "Depósito já aprovado."
            : "Pagamento já aprovado.",
      });
    }

    // Proteção adicional:
    // só aceitamos as duas finalidades conhecidas.
    if (purpose !== "CHIPS" && purpose !== "CASH") {
      await dbClient.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        message: "Finalidade da transação inválida.",
      });
    }

    // =====================================================
    // 5A) COMPRA DE FICHAS
    // =====================================================

    if (purpose === "CHIPS") {
      const chipsAmount = Number(lockedTx.chips_amount) || 0;

      if (chipsAmount <= 0) {
        await dbClient.query("ROLLBACK");

        return res.status(400).json({
          ok: false,
          message: "Quantidade de fichas inválida.",
        });
      }

      await dbClient.query(
        `
        UPDATE users
        SET chips_balance = COALESCE(chips_balance, 0) + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [
          chipsAmount,
          req.auth.userId
        ]
      );
    }

    // =====================================================
    // 5B) DEPÓSITO EM DINHEIRO
    // =====================================================

    if (purpose === "CASH") {
      const amountCents = Number(lockedTx.amount_cents) || 0;

      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        await dbClient.query("ROLLBACK");

        return res.status(400).json({
          ok: false,
          message: "Valor do depósito inválido.",
        });
      }

      const amount = amountCents / 100;

      const cashResult = await dbClient.query(
        `
        UPDATE users
        SET cash_balance = COALESCE(cash_balance, 0) + $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING
          cash_balance,
          cash_balance - $1 AS balance_before
        `,
        [
          amount,
          req.auth.userId
        ]
      );

      const cashRow = cashResult.rows[0];

      if (!cashRow) {
        await dbClient.query("ROLLBACK");

        return res.status(404).json({
          ok: false,
          message: "Usuário não encontrado.",
        });
      }

      const balanceBefore =
        Number(cashRow.balance_before) || 0;

      const balanceAfter =
        Number(cashRow.cash_balance) || 0;

      // ===================================================
      // REGISTRA O DEPÓSITO NO EXTRATO DA CARTEIRA
      // ===================================================

      await dbClient.query(
        `
        INSERT INTO cash_transactions (
          user_id,
          type,
          status,
          amount,
          balance_before,
          balance_after,
          reference_type,
          reference_id,
          provider,
          provider_transaction_id,
          description
        )
        VALUES (
          $1,
          'DEPOSIT',
          'COMPLETED',
          $2,
          $3,
          $4,
          'PIX',
          $5,
          'mercado_pago',
          $6,
          'Depósito via PIX'
        )
        `,
        [
          req.auth.userId,
          amount,
          balanceBefore,
          balanceAfter,
          String(lockedTx.id),
          String(lockedTx.provider_payment_id || "")
        ]
      );
    }

    // =====================================================
    // 6) MARCA A COBRANÇA PIX COMO APROVADA
    //
    // Isso acontece somente depois que o crédito e,
    // no caso CASH, o extrato foram gravados.
    // =====================================================

    await dbClient.query(
      `
      UPDATE wallet_transactions
      SET status = 'approved',
          updated_at = NOW()
      WHERE id = $1
      `,
      [lockedTx.id]
    );

    await dbClient.query("COMMIT");

    // =====================================================
    // 7) RESPOSTA
    // =====================================================

    if (purpose === "CASH") {
      return res.json({
        ok: true,
        status: "approved",
        credited: true,
        purpose: "CASH",
        amount: Number(lockedTx.amount_cents || 0) / 100,
        message: "Pagamento aprovado. Saldo creditado.",
      });
    }

    return res.json({
      ok: true,
      status: "approved",
      credited: true,
      purpose: "CHIPS",
      chips: Number(lockedTx.chips_amount) || 0,
      amount: Number(lockedTx.amount_cents || 0) / 100,
      message: "Pagamento aprovado. Fichas creditadas.",
    });

  } catch (err) {
    if (dbClient) {
      try {
        await dbClient.query("ROLLBACK");
      } catch (_) {}
    }

    console.error(
      "GET /wallet/deposit/:transactionId/status error:",
      err
    );

    return res.status(500).json({
      ok: false,
      message: "Erro ao consultar pagamento.",
    });

  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
});

// =========================================================
// SOLICITAR SAQUE
// =========================================================

router.post("/withdraw", requireAuth, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);

    const pixKeyType = String(
      req.body?.pixKeyType || ""
    ).trim();

    const pixKey = String(
      req.body?.pixKey || ""
    ).trim();

    const withdrawal = await createWithdrawalRequest({
      userId: req.auth.userId,
      amount,
      pixKeyType,
      pixKey,
    });

    return res.json({
      ok: true,
      withdrawal,
      message: "Solicitação de saque criada com sucesso.",
    });

  } catch (err) {
    console.error(
      "POST /wallet/withdraw error:",
      err
    );

    const message =
      err?.message || "Erro ao solicitar saque.";

    // Erros esperados de validação/regra da carteira.
    if (
      message === "Usuário inválido." ||
      message === "Usuário não encontrado." ||
      message === "Valor de saque inválido." ||
      message === "Tipo de chave PIX inválido." ||
      message === "Chave PIX inválida." ||
      message === "Saldo insuficiente."
    ) {
      return res.status(400).json({
        ok: false,
        message,
      });
    }

    return res.status(500).json({
      ok: false,
      message: "Erro ao solicitar saque.",
    });
  }
});

module.exports = router;