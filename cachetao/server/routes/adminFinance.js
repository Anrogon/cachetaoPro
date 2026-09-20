const express = require("express");
const pool = require("../config/db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { cancelWithdrawal, completeWithdrawal } = require("../services/cashWalletService");

const router = express.Router();

router.get("/summary", requireAuth, requireAdmin, async (req, res) => {
  try {
    const summaryResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE type = 'deposit') AS total_deposits,
        COUNT(*) FILTER (WHERE type = 'deposit' AND status = 'approved') AS approved_deposits,
        COUNT(*) FILTER (WHERE type = 'deposit' AND status = 'pending') AS pending_deposits,
        COALESCE(SUM(amount_cents) FILTER (WHERE type = 'deposit' AND status = 'approved'), 0) AS approved_amount_cents,
        COALESCE(SUM(chips_amount) FILTER (WHERE type = 'deposit' AND status = 'approved'), 0) AS approved_chips
      FROM wallet_transactions
    `);

    const todayResult = await pool.query(`
      SELECT
        COALESCE(SUM(amount_cents), 0) AS today_amount_cents,
        COALESCE(SUM(chips_amount), 0) AS today_chips
      FROM wallet_transactions
      WHERE type = 'deposit'
        AND status = 'approved'
        AND created_at::date = CURRENT_DATE
    `);

    const totalRevenueResult = await pool.query(`
        SELECT
            COALESCE(SUM(amount_cents), 0) AS total_amount_cents
        FROM wallet_transactions
        WHERE type = 'deposit'
            AND status = 'approved'
    `);

    const recentResult = await pool.query(`
      SELECT
        wt.id,
        wt.user_id,
        u.username,
        u.email,
        wt.type,
        wt.status,
        wt.amount_cents,
        wt.chips_amount,
        wt.provider,
        wt.provider_payment_id,
        wt.created_at,
        wt.updated_at
      FROM wallet_transactions wt
      LEFT JOIN users u ON u.id = wt.user_id
      ORDER BY wt.created_at DESC
      LIMIT 50
    `);

    return res.json({
        ok: true,
        summary: summaryResult.rows[0],
        today: todayResult.rows[0],
        revenue: totalRevenueResult.rows[0],
        transactions: recentResult.rows,
    });
  } catch (err) {
    console.error("GET /admin/finance/summary error:", err);

    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar financeiro.",
    });
  }
});


// =========================================================
// LISTAR SOLICITAÇÕES DE SAQUE
// =========================================================

router.get(
  "/withdrawals",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            wr.id,
            wr.user_id,
            u.username,
            u.email,
            wr.amount,
            wr.pix_key_type,
            wr.pix_key,
            wr.status,
            wr.admin_note,
            wr.requested_at,
            wr.completed_at,
            wr.cancelled_at
          FROM withdrawal_requests wr
          LEFT JOIN users u
            ON u.id = wr.user_id
          ORDER BY
            CASE
              WHEN wr.status = 'PENDING' THEN 0
              ELSE 1
            END,
            wr.requested_at DESC
          LIMIT 100
        `
      );

      return res.json({
        ok: true,
        withdrawals: result.rows,
      });

    } catch (err) {
      console.error(
        "GET /admin/finance/withdrawals error:",
        err
      );

      return res.status(500).json({
        ok: false,
        message: "Erro ao carregar solicitações de saque.",
      });
    }
  }
);

// =========================================================
// CANCELAR SOLICITAÇÃO DE SAQUE
// =========================================================

router.post(
  "/withdrawals/:id/cancel",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const withdrawalId = Number(req.params.id);

      const adminNote = String(
        req.body?.adminNote || ""
      ).trim();

      const result = await cancelWithdrawal({
        withdrawalId,
        adminNote: adminNote || null,
      });

      return res.json({
        ok: true,
        withdrawal: result,
        message: "Saque cancelado com sucesso.",
      });

    } catch (err) {
      console.error(
        "POST /admin/finance/withdrawals/:id/cancel error:",
        err
      );

      const message =
        err?.message || "Erro ao cancelar saque.";

      if (
        message === "Solicitação de saque inválida." ||
        message === "Solicitação de saque não encontrada." ||
        message === "Solicitação de saque não está pendente." ||
        message === "Valor do saque inválido." ||
        message === "Usuário não encontrado." ||
        message === "Saldo bloqueado inconsistente." ||
        message === "Transação financeira do saque não encontrada."
      ) {
        return res.status(400).json({
          ok: false,
          message,
        });
      }

      return res.status(500).json({
        ok: false,
        message: "Erro ao cancelar saque.",
      });
    }
  }
);

// =========================================================
// CONFIRMAR PAGAMENTO DO SAQUE
// =========================================================

router.post(
  "/withdrawals/:id/complete",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const withdrawalId = Number(req.params.id);

      const adminNote = String(
        req.body?.adminNote || ""
      ).trim();

      const result = await completeWithdrawal({
        withdrawalId,
        adminNote: adminNote || null,
      });

      return res.json({
        ok: true,
        withdrawal: result,
        message: "Saque concluído com sucesso.",
      });

    } catch (err) {
      console.error(
        "POST /admin/finance/withdrawals/:id/complete error:",
        err
      );

      const message =
        err?.message || "Erro ao concluir saque.";

      if (
        message === "Solicitação de saque inválida." ||
        message === "Solicitação de saque não encontrada." ||
        message === "Solicitação de saque não está pendente." ||
        message === "Valor do saque inválido." ||
        message === "Usuário não encontrado." ||
        message === "Saldo bloqueado inconsistente." ||
        message === "Transação financeira do saque não encontrada."
      ) {
        return res.status(400).json({
          ok: false,
          message,
        });
      }

      return res.status(500).json({
        ok: false,
        message: "Erro ao concluir saque.",
      });
    }
  }
);


module.exports = router;