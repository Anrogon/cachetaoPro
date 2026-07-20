const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3001/api"
    : "/api";

let allAdminUsers = [];
let currentPage = 1;
let pageSize = 20;

function setMsg(text, isError = false) {
  const el = document.getElementById("adminMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

function setUsersCount(value) {
  const el = document.getElementById("usersCount");
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
  goToLogin();
}



function formatBalance(value) {
  return (Number(value) || 0).toLocaleString("pt-BR");
}

function formatDate(value) {
  if (!value) return "—";

  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";

  return dt.toLocaleString("pt-BR");
}

function isAdminUser(user) {
  return user?.is_admin === true || user?.is_admin === 1;
}

function isBlockedUser(user) {
  return user?.is_blocked === true || user?.is_blocked === 1;
}

function getSearchTerm() {
  return (document.getElementById("userSearchInput")?.value || "").trim().toLowerCase();
}

function getFilterValue() {
  return document.getElementById("userFilterSelect")?.value || "all";
}

function getTotalPages(totalItems) {
  const safePageSize = Number(pageSize) || 20;
  return Math.max(1, Math.ceil(totalItems / safePageSize));
}

function updatePaginationLabels(totalItems) {
  const totalPages = getTotalPages(totalItems);

  const currentPageLabel = document.getElementById("currentPageLabel");
  const totalPagesLabel = document.getElementById("totalPagesLabel");
  const btnPrevPage = document.getElementById("btnPrevPage");
  const btnNextPage = document.getElementById("btnNextPage");

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  if (currentPage < 1) {
    currentPage = 1;
  }

  if (currentPageLabel) currentPageLabel.textContent = String(currentPage);
  if (totalPagesLabel) totalPagesLabel.textContent = String(totalPages);

  if (btnPrevPage) btnPrevPage.disabled = currentPage <= 1;
  if (btnNextPage) btnNextPage.disabled = currentPage >= totalPages;
}

function paginateUsers(users) {
  const safePageSize = Number(pageSize) || 20;
  const start = (currentPage - 1) * safePageSize;
  const end = start + safePageSize;
  return users.slice(start, end);
}

function applyUserFilters(resetPage = false) {
  if (resetPage) {
    currentPage = 1;
  }

  const term = getSearchTerm();
  const filter = getFilterValue();

  let filtered = Array.isArray(allAdminUsers) ? [...allAdminUsers] : [];

  if (term) {
    filtered = filtered.filter((user) => {
      const username = String(user?.username || "").toLowerCase();
      const email = String(user?.email || "").toLowerCase();

      return username.includes(term) || email.includes(term);
    });
  }

  if (filter === "admin") {
    filtered = filtered.filter((user) => isAdminUser(user));
  } else if (filter === "blocked") {
    filtered = filtered.filter((user) => isBlockedUser(user));
  } else if (filter === "active") {
    filtered = filtered.filter((user) => !isBlockedUser(user));
  }

  updatePaginationLabels(filtered.length);

  const paginated = paginateUsers(filtered);
  renderUsers(paginated);

  const usersCountEl = document.getElementById("usersCount");
  if (usersCountEl) {
    usersCountEl.textContent = String(filtered.length);
  }
}



function goToAdminHome() {
  window.location.href = "./admin-home.html";
}

function goToLogin() {
  window.location.href = "./login.html";
}

async function doLogout() {
  setMsg("Saindo...");

  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => null);
  } catch (err) {
    console.warn("Falha ao chamar logout:", err);
  }

  clearAuthUser();
  goToLogin();
}

async function adminPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    throw new Error(data?.message || "A operação falhou.");
  }

  return data;
}

async function handleBlock(userId, username) {
  const reason = window.prompt(`Motivo do bloqueio para "${username}":`, "Bloqueado.");
  if (reason === null) return;

  try {
    setMsg("Bloqueando usuário...");
    const data = await adminPost(`${API_BASE}/auth/admin/users/${userId}/block`, { reason });
    setMsg(data.message || "Usuário bloqueado com sucesso.");
    await loadUsers({ silentSuccess: true });
  } catch (err) {
    setMsg(err.message, true);
  }
}

async function handleUnblock(userId) {
  try {
    setMsg("Desbloqueando usuário...");
    const data = await adminPost(`${API_BASE}/auth/admin/users/${userId}/unblock`, {});
    setMsg(data.message || "Usuário desbloqueado com sucesso.");
    await loadUsers({ silentSuccess: true });
  } catch (err) {
    setMsg(err.message, true);
  }
}

async function handleResetPassword(userId, username) {
  const newPassword = window.prompt(`Nova senha temporária para "${username}":`, "");
  if (newPassword === null) return;

  if (!newPassword || newPassword.trim().length < 4) {
    setMsg("A nova senha precisa ter pelo menos 4 caracteres.", true);
    return;
  }

  try {
    setMsg("Redefinindo senha...");
    const data = await adminPost(`${API_BASE}/admin/users/${userId}/reset-password`, {
      newPassword: newPassword.trim(),
    });
    setMsg(`${data.message || "Senha redefinida com sucesso."} Senha temporária definida.`);
    await loadUsers({ silentSuccess: true });
  } catch (err) {
    setMsg(err.message, true);
  }
}

async function handleEndSessions(userId) {
  try {
    setMsg("Encerrando sessões...");
    const data = await adminPost(`${API_BASE}/auth/admin/users/${userId}/end-sessions`, {});
    setMsg(data.message || "Sessões encerradas com sucesso.");
    await loadUsers({ silentSuccess: true });
  } catch (err) {
    setMsg(err.message, true);
  }
}

function buildStatusHtml(user) {
  if (isBlockedUser(user)) {
    const reason = user?.blocked_reason ? ` • ${user.blocked_reason}` : "";
    return `<span style="color:#ffb3b3;font-weight:700;">Bloqueado${reason}</span>`;
  }

  return `<span style="color:#b7f7c3;font-weight:700;">Ativo</span>`;
}

function buildActionsHtml(user) {
  const blocked = isBlockedUser(user);

  return `
  <div style="display:flex; gap:6px; flex-wrap:nowrap; align-items:center;">
    ${
      blocked
        ? `<button type="button" class="action-btn" data-action="unblock" data-id="${user.id}">Desbloquear</button>`
        : `<button type="button" class="action-btn" data-action="block" data-id="${user.id}" data-username="${user.username || ""}">Bloquear</button>`
    }
    <button type="button" class="action-btn" data-action="reset-password" data-id="${user.id}" data-username="${user.username || ""}">Resetar senha</button>
    <button type="button" class="action-btn" data-action="end-sessions" data-id="${user.id}">Encerrar sessões</button>
  </div>
`;
}

function renderUsers(users) {
  const tbody = document.getElementById("adminUsersBody");
  if (!tbody) return;

  if (!Array.isArray(users) || users.length === 0) {
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="empty">Nenhum usuário encontrado.</td>
    </tr>
  `;
  bindRowActions();
  return;
  }

  tbody.innerHTML = users.map((user) => {
    const profileHtml = isAdminUser(user)
      ? `<span class="admin-pill">Administrador</span>`
      : `<span class="user-pill">Usuário</span>`;

    return `
      <tr>
        <td>${user.id ?? "—"}</td>
        <td>${user.username ?? "—"}</td>
        <td>${user.email ?? "—"}</td>
        <td>${buildStatusHtml(user)}</td>
        <td>${formatBalance(user.chipsBalance)}</td>
        <td>${profileHtml}</td>
        <td>${formatDate(user.createdAt)}</td>
        <td>${buildActionsHtml(user)}</td>
      </tr>
    `;
  }).join("");

  bindRowActions();
}

function bindRowActions() {
  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const userId = Number(btn.dataset.id);
      const username = btn.dataset.username || "";

      if (!userId) return;

      if (action === "block") {
        await handleBlock(userId, username);
        return;
      }

      if (action === "unblock") {
        await handleUnblock(userId);
        return;
      }

      if (action === "reset-password") {
        await handleResetPassword(userId, username);
        return;
      }

      if (action === "end-sessions") {
        await handleEndSessions(userId);
      }
    });
  });
}

async function loadUsers(options = {}) {
  const { silentSuccess = false } = options;

  setMsg("Carregando usuários...");

  try {
    const res = await fetch(`${API_BASE}/auth/admin/users`, {
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
      setMsg(data?.message || "Não foi possível carregar os usuários.", true);
      renderUsers([]);
      return;
    }

    allAdminUsers = Array.isArray(data.users) ? data.users : [];
    applyUserFilters();

    if (!silentSuccess) {
      setMsg("Usuários carregados com sucesso.");
    }
  } catch (err) {
    console.error("Erro ao carregar usuários:", err);
    setMsg(`Erro ao carregar usuários. (${err.message})`, true);
    renderUsers([]);
  }
}

function bindEvents() {
  document.getElementById("btnReloadUsers")?.addEventListener("click", () => {
    loadUsers();
  });

  document.getElementById("btnBackHomeTop")?.addEventListener("click", goToAdminHome);
  document.getElementById("btnBackHome")?.addEventListener("click", goToAdminHome);
  document.getElementById("btnLogout")?.addEventListener("click", doLogout);

  document.getElementById("userSearchInput")?.addEventListener("input", () => {
  applyUserFilters(true);
  });

  document.getElementById("userFilterSelect")?.addEventListener("change", () => {
  applyUserFilters(true);
  });

  document.getElementById("btnClearFilters")?.addEventListener("click", () => {
  const searchInput = document.getElementById("userSearchInput");
  const filterSelect = document.getElementById("userFilterSelect");

  if (searchInput) searchInput.value = "";
  if (filterSelect) filterSelect.value = "all";

  currentPage = 1;
  applyUserFilters(true);
  setMsg("Filtros limpos.");
  });

  document.getElementById("btnPrevPage")?.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage -= 1;
    applyUserFilters(false);
  }
  });

  document.getElementById("btnGoDashboard")?.addEventListener("click", () => {
  window.location.href = "./admin-dashboard.html";
  });

  document.getElementById("btnNextPage")?.addEventListener("click", () => {
  currentPage += 1;
  applyUserFilters(false);
  });

  document.getElementById("pageSizeSelect")?.addEventListener("change", (event) => {
  pageSize = Number(event.target.value) || 20;
  currentPage = 1;
  applyUserFilters(true);
  });
}

  document.addEventListener("DOMContentLoaded", () => {
  const pageSizeSelect = document.getElementById("pageSizeSelect");
  pageSize = Number(pageSizeSelect?.value || 20);

  bindEvents();
  loadUsers();
  });
