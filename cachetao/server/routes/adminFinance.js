const express = require("express");
const pool = require("../config/db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

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

module.exports = router;