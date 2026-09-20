const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3003/api"
    : "/api";

const financeMessage = document.getElementById("financeMessage");
const financeTableBody = document.getElementById("financeTableBody");
const withdrawalTableBody =  document.getElementById("withdrawalTableBody");

function moneyFromCents(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(value) {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return "-";
  }
}

function statusLabel(status) {
  const s = String(status || "").toLowerCase();

  if (s === "approved") return "Aprovado";
  if (s === "pending") return "Pendente";
  if (s === "rejected") return "Recusado";
  if (s === "cancelled" || s === "canceled") return "Cancelado";
  if (s === "completed") return "Concluído";

  return status || "-";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadFinance() {

      // =====================================================
    // SOLICITAÇÕES DE SAQUE
    // =====================================================

    const withdrawalRes = await fetch(
      `${API_BASE}/admin/finance/withdrawals`,
      {
        credentials: "include",
      }
    );

    const withdrawalData = await withdrawalRes.json();

    if (!withdrawalRes.ok || !withdrawalData.ok) {
      throw new Error(
        withdrawalData.message ||
        "Erro ao carregar solicitações de saque."
      );
    }

    const withdrawals = Array.isArray(withdrawalData.withdrawals)
      ? withdrawalData.withdrawals
      : [];

    if (withdrawalTableBody) {
      if (!withdrawals.length) {
        withdrawalTableBody.innerHTML = `
          <tr>
            <td colspan="8">
              Nenhuma solicitação de saque encontrada.
            </td>
          </tr>
        `;
      } else {
        withdrawalTableBody.innerHTML = withdrawals.map(w => `
          <tr>
            <td>${formatDate(w.requested_at)}</td>
            <td>${w.username || "-"}</td>
            <td>${w.email || "-"}</td>
            <td>
              ${Number(w.amount || 0).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL"
              })}
            </td>
            <td>${w.pix_key_type || "-"}</td>
            <td>${w.pix_key || "-"}</td>
            <td>${statusLabel(w.status)}</td>
            <td>
              ${
                String(w.status || "").toUpperCase() === "PENDING"
                  ? `
                    <button
                      type="button"
                      class="admin-btn admin-btn-primary"
                      onclick="completeWithdrawal(${Number(w.id)})"
                    >
                      Confirmar
                    </button>

                    <button
                      type="button"
                      class="admin-btn admin-btn-secondary"
                      onclick="cancelWithdrawal(${Number(w.id)})"
                    >
                      Cancelar
                    </button>
                  `
                  : "-"
              }
            </td>
          </tr>
        `).join("");
      }
    }

  if (financeMessage) {
    financeMessage.textContent = "Carregando financeiro...";
  }

  try {
    const res = await fetch(`${API_BASE}/admin/finance/summary`, {
      credentials: "include",
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Erro ao carregar financeiro.");
    }

    const summary = data.summary || {};
    const today = data.today || {};
    const revenue = data.revenue || {};

    const transactions = Array.isArray(data.transactions)
      ? data.transactions
      : [];

    setText("financeTodayAmount", moneyFromCents(today.today_amount_cents));
    setText("financeRevenueAmount", moneyFromCents(revenue.total_amount_cents));
    setText("financeTotalAmount", moneyFromCents(summary.approved_amount_cents));
    setText("financeTotalChips", Number(summary.approved_chips || 0).toLocaleString("pt-BR"));
    setText("financeApprovedCount", Number(summary.approved_deposits || 0).toLocaleString("pt-BR"));
    setText("financePendingCount", Number(summary.pending_deposits || 0).toLocaleString("pt-BR"));

    if (!transactions.length) {
      financeTableBody.innerHTML = `
        <tr>
          <td colspan="7">Nenhuma transação encontrada.</td>
        </tr>
      `;
    } else {
      financeTableBody.innerHTML = transactions.map(t => `
        <tr>
          <td>${formatDate(t.created_at)}</td>
          <td>${t.username || "-"}</td>
          <td>${t.email || "-"}</td>
          <td>${moneyFromCents(t.amount_cents)}</td>
          <td>${Number(t.chips_amount || 0).toLocaleString("pt-BR")}</td>
          <td>${statusLabel(t.status)}</td>
          <td>${t.provider_payment_id || "-"}</td>
        </tr>
      `).join("");
    }

    if (financeMessage) {
      financeMessage.textContent = "Financeiro carregado.";
    }
  } catch (err) {
    console.error("Erro admin financeiro:", err);

    if (financeMessage) {
      financeMessage.textContent = err.message;
    }

    if (financeTableBody) {
      financeTableBody.innerHTML = `
        <tr>
          <td colspan="7">Erro ao carregar transações.</td>
        </tr>
      `;
    }
  }
}


async function cancelWithdrawal(withdrawalId) {
  const id = Number(withdrawalId);

  if (!Number.isInteger(id) || id <= 0) {
    return;
  }

  const confirmed = window.confirm(
    `Confirma o cancelamento da solicitação de saque #${id}?`
  );

  if (!confirmed) {
    return;
  }

  try {
    if (financeMessage) {
      financeMessage.textContent = "Cancelando saque...";
    }

    const res = await fetch(
      `${API_BASE}/admin/finance/withdrawals/${id}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          adminNote: "Cancelado pelo administrador",
        }),
      }
    );

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(
        data.message || "Erro ao cancelar saque."
      );
    }

    if (financeMessage) {
      financeMessage.textContent =
        "Saque cancelado com sucesso.";
    }

    await loadFinance();

  } catch (err) {
    console.error("Erro ao cancelar saque:", err);

    if (financeMessage) {
      financeMessage.textContent =
        err.message || "Erro ao cancelar saque.";
    }
  }
}

async function completeWithdrawal(withdrawalId) {
  const id = Number(withdrawalId);

  if (!Number.isInteger(id) || id <= 0) {
    return;
  }

  const confirmed = window.confirm(
    `Confirma que o PIX do saque #${id} já foi realizado?`
  );

  if (!confirmed) {
    return;
  }

  try {
    if (financeMessage) {
      financeMessage.textContent =
        "Confirmando pagamento do saque...";
    }

    const res = await fetch(
      `${API_BASE}/admin/finance/withdrawals/${id}/complete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          adminNote: "PIX confirmado pelo administrador",
        }),
      }
    );

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(
        data.message || "Erro ao concluir saque."
      );
    }

    if (financeMessage) {
      financeMessage.textContent =
        "Saque concluído com sucesso.";
    }

    await loadFinance();

  } catch (err) {
    console.error("Erro ao concluir saque:", err);

    if (financeMessage) {
      financeMessage.textContent =
        err.message || "Erro ao concluir saque.";
    }
  }
}

window.cancelWithdrawal = cancelWithdrawal;
window.completeWithdrawal = completeWithdrawal;
window.loadFinance = loadFinance;

loadFinance();