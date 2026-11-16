
const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3003/api"
    : "/api";

const btnRecoverPassword = document.getElementById("btnRecoverPassword");
const recoveryEmail = document.getElementById("recoveryEmail");
const authMessage = document.getElementById("authMessage");

function showMessage(message) {
  authMessage.textContent = message;
}

async function recoverPassword() {
  const email = recoveryEmail.value.trim();

  if (!email || !recoveryEmail.checkValidity()) {
    showMessage("Informe um e-mail válido.");
    return;
  }

  btnRecoverPassword.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      showMessage(data.message || "Erro ao solicitar recuperação de senha.");
      return;
    }

    showMessage("Solicitação recebida! Confira sua caixa de entrada.");

  } catch (error) {
    console.error("Erro ao solicitar recuperação:", error);
    showMessage("Erro de conexão com o servidor.");
  } finally {
    btnRecoverPassword.disabled = false;
  }
}

btnRecoverPassword.addEventListener("click", recoverPassword);
