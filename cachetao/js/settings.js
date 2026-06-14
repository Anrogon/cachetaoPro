const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3001/api"
    : "/api";

function setMsg(text, isError = false) {
  const el = document.getElementById("settingsMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

async function loadMe() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: "GET",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      setMsg(data?.message || "Não foi possível carregar os dados.", true);
      return;
    }

    document.getElementById("settingsUsername").value = data.user.username || "";
    document.getElementById("settingsAvatarUrl").value = data.user.avatarUrl || "";
  } catch (err) {
    console.error("Erro ao carregar settings:", err);
    setMsg(`Erro ao carregar dados. (${err.message})`, true);
  }
}

async function saveSettings() {
  const username = document.getElementById("settingsUsername")?.value?.trim() || "";
  const avatarUrl = document.getElementById("settingsAvatarUrl")?.value?.trim() || "";
  const newPassword = document.getElementById("settingsNewPassword")?.value || "";
  const confirmPassword = document.getElementById("settingsConfirmPassword")?.value || "";

  if (!username || username.length < 3) {
    setMsg("Nome de usuário deve ter pelo menos 3 caracteres.", true);
    return;
  }

  if (newPassword || confirmPassword) {
    if (newPassword.length < 6) {
      setMsg("A nova senha deve ter pelo menos 6 caracteres.", true);
      return;
    }

    if (newPassword !== confirmPassword) {
      setMsg("A confirmação da senha não confere.", true);
      return;
    }
  }

  setMsg("Salvando...");

  try {
    const res = await fetch(`${API_BASE}/auth/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        username,
        avatarUrl,
        newPassword,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      setMsg(data?.message || "Falha ao salvar configurações.", true);
      return;
    }

    localStorage.setItem("pontinhoPlayerName", data.user.username || "Anônimo");
    if (data.user.avatarUrl) {
      localStorage.setItem("pontinhoAvatarUrl", data.user.avatarUrl);
    } else {
      localStorage.removeItem("pontinhoAvatarUrl");
    }

    localStorage.setItem("pontinhoAuthUser", JSON.stringify(data.user));

    setMsg("Configurações salvas com sucesso.");
    document.getElementById("settingsNewPassword").value = "";
    document.getElementById("settingsConfirmPassword").value = "";
  } catch (err) {
    console.error("Erro ao salvar settings:", err);
    setMsg(`Erro ao salvar configurações. (${err.message})`, true);
  }
}

document.getElementById("btnSaveSettings")?.addEventListener("click", saveSettings);

document.getElementById("btnBackProfile")?.addEventListener("click", () => {
  window.location.href = "./profile.html";
});

loadMe();