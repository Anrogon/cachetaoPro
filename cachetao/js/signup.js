const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3003/api"
    : "/api";

function showMessage(text, isError = false) {
  const el = document.getElementById("authMessage");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb3b3" : "#ffd38a";
}

let signupBusy = false;



async function doSignup() {
  if (signupBusy) return;
  signupBusy = true;

  console.log("doSignup() chamado");

  const btn = document.getElementById("btnSignupSubmit");
  if (btn) btn.disabled = true;

  const username = document.getElementById("signupUsername")?.value?.trim() || "";
  const email = document.getElementById("signupEmail")?.value?.trim() || "";
  const password = document.getElementById("signupPassword")?.value || "";
  const avatarUrl = "./assets/avatars/avatar-01.png";
  const acceptTerms = document.getElementById("acceptTerms");
  const turnstileToken = window.turnstile?.getResponse() || "";

  if (!username || !email || !password) {
    showMessage("Preencha nome, e-mail e senha.", true);
    signupBusy = false;
    if (btn) btn.disabled = false;
    return;
  }

  if (!acceptTerms?.checked) {
    showMessage("Você precisa aceitar os Termos de Uso e a Política de Privacidade.", true);
    signupBusy = false;
    if (btn) btn.disabled = false;
    return;
  }

  if (!turnstileToken) {
    showMessage("Confirme a verificação Sou humano antes de criar sua conta.", true);
    signupBusy = false;
    if (btn) btn.disabled = false;
    return;
  }

  showMessage("Criando conta...");

  try {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        username,
        email,
        password,
        avatarUrl,
        acceptedTerms: true,
        turnstileToken,
      }),
    });

    const data = await res.json().catch(() => null);

    console.log("Resposta signup:", res.status, data);

    if (!res.ok || !data?.ok) {
      showMessage(data?.message || "Falha ao criar conta.", true);
      signupBusy = false;
      if (btn) btn.disabled = false;
      return;
    }

    showMessage(
    data?.message ||
    "Cadastro realizado com sucesso! Enviamos um link de confirmação para seu e-mail."
  );

  setTimeout(() => {
    window.location.href = "./login.html";
  }, 5000);

  
  } catch (err) {
    console.error("Erro no cadastro:", err);
    showMessage(`Não foi possível conectar ao servidor de autenticação. (${err.message})`, true);
    signupBusy = false;
    if (btn) btn.disabled = false;
  }
}



window.doSignup = doSignup;

document.addEventListener("DOMContentLoaded", () => {
  console.log("signup.js carregado");

  const btnSignupSubmit = document.getElementById("btnSignupSubmit");
  if (btnSignupSubmit) {
    btnSignupSubmit.addEventListener("click", doSignup);
  } else {
    console.warn("btnSignupSubmit não encontrado");
  }

  const btnBackLogin = document.getElementById("btnBackLogin");
  if (btnBackLogin) {
    btnBackLogin.addEventListener("click", () => {
      window.location.href = "./login.html";
    });
  }

  const signupPassword = document.getElementById("signupPassword");
  if (signupPassword) {
    signupPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSignup();
    });
  }
});
