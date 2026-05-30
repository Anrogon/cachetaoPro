const financeMessage = document.getElementById("financeMessage");
const financeTableBody = document.getElementById("financeTableBody");

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

  return status || "-";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadFinance() {
  if (financeMessage) {
    financeMessage.textContent = "Carregando financeiro...";
  }

  try {
    const res = await fetch("/api/admin/finance/summary", {
      credentials: "include",
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Erro ao carregar financeiro.");
    }

    const summary = data.summary || {};
    const transactions = Array.isArray(data.transactions)
      ? data.transactions
      : [];

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

window.loadFinance = loadFinance;
loadFinance();