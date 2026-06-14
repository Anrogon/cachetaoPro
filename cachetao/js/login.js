const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3001/api"
    : "/api";

function showMessage(text, isError = false) {
  const el = document.getElementById("authMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

let loginBusy = false;

function redirectAfterLogin(user) {
  if (user?.must_reset_password === true || user?.must_reset_password === 1) {
    window.location.href = "./change-password.html";
    return;
  }

  if (user?.is_admin === true || user?.is_admin === 1) {
    window.location.href = "./admin-home.html";
    return;
  }

  window.location.href = "./index.html";
}

function getPostLoginRedirect(user) {
  if (user?.is_admin === true || user?.is_admin === 1) {
    return "./admin-home.html";
  }

  return "./index.html";
}

async function doLogin() {
  if (loginBusy) return;
  loginBusy = true;

  const btn = document.getElementById("btnLoginSubmit");
  if (btn) btn.disabled = true;

  const email = document.getElementById("loginEmail")?.value?.trim() || "";
  const password = document.getElementById("loginPassword")?.value || "";

  if (!email || !password) {
    showMessage("Informe e-mail e senha.", true);
    loginBusy = false;
    if (btn) btn.disabled = false;
    return;
  }

  showMessage("Entrando...");

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      showMessage(data?.message || "Falha no login.", true);
      loginBusy = false;
      if (btn) btn.disabled = false;
      return;
    }

    localStorage.setItem("pontinhoAuthUser", JSON.stringify(data.user || {}));

    if (data.user?.must_reset_password === true || data.user?.must_reset_password === 1) {
      localStorage.removeItem("pontinhoPlayerName");
      localStorage.removeItem("pontinhoAvatarUrl");

      showMessage("Senha temporária detectada. Redirecionando para troca obrigatória...");

      setTimeout(() => {
        redirectAfterLogin(data.user);
      }, 700);

      return;
    }

    if (data.user?.is_admin === true || data.user?.is_admin === 1) {
      localStorage.removeItem("pontinhoPlayerName");
      localStorage.removeItem("pontinhoAvatarUrl");

      showMessage("Login administrativo realizado com sucesso.");

      setTimeout(() => {
        redirectAfterLogin(data.user);
      }, 700);

      return;
    }

    if (data.user?.username) {
      localStorage.setItem("pontinhoPlayerName", data.user.username);
    }

    if (data.user?.avatarUrl) {
      localStorage.setItem("pontinhoAvatarUrl", data.user.avatarUrl);
    } else {
      localStorage.removeItem("pontinhoAvatarUrl");
    }

    showMessage("Login realizado com sucesso.");

    setTimeout(() => {
      redirectAfterLogin(data.user);
    }, 700);
  } catch (err) {
    console.error("Erro no login:", err);
    showMessage(`Não foi possível conectar ao servidor de autenticação. (${err.message})`, true);
    loginBusy = false;
    if (btn) btn.disabled = false;
  }
}

document.getElementById("btnLoginSubmit")?.addEventListener("click", doLogin);

document.getElementById("btnBackHome")?.addEventListener("click", () => {
  window.location.href = "./index.html";
});

document.getElementById("loginPassword")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});
