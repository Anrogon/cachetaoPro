const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3001/api"
    : "/api";

const AVATAR_LIST = Array.from({ length: 35 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `/assets/avatars/avatar-${n}.png`;
});

let currentAvatarIndex = 0;

function setMsg(text, isError = false) {
  const el = document.getElementById("profileMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

function saveLocalUser(user) {
  localStorage.setItem("pontinhoAuthUser", JSON.stringify(user || {}));

  const username = String(user?.username || user?.name || "").trim();
  const avatarUrl = String(user?.avatarUrl || user?.avatar_url || "").trim();

  if (username) {
    localStorage.setItem("pontinhoPlayerName", username);
  } else {
    localStorage.removeItem("pontinhoPlayerName");
  }

  if (avatarUrl) {
    localStorage.setItem("pontinhoAvatarUrl", avatarUrl);
  } else {
    localStorage.removeItem("pontinhoAvatarUrl");
  }
}

function clearLocalAuth() {
  localStorage.removeItem("pontinhoAuthUser");
  localStorage.removeItem("pontinhoPlayerName");
  localStorage.removeItem("pontinhoAvatarUrl");
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


function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatProfitLoss(totalProfit, totalLoss) {
  const profit = Number(totalProfit) || 0;
  const loss = Number(totalLoss) || 0;
  const net = profit - loss;

  const signal = net > 0 ? "+" : "";
  return `${signal}${net.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


function updateCarouselUI() {
  const selectedUrl = AVATAR_LIST[currentAvatarIndex] || AVATAR_LIST[0];

  const preview = document.getElementById("carouselAvatarPreview");
  const label = document.getElementById("carouselAvatarLabel");

  if (preview) preview.src = selectedUrl;
  if (label) label.textContent = `Avatar ${String(currentAvatarIndex + 1).padStart(2, "0")}`;
}

function updateMainAvatar(url) {
  const img = document.getElementById("profileAvatar");
  if (!img) return;
  img.src = url || AVATAR_LIST[0];
}

function findAvatarIndex(url) {
  const idx = AVATAR_LIST.indexOf(url);
  return idx >= 0 ? idx : 0;
}

async function loadProfile() {
  setMsg("Carregando perfil...");

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      setMsg("Sessão inválida. Faça login novamente.", true);
      setTimeout(() => {
        window.location.href = "./login.html";
      }, 900);
      return;
    }

    if (!res.ok || !data?.ok || !data?.user) {
      setMsg(data?.message || "Não foi possível carregar o perfil.", true);
      return;
    }

    const user = data.user;
    saveLocalUser(user);

    document.getElementById("profileUsername").textContent = user.username || "—";
    document.getElementById("profileEmail").textContent = user.email || "—";
    document.getElementById("profileBalance").textContent = formatBalance(user.chipsBalance);
    document.getElementById("profileCreatedAt").textContent = formatDate(user.createdAt);

    document.getElementById("profileAccountType").textContent =
      user.is_admin === true || user.is_admin === 1 ? "Administrador" : "Jogador";

    document.getElementById("profileAccountStatus").textContent =
      user.is_blocked === true || user.is_blocked === 1 ? "Bloqueada" : "Ativa";

    document.getElementById("profileStatsBalance").textContent =
    formatBalance(user.chipsBalance);

    document.getElementById("profileStatsMemberSince").textContent =
    formatDate(user.createdAt);

    const avatarUrl = user.avatarUrl || localStorage.getItem("pontinhoAvatarUrl") || AVATAR_LIST[0];
    currentAvatarIndex = findAvatarIndex(avatarUrl);

    updateMainAvatar(avatarUrl);
    updateCarouselUI();

    await loadProfileStats();
    await loadWalletHistory();

    setMsg("Perfil carregado com sucesso.");
  } catch (err) {
    console.error("Erro ao carregar perfil:", err);
    setMsg(`Erro ao carregar perfil. (${err.message})`, true);
  }
}

async function loadProfileStats() {
  try {
    const res = await fetch(`${API_BASE}/auth/me/stats`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok || !data?.stats) {
      document.getElementById("profileGamesPlayed").textContent = "—";
      document.getElementById("profileWins").textContent = "—";
      document.getElementById("profileLosses").textContent = "—";
      document.getElementById("profileWinRate").textContent = "—";
      document.getElementById("profileProfitLoss").textContent = "—";
      return;
    }

    const stats = data.stats;
    const matchesPlayed = Number(stats.matchesPlayed) || 0;
    const wins = Number(stats.wins) || 0;
    const losses = Number(stats.losses) || 0;
    const totalProfit = Number(stats.totalProfit) || 0;
    const totalLoss = Number(stats.totalLoss) || 0;

    const winRate = matchesPlayed > 0 ? (wins / matchesPlayed) * 100 : 0;

    document.getElementById("profileGamesPlayed").textContent = String(matchesPlayed);
    document.getElementById("profileWins").textContent = String(wins);
    document.getElementById("profileLosses").textContent = String(losses);
    document.getElementById("profileWinRate").textContent = formatPercent(winRate);
    document.getElementById("profileProfitLoss").textContent = formatProfitLoss(totalProfit, totalLoss);
  } catch (err) {
    console.error("Erro ao carregar estatísticas do perfil:", err);

    document.getElementById("profileGamesPlayed").textContent = "—";
    document.getElementById("profileWins").textContent = "—";
    document.getElementById("profileLosses").textContent = "—";
    document.getElementById("profileWinRate").textContent = "—";
    document.getElementById("profileProfitLoss").textContent = "—";
  }
}

function formatMoneyFromCents(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function getWalletStatusLabel(status) {
  const s = String(status || "").toLowerCase();

  if (s === "approved") return "Aprovado";
  if (s === "pending") return "Pendente";
  if (s === "cancelled" || s === "canceled") return "Cancelado";
  if (s === "rejected") return "Recusado";

  return status || "—";
}

async function loadWalletHistory() {
  const el = document.getElementById("profileWalletHistory");
  if (!el) return;

  el.innerHTML = `<div class="wallet-history-empty">Carregando histórico...</div>`;

  try {
    const res = await fetch(`${API_BASE}/wallet/history`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      el.innerHTML = `<div class="wallet-history-empty">Não foi possível carregar o histórico.</div>`;
      return;
    }

    const transactions = Array.isArray(data.transactions)
      ? data.transactions
      : [];

    if (!transactions.length) {
      el.innerHTML = `<div class="wallet-history-empty">Nenhuma transação financeira ainda.</div>`;
      return;
    }

    el.innerHTML = transactions.map(t => {
      const status = String(t.status || "").toLowerCase();

      const statusClass =
        status === "approved" ? "approved" :
        status === "pending" ? "pending" :
        "other";

      const typeLabel =
        t.type === "deposit" ? "Depósito PIX" :
        t.type === "withdraw" ? "Saque" :
        t.type || "Transação";

      return `
        <div class="wallet-history-item">
          <div>
            <strong>${typeLabel}</strong>
            <span>${Number(t.chips_amount || 0).toLocaleString("pt-BR")} fichas</span>
          </div>

          <div>
            <span class="wallet-status ${statusClass}">
              ${getWalletStatusLabel(t.status)}
            </span>
            <small>${formatMoneyFromCents(t.amount_cents)} · ${formatDate(t.created_at)}</small>
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("Erro ao carregar histórico financeiro:", err);
    el.innerHTML = `<div class="wallet-history-empty">Erro ao carregar histórico financeiro.</div>`;
  }
}

async function saveAvatar() {
  const selectedAvatarUrl = AVATAR_LIST[currentAvatarIndex] || AVATAR_LIST[0];

  setMsg("Salvando avatar...");

  try {
    const res = await fetch(`${API_BASE}/auth/me/avatar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        avatarUrl: selectedAvatarUrl,
      }),
    });

    const data = await res.json().catch(() => null);

    if (res.status === 401) {
      setMsg("Sessão inválida. Faça login novamente.", true);
      setTimeout(() => {
        window.location.href = "./login.html";
      }, 900);
      return;
    }

    if (!res.ok || !data?.ok || !data?.user) {
      setMsg(data?.message || `Não foi possível salvar o avatar. (HTTP ${res.status})`, true);
      return;
    }

    saveLocalUser(data.user);
    updateMainAvatar(selectedAvatarUrl);
    setMsg("Avatar atualizado com sucesso.");
  } catch (err) {
    console.error("Erro ao salvar avatar:", err);
    setMsg(`Erro ao salvar avatar. (${err.message})`, true);
  }
}

async function changePassword() {
  const currentPassword = document.getElementById("currentPassword")?.value || "";
  const newPassword = document.getElementById("newPassword")?.value || "";
  const confirmPassword = document.getElementById("confirmPassword")?.value || "";

  if (!currentPassword || !newPassword || !confirmPassword) {
    setMsg("Preencha a senha atual, a nova senha e a confirmação.", true);
    return;
  }

  if (newPassword.length < 4) {
    setMsg("A nova senha deve ter pelo menos 4 caracteres.", true);
    return;
  }

  if (newPassword !== confirmPassword) {
    setMsg("A confirmação da nova senha não confere.", true);
    return;
  }

  setMsg("Alterando senha...");

  try {
    const res = await fetch(`${API_BASE}/auth/me/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        currentPassword,
        newPassword,
        confirmPassword,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      setMsg(data?.message || `Não foi possível alterar a senha. (HTTP ${res.status})`, true);
      return;
    }

    clearLocalAuth();
    setMsg("Senha alterada com sucesso. Faça login novamente.");

    setTimeout(() => {
      window.location.href = "./login.html";
    }, 1000);
  } catch (err) {
    console.error("Erro ao alterar senha:", err);
    setMsg(`Erro ao alterar senha. (${err.message})`, true);
  }
}

function bindEvents() {
  document.getElementById("btnPrevAvatar")?.addEventListener("click", () => {
    currentAvatarIndex = (currentAvatarIndex - 1 + AVATAR_LIST.length) % AVATAR_LIST.length;
    updateCarouselUI();
  });

  document.getElementById("btnNextAvatar")?.addEventListener("click", () => {
    currentAvatarIndex = (currentAvatarIndex + 1) % AVATAR_LIST.length;
    updateCarouselUI();
  });

  document.getElementById("btnSaveAvatar")?.addEventListener("click", saveAvatar);
  document.getElementById("btnChangePassword")?.addEventListener("click", changePassword);

  /*document.getElementById("btnGoSettings")?.addEventListener("click", () => {
    alert("Configurações do perfil podem entrar aqui depois.");
  });*/

  document.getElementById("btnBackHome")?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadProfile();
});