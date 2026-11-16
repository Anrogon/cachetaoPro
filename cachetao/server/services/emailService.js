const nodemailer = require("nodemailer");

// =====================================================
// BREVO — ENVIO DE E-MAILS TRANSACIONAIS
// =====================================================

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// =====================================================
// ENVIA E-MAIL DE VERIFICAÇÃO DE CADASTRO
// =====================================================

async function sendVerificationEmail(email, token) {
  if (!email || !token) {
    throw new Error(
      "E-mail e token são obrigatórios."
    );
  }

  const baseUrl = (
    process.env.APP_BASE_URL ||
    "https://cachetaopro.com.br"
    ).replace(/\/+$/, "");

  const verificationUrl =
  `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  const subject = "Confirme seu e-mail — Cachetão Pro";

  const text = [
    "Bem-vindo ao Cachetão Pro!",
    "",
    "Para confirmar seu endereço de e-mail, acesse:",
    verificationUrl,
    "",
    "Este link é válido por 24 horas.",
    "",
    "Se você não criou uma conta, ignore esta mensagem.",
    "",
    "Equipe Cachetão Pro",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;
                max-width:560px;
                margin:0 auto;
                color:#263238;">

      <h2 style="color:#176b43;">
        Bem-vindo ao Cachetão Pro!
      </h2>

      <p>
        Obrigado por se cadastrar.
      </p>

      <p>
        Para confirmar seu endereço de e-mail,
        clique no botão abaixo:
      </p>

      <p style="margin:30px 0;">
        <a href="${verificationUrl}"
           style="background:#176b43;
                  color:#ffffff;
                  padding:14px 24px;
                  border-radius:6px;
                  text-decoration:none;
                  font-weight:bold;">
          Confirmar meu e-mail
        </a>
      </p>

      <p>
        Este link é válido por <strong>24 horas</strong>.
      </p>

      <p>
        Se você não criou uma conta no Cachetão Pro,
        ignore esta mensagem.
      </p>

      <hr style="border:0;
                 border-top:1px solid #dddddd;
                 margin:25px 0;">

      <p style="font-size:12px;color:#777777;">
        Cachetão Pro — JAKQ Jogos
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: {
      name: "Cachetão Pro",
      address: process.env.SMTP_FROM,
    },
    to: email,
    subject,
    text,
    html,
  });

  return {
    messageId: info.messageId,
  };
}


/* =====================================================
   ENVIA E-MAIL DE RECUPERAÇÃO DE SENHA
===================================================== */

async function sendPasswordResetEmail(email, token) {
  if (!email || !token) {
    throw new Error("E-mail e token são obrigatórios.");
  }

  const baseUrl = (
    process.env.FRONTEND_BASE_URL ||
    "https://cachetaopro.com.br"
    ).replace(/\/+$/, "");

  const resetUrl =
    `${baseUrl}/reset-password.html?token=${encodeURIComponent(token)}`;

  const subject = "Recuperação de senha — Cachetão Pro";

  const text = [
    "Olá!",
    "",
    "Recebemos uma solicitação para redefinir sua senha do Cachetão Pro.",
    "",
    "Para criar uma nova senha, acesse:",
    resetUrl,
    "",
    "Este link é válido por 30 minutos e só pode ser utilizado uma vez.",
    "",
    "Se você não solicitou a recuperação, ignore esta mensagem.",
    "Sua senha atual continuará funcionando.",
    "",
    "Equipe Cachetão Pro",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;
                max-width:560px;
                margin:0 auto;
                color:#263238;">

      <h2 style="color:#1d4ed8;">
        Recuperação de senha — Cachetão Pro
      </h2>

      <p>Olá!</p>

      <p>
        Recebemos uma solicitação para redefinir
        a senha da sua conta no Cachetão Pro.
      </p>

      <p>
        Para criar uma nova senha,
        clique no botão abaixo:
      </p>

      <p style="margin:30px 0;">
        <a href="${resetUrl}"
           style="display:inline-block;
                  background:#a51f36;
                  color:#ffffff;
                  padding:14px 24px;
                  border-radius:8px;
                  text-decoration:none;
                  font-weight:bold;">
          Criar nova senha
        </a>
      </p>

      <p>
        Este link é válido por
        <strong>30 minutos</strong>
        e pode ser utilizado apenas uma vez.
      </p>

      <p>
        Se você não solicitou esta recuperação,
        ignore a mensagem.
        Sua senha atual não será alterada.
      </p>

      <hr style="border:0;
                 border-top:1px solid #dddddd;
                 margin:25px 0;">

      <p style="font-size:12px;color:#777777;">
        Cachetão Pro — JAKQ Jogos
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: {
      name: "Cachetão Pro",
      address: process.env.SMTP_FROM,
    },
    to: email,
    subject,
    text,
    html,
  });

  return {
    messageId: info.messageId,
  };
}


module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
};
