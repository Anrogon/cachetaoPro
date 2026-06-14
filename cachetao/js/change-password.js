const API_BASE = "/api";

let changeBusy = false;

function setMsg(text, isError = false) {
  const el = document.getElementById("changePasswordMsg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

function clearLocalUser() {
  localStorage.removeItem("pontinhoAuthUser");
  localStorage.removeItem("pontinhoPlayerName");
  localStorage.removeItem("pontinhoAvatarUrl");
}

async function submitForcedPasswordChange() {
  if (changeBusy) return;
  changeBusy = true;

  const btn = document.getElementById("btnChangePassword");
  if (btn) btn.disabled = true;

  const newPassword = document.getElementById("newPassword")?.value?.trim() || "";
  const confirmPassword = document.getElementById("confirmPassword")?.value?.trim() || "";

  if (!newPassword || newPassword.length < 4) {
    setMsg("A nova senha deve ter pelo menos 4 caracteres.", true);
    changeBusy = false;
    if (btn) btn.disabled = false;
    return;
  }

  if (newPassword !== confirmPassword) {
    setMsg("A confirmação de senha não confere.", true);
    changeBusy = false;
    if (btn) btn.disabled = false;
    return;
  }

  try {
    setMsg("Salvando nova senha...");

    const res = await fetch(`${API_BASE}/auth/change-password-required`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        newPassword,
        confirmPassword,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      setMsg(data?.message || "Não foi possível alterar a senha.", true);
      changeBusy = false;
      if (btn) btn.disabled = false;
      return;
    }

    clearLocalUser();
    setMsg("Senha alterada com sucesso. Faça login novamente.");

    setTimeout(() => {
      window.location.href = "./login.html";
    }, 900);
  } catch (err) {
    console.error("Erro ao alterar senha:", err);
    setMsg(`Erro ao alterar senha. (${err.message})`, true);
    changeBusy = false;
    if (btn) btn.disabled = false;
  }
}

function bindEvents() {
  document.getElementById("btnChangePassword")?.addEventListener("click", submitForcedPasswordChange);

  document.getElementById("btnBackLogin")?.addEventListener("click", () => {
    clearLocalUser();
    window.location.href = "./login.html";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
});
