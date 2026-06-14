const API_BASE = "/api";

function setMsg(text, isError = false) {
  const el = document.getElementById("adminHomeMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ?? "—";
}

function getStoredAuthUser() {
  try {
    const raw = localStorage.getItem("pontinhoAuthUser");
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Erro ao ler pontinhoAuthUser:", err);
    return null;
  }
}

function saveAuthUser(user) {
  localStorage.setItem("pontinhoAuthUser", JSON.stringify(user || {}));
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



function extractUserFromMe(data) {
  if (!data) return null;

  if (data.user && typeof data.user === "object") return data.user;
  if (data.data?.user && typeof data.data.user === "object") return data.data.user;
  if (data.ok && data.user) return data.user;
  if (typeof data === "object") return data;

  return null;
}

function isAdminUser(user) {
  return (
    user?.is_admin === true ||
    user?.is_admin === 1
  );
}

function renderUser(user) {
  setText("adminUsername", user?.username || "—");
  setText("adminEmail", user?.email || "—");
  setText("adminRole", isAdminUser(user) ? "Administrador" : "Usuário comum");
  setText("adminUserId", user?.id ?? "—");
}

function goToLogin() {
  window.location.href = "./login.html";
}

async function validateAdminAccess() {
  setMsg("Validando acesso administrativo...");
  setText("adminAuthStatus", "Validando...");
  setText("adminBackendStatus", "GET /auth/me");

  const storedUser = getStoredAuthUser();
  if (storedUser) {
    renderUser(storedUser);
  }

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      setText("adminAuthStatus", "Sessão inválida");
      setText("adminBackendStatus", "Falha em /auth/me");
      setMsg("Sessão inválida. Faça login novamente.", true);
      setTimeout(() => logoutWithMessage("Sua sessão expirou. Faça login novamente."), 900);
      return;
    }

    if (res.status === 403) {
      setText("adminAuthStatus", "Acesso bloqueado");
      setText("adminBackendStatus", "Falha em /auth/me");
      setMsg(data?.message || "Seu acesso foi bloqueado.", true);
      setTimeout(() => logoutWithMessage(data?.message || "Seu acesso foi bloqueado."), 900);
      return;
    }

    if (!res.ok) {
      clearAuthUser();
      setText("adminAuthStatus", "Erro");
      setText("adminBackendStatus", "Falha em /auth/me");
      setMsg("Não foi possível validar sua sessão.", true);
      setTimeout(goToLogin, 900);
      return;
    }

    const user = extractUserFromMe(data);

    if (!user) {
      clearAuthUser();
      setText("adminAuthStatus", "Resposta inválida");
      setText("adminBackendStatus", "Sem usuário");
      setMsg("O backend não retornou um usuário válido.", true);
      setTimeout(goToLogin, 900);
      return;
    }

    saveAuthUser(user);
    renderUser(user);

    if (!isAdminUser(user)) {
      setText("adminAuthStatus", "Acesso negado");
      setText("adminBackendStatus", "Usuário sem privilégio admin");
      setMsg("Você está logado, mas não é administrador.", true);
      setTimeout(goToLogin, 1200);
      return;
    }

    setText("adminAuthStatus", "Autenticado");
    setText("adminBackendStatus", "Conectado");
    setMsg("Acesso administrativo liberado.");
  } catch (err) {
    console.error("Erro ao validar admin:", err);
    setText("adminAuthStatus", "Erro");
    setText("adminBackendStatus", "Servidor indisponível");
    setMsg(`Erro ao validar sessão. (${err.message})`, true);
  }
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

function bindEvents() {
  document.getElementById("btnGoUsers")?.addEventListener("click", () => {
    window.location.href = "./admin-users.html";
  });

  document.getElementById("btnGoDashboard")?.addEventListener("click", () => {
    window.location.href = "./admin-dashboard.html";
  });

  document.getElementById("btnGoFinance")?.addEventListener("click", () => {
    window.location.href = "./admin-finance.html";
  });

  document.getElementById("btnLogout")?.addEventListener("click", doLogout);
  document.getElementById("btnLogoutBottom")?.addEventListener("click", doLogout);
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  validateAdminAccess();
});