const API_BASE = "http://localhost:3001/api";

const AVATAR_LIST = Array.from({ length: 22 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `/assets/avatars/avatar-${n}.png`;
});

let selectedAvatarUrl = "";

function setMsg(text, isError = false) {
  const el = document.getElementById("avatarMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

function getStoredAuthUser() {
  try {
    return JSON.parse(localStorage.getItem("pontinhoAuthUser") || "null");
  } catch (err) {
    console.error("Erro ao ler pontinhoAuthUser:", err);
    return null;
  }
}

function saveLocalUser(user) {
  localStorage.setItem("pontinhoAuthUser", JSON.stringify(user || {}));

  const username =
    String(user?.username || user?.name || "").trim();

  const avatarUrl =
    String(user?.avatarUrl || user?.avatar_url || "").trim();

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

function renderAvatarGrid() {
  const grid = document.getElementById("avatarGrid");
  if (!grid) return;

  grid.innerHTML = AVATAR_LIST.map((url, idx) => `
    <div class="avatar-option ${url === selectedAvatarUrl ? "selected" : ""}" data-avatar-url="${url}">
      <img src="${url}" alt="Avatar ${idx + 1}">
      <div class="avatar-label">Avatar ${String(idx + 1).padStart(2, "0")}</div>
    </div>
  `).join("");

  bindAvatarClicks();
}

function bindAvatarClicks() {
  document.querySelectorAll(".avatar-option").forEach((el) => {
    el.addEventListener("click", () => {
      selectedAvatarUrl = el.dataset.avatarUrl || "";
      updatePreview();
      renderAvatarGrid();
    });
  });
}

function updatePreview() {
  const img = document.getElementById("currentAvatarPreview");
  if (!img) return;
  img.src = selectedAvatarUrl || "/assets/image/avatars/avatar-01.png";
}

async function loadCurrentUser() {
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
  setMsg(data?.message || `Não foi possível salvar o avatar. (HTTP ${res.status})`, true);
  return;
    }

    console.log("USER RECEBIDO AO SALVAR AVATAR:", data.user);

    saveLocalUser(data.user);

    selectedAvatarUrl =
      data.user.avatarUrl ||
      localStorage.getItem("pontinhoAvatarUrl") ||
      AVATAR_LIST[0];

    updatePreview();
    renderAvatarGrid();
    setMsg("Escolha seu avatar.");
  } catch (err) {
    console.error("Erro ao carregar perfil:", err);
    setMsg(`Erro ao carregar perfil. (${err.message})`, true);
  }
}

async function saveAvatar() {
  if (!selectedAvatarUrl) {
    setMsg("Selecione um avatar.", true);
    return;
  }

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

    console.log("SAVE AVATAR status =", res.status);
    console.log("SAVE AVATAR response =", data);
    console.log("SAVE AVATAR selectedAvatarUrl =", selectedAvatarUrl);

    if (!res.ok || !data?.ok || !data?.user) {
    setMsg(data?.message || `Não foi possível salvar o avatar. (HTTP ${res.status})`, true);
    return;
    }

    saveLocalUser(data.user);
    updatePreview();
    setMsg("Avatar atualizado com sucesso.");
  } catch (err) {
    console.error("Erro ao salvar avatar:", err);
    setMsg(`Erro ao salvar avatar. (${err.message})`, true);
  }
}

function bindEvents() {
  document.getElementById("btnSaveAvatar")?.addEventListener("click", saveAvatar);

  document.getElementById("btnBackHome")?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadCurrentUser();
});