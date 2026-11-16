
const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3003/api"
    : "/api";

const btnResetPassword = document.getElementById("btnResetPassword");
const authMessage = document.getElementById("authMessage");

function showMessage(message) {
  authMessage.textContent = message;
}

async function resetPassword() {
  const token = new URLSearchParams(window.location.search).get("token");

  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (!token) {
    showMessage(
      "O link de recuperação é inválido ou expirou. Solicite um novo link."
    );
    return;
  }

  if (newPassword.length < 6) {
    showMessage("A nova senha deve ter pelo menos 6 caracteres.");
    return;
  }

  if (newPassword !== confirmPassword) {
    showMessage("As senhas informadas não coincidem.");
    return;
  }

  btnResetPassword.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token,
        newPassword
      })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      showMessage(data.message || "Erro ao redefinir senha.");
      return;
    }

    showMessage(
      "Senha redefinida com sucesso! Você já pode acessar sua conta."
    );

    document.getElementById("newPassword").value = "";
    document.getElementById("confirmPassword").value = "";

    setTimeout(() => {
      window.location.href = "./login.html";
    }, 5000);

  } catch (error) {
    console.error("Erro ao redefinir senha:", error);
    showMessage("Erro de conexão com o servidor.");
  } finally {
    btnResetPassword.disabled = false;
  }
}

btnResetPassword.addEventListener("click", resetPassword);
