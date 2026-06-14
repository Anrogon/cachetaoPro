const API_BASE = "/api";

function setMsg(text, isError = false) {
  const el = document.getElementById("adminDashboardMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value ?? 0);
}

function clearAuthUser() {
  localStorage.removeItem("pontinhoAuthUser");
  localStorage.removeItem("pontinhoPlayerName");
  localStorage.removeItem("pontinhoAvatarUrl");
}

function logoutWithMessage(message) {
  clearAuthUser();
  if (message) {
    alert(message);
  }
  window.location.href = "./login.html";
}

function goToAdminHome() {
  window.location.href = "./admin-home.html";
}

function goToAdminUsers() {
  window.location.href = "./admin-users.html";
}

function formatDate(value) {
  if (!value) return "—";

  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";

  return dt.toLocaleString("pt-BR");
}

function prettifyActionType(actionType) {
  switch (actionType) {
    case "block_user":
      return "Bloqueio de usuário";
    case "unblock_user":
      return "Desbloqueio de usuário";
    case "reset_password":
      return "Reset de senha";
    case "end_sessions":
      return "Encerramento de sessões";
    default:
      return actionType || "Ação";
  }
}

function renderRecentActions(actions) {
  const list = document.getElementById("recentActionsList");
  if (!list) return;

  if (!Array.isArray(actions) || actions.length === 0) {
    list.innerHTML = `<div class="empty-box">Nenhuma ação administrativa registrada ainda.</div>`;
    return;
  }

  list.innerHTML = actions.map((action) => {
    return `
      <div class="action-item">
        <div class="action-main">
          ${prettifyActionType(action.actionType)}
        </div>
        <div class="action-sub">
          Admin: <strong>${action.adminUsername || "—"}</strong>
          • Alvo: <strong>${action.targetUsername || "—"}</strong>
          • Data: <strong>${formatDate(action.createdAt)}</strong>
        </div>
        <div class="action-sub">
          Motivo: ${action.reason || "—"}
        </div>
      </div>
    `;
  }).join("");
}

async function loadDashboard() {
  setMsg("Carregando dashboard...");

  try {
    const res = await fetch(`${API_BASE}/auth/admin/dashboard/stats`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      setMsg("Sessão inválida. Faça login novamente.", true);
      setTimeout(() => logoutWithMessage("Sua sessão expirou. Faça login novamente."), 900);
      return;
    }

    if (res.status === 403) {
      setMsg(data?.message || "Acesso negado.", true);
      setTimeout(() => logoutWithMessage(data?.message || "Seu acesso foi bloqueado."), 900);
      return;
    }

    if (!res.ok || !data?.ok) {
      setMsg(data?.message || "Não foi possível carregar o dashboard.", true);
      renderRecentActions([]);
      return;
    }

    setText("statTotalUsers", data.stats?.totalUsers || 0);
    setText("statTotalAdmins", data.stats?.totalAdmins || 0);
    setText("statTotalBlocked", data.stats?.totalBlocked || 0);
    setText("statTotalActive", data.stats?.totalActive || 0);

    renderRecentActions(data.recentActions || []);
    setMsg("Dashboard carregado com sucesso.");
  } catch (err) {
    console.error("Erro ao carregar dashboard:", err);
    setMsg(`Erro ao carregar dashboard. (${err.message})`, true);
    renderRecentActions([]);
  }
}

function bindEvents() {
  document.getElementById("btnReloadDashboard")?.addEventListener("click", loadDashboard);
  document.getElementById("btnGoUsers")?.addEventListener("click", goToAdminUsers);
  document.getElementById("btnBackHomeTop")?.addEventListener("click", goToAdminHome);
  document.getElementById("btnBackHome")?.addEventListener("click", goToAdminHome);

  document.getElementById("btnLogout")?.addEventListener("click", () => {
    logoutWithMessage();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadDashboard();
});