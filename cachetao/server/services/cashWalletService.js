const pool = require("../config/db");

async function createWithdrawalRequest({
  userId,
  amount,
  pixKeyType,
  pixKey,
}) {
  const withdrawalAmount = Number(amount);

  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
    throw new Error("Usuário inválido.");
  }

  if (
    !Number.isFinite(withdrawalAmount) ||
    withdrawalAmount <= 0
  ) {
    throw new Error("Valor de saque inválido.");
  }

  const normalizedPixKeyType = String(
    pixKeyType || ""
  ).trim().toUpperCase();

  const normalizedPixKey = String(
    pixKey || ""
  ).trim();

  const allowedPixKeyTypes = [
    "CPF",
    "CNPJ",
    "EMAIL",
    "PHONE",
    "RANDOM",
  ];

  if (!allowedPixKeyTypes.includes(normalizedPixKeyType)) {
    throw new Error("Tipo de chave PIX inválido.");
  }

  if (!normalizedPixKey) {
    throw new Error("Chave PIX inválida.");
  }

  let dbClient = null;

  try {
    dbClient = await pool.connect();

    await dbClient.query("BEGIN");

    // =====================================================
    // BLOQUEIA O USUÁRIO DURANTE A OPERAÇÃO
    // =====================================================

    const userResult = await dbClient.query(
      `
        SELECT
          id,
          cash_balance,
          cash_blocked_balance
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw new Error("Usuário não encontrado.");
    }

    const user = userResult.rows[0];

    const balanceBefore =
      Number(user.cash_balance) || 0;

    const blockedBefore =
      Number(user.cash_blocked_balance) || 0;

    if (balanceBefore < withdrawalAmount) {
      throw new Error("Saldo insuficiente.");
    }

    // =====================================================
    // MOVE DISPONÍVEL -> BLOQUEADO
    // =====================================================

    const balanceAfter =
      balanceBefore - withdrawalAmount;

    const blockedAfter =
      blockedBefore + withdrawalAmount;

    await dbClient.query(
      `
        UPDATE users
        SET
          cash_balance = $1,
          cash_blocked_balance = $2,
          updated_at = NOW()
        WHERE id = $3
      `,
      [
        balanceAfter,
        blockedAfter,
        userId,
      ]
    );

    // =====================================================
    // CRIA SOLICITAÇÃO DE SAQUE
    // =====================================================

    const withdrawalResult = await dbClient.query(
      `
        INSERT INTO withdrawal_requests (
          user_id,
          amount,
          pix_key_type,
          pix_key,
          status
        )
        VALUES ($1, $2, $3, $4, 'PENDING')
        RETURNING
          id,
          user_id,
          amount,
          pix_key_type,
          pix_key,
          status,
          requested_at
      `,
      [
        userId,
        withdrawalAmount,
        normalizedPixKeyType,
        normalizedPixKey,
      ]
    );

    const withdrawal =
      withdrawalResult.rows[0];

    // =====================================================
    // REGISTRA NO LIVRO-CAIXA
    // =====================================================

    const cashTransactionResult =
      await dbClient.query(
        `
          INSERT INTO cash_transactions (
            user_id,
            type,
            status,
            amount,
            balance_before,
            balance_after,
            blocked_before,
            blocked_after,
            reference_type,
            reference_id,
            description
          )
          VALUES (
            $1,
            'WITHDRAWAL',
            'PENDING',
            $2,
            $3,
            $4,
            $5,
            $6,
            'WITHDRAWAL',
            $7,
            'Solicitação de saque via PIX'
          )
          RETURNING id
        `,
        [
          userId,
          -withdrawalAmount,
          balanceBefore,
          balanceAfter,
          blockedBefore,
          blockedAfter,
          String(withdrawal.id),
        ]
      );

    await dbClient.query("COMMIT");

    return {
      withdrawalId: withdrawal.id,
      transactionId:
        cashTransactionResult.rows[0].id,

      amount: Number(withdrawal.amount),

      pixKeyType: withdrawal.pix_key_type,
      pixKey: withdrawal.pix_key,

      status: withdrawal.status,

      balanceBefore,
      balanceAfter,
      blockedBefore,
      blockedAfter,

      requestedAt: withdrawal.requested_at,
    };

  } catch (err) {
    if (dbClient) {
      try {
        await dbClient.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error(
          "[CASH WALLET] Erro no rollback do saque:",
          rollbackErr
        );
      }
    }

    throw err;

  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
}


async function cancelWithdrawal({
  withdrawalId,
  adminNote = null,
}) {
  const id = Number(withdrawalId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Solicitação de saque inválida.");
  }

  const normalizedAdminNote = adminNote
    ? String(adminNote).trim()
    : null;

  let dbClient = null;

  try {
    dbClient = await pool.connect();

    await dbClient.query("BEGIN");

    // =====================================================
    // BLOQUEIA A SOLICITAÇÃO DE SAQUE
    // =====================================================

    const withdrawalResult = await dbClient.query(
      `
        SELECT
          id,
          user_id,
          amount,
          status
        FROM withdrawal_requests
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (withdrawalResult.rowCount === 0) {
      throw new Error("Solicitação de saque não encontrada.");
    }

    const withdrawal = withdrawalResult.rows[0];

    if (withdrawal.status !== "PENDING") {
      throw new Error("Solicitação de saque não está pendente.");
    }

    const userId = Number(withdrawal.user_id);
    const amount = Number(withdrawal.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Valor do saque inválido.");
    }

    // =====================================================
    // BLOQUEIA O SALDO DO USUÁRIO
    // =====================================================

    const userResult = await dbClient.query(
      `
        SELECT
          id,
          cash_balance,
          cash_blocked_balance
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw new Error("Usuário não encontrado.");
    }

    const user = userResult.rows[0];

    const balanceBefore =
      Number(user.cash_balance) || 0;

    const blockedBefore =
      Number(user.cash_blocked_balance) || 0;

    if (blockedBefore < amount) {
      throw new Error("Saldo bloqueado inconsistente.");
    }

    // =====================================================
    // DEVOLVE BLOQUEADO -> DISPONÍVEL
    // =====================================================

    const balanceAfter =
      balanceBefore + amount;

    const blockedAfter =
      blockedBefore - amount;

    await dbClient.query(
      `
        UPDATE users
        SET
          cash_balance = $1,
          cash_blocked_balance = $2,
          updated_at = NOW()
        WHERE id = $3
      `,
      [
        balanceAfter,
        blockedAfter,
        userId,
      ]
    );

    // =====================================================
    // CANCELA A SOLICITAÇÃO
    // =====================================================

    await dbClient.query(
      `
        UPDATE withdrawal_requests
        SET
          status = 'CANCELLED',
          admin_note = $1,
          cancelled_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
      `,
      [
        normalizedAdminNote,
        id,
      ]
    );

    // =====================================================
    // ATUALIZA A MESMA MOVIMENTAÇÃO DO LIVRO-CAIXA
    // =====================================================

    const transactionResult = await dbClient.query(
      `
        UPDATE cash_transactions
        SET
          status = 'CANCELLED',
          balance_after = $1,
          blocked_after = $2,
          description = 'Solicitação de saque via PIX cancelada',
          updated_at = NOW()
        WHERE
          reference_type = 'WITHDRAWAL'
          AND reference_id = $3
          AND type = 'WITHDRAWAL'
          AND status = 'PENDING'
        RETURNING id
      `,
      [
        balanceAfter,
        blockedAfter,
        String(id),
      ]
    );

    if (transactionResult.rowCount !== 1) {
      throw new Error(
        "Transação financeira do saque não encontrada."
      );
    }

    await dbClient.query("COMMIT");

    return {
      withdrawalId: id,
      transactionId: transactionResult.rows[0].id,
      userId,
      amount,
      status: "CANCELLED",
      balanceBefore,
      balanceAfter,
      blockedBefore,
      blockedAfter,
    };

  } catch (err) {
    if (dbClient) {
      try {
        await dbClient.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error(
          "[CASH WALLET] Erro no rollback do cancelamento:",
          rollbackErr
        );
      }
    }

    throw err;

  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
}


async function completeWithdrawal({
  withdrawalId,
  adminNote = null,
}) {
  const id = Number(withdrawalId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Solicitação de saque inválida.");
  }

  const normalizedAdminNote = adminNote
    ? String(adminNote).trim()
    : null;

  let dbClient = null;

  try {
    dbClient = await pool.connect();

    await dbClient.query("BEGIN");

    // =====================================================
    // BLOQUEIA A SOLICITAÇÃO DE SAQUE
    // =====================================================

    const withdrawalResult = await dbClient.query(
      `
        SELECT
          id,
          user_id,
          amount,
          status
        FROM withdrawal_requests
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (withdrawalResult.rowCount === 0) {
      throw new Error("Solicitação de saque não encontrada.");
    }

    const withdrawal = withdrawalResult.rows[0];

    if (withdrawal.status !== "PENDING") {
      throw new Error("Solicitação de saque não está pendente.");
    }

    const userId = Number(withdrawal.user_id);
    const amount = Number(withdrawal.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Valor do saque inválido.");
    }

    // =====================================================
    // BLOQUEIA O SALDO DO USUÁRIO
    // =====================================================

    const userResult = await dbClient.query(
      `
        SELECT
          id,
          cash_balance,
          cash_blocked_balance
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw new Error("Usuário não encontrado.");
    }

    const user = userResult.rows[0];

    const balanceBefore =
      Number(user.cash_balance) || 0;

    const blockedBefore =
      Number(user.cash_blocked_balance) || 0;

    if (blockedBefore < amount) {
      throw new Error("Saldo bloqueado inconsistente.");
    }

    // =====================================================
    // REMOVE O VALOR DO SALDO BLOQUEADO
    //
    // O cash_balance NÃO muda porque o valor já saiu
    // do disponível quando o saque foi solicitado.
    // =====================================================

    const balanceAfter = balanceBefore;
    const blockedAfter = blockedBefore - amount;

    await dbClient.query(
      `
        UPDATE users
        SET
          cash_blocked_balance = $1,
          updated_at = NOW()
        WHERE id = $2
      `,
      [
        blockedAfter,
        userId,
      ]
    );

    // =====================================================
    // CONCLUI A SOLICITAÇÃO DE SAQUE
    // =====================================================

    await dbClient.query(
      `
        UPDATE withdrawal_requests
        SET
          status = 'COMPLETED',
          admin_note = $1,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
      `,
      [
        normalizedAdminNote,
        id,
      ]
    );

    // =====================================================
    // CONCLUI A MESMA MOVIMENTAÇÃO DO LIVRO-CAIXA
    // =====================================================

    const transactionResult = await dbClient.query(
      `
        UPDATE cash_transactions
        SET
          status = 'COMPLETED',
          balance_after = $1,
          blocked_after = $2,
          description = 'Saque via PIX concluído',
          updated_at = NOW()
        WHERE
          reference_type = 'WITHDRAWAL'
          AND reference_id = $3
          AND type = 'WITHDRAWAL'
          AND status = 'PENDING'
        RETURNING id
      `,
      [
        balanceAfter,
        blockedAfter,
        String(id),
      ]
    );

    if (transactionResult.rowCount !== 1) {
      throw new Error(
        "Transação financeira do saque não encontrada."
      );
    }

    await dbClient.query("COMMIT");

    return {
      withdrawalId: id,
      transactionId: transactionResult.rows[0].id,
      userId,
      amount,
      status: "COMPLETED",
      balanceBefore,
      balanceAfter,
      blockedBefore,
      blockedAfter,
    };

  } catch (err) {
    if (dbClient) {
      try {
        await dbClient.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error(
          "[CASH WALLET] Erro no rollback da conclusão:",
          rollbackErr
        );
      }
    }

    throw err;

  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
}

module.exports = {
  createWithdrawalRequest,
  cancelWithdrawal,
  completeWithdrawal,
};
