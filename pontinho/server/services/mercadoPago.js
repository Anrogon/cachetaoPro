const { MercadoPagoConfig, Payment } = require("mercadopago");

const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) {
  console.warn("[MP] MP_ACCESS_TOKEN não configurado.");
}

const client = new MercadoPagoConfig({
  accessToken,
});

const payment = new Payment(client);

async function createPixPayment({ amountCents, description, payerEmail, externalReference }) {
  const amount = Number(amountCents) / 100;

  const result = await payment.create({
    body: {
      transaction_amount: amount,
      description,
      payment_method_id: "pix",
      payer: {
        email: payerEmail || "cliente@pontinhoplay.com.br",
      },
      external_reference: String(externalReference),
    },
  });

  return result;
}

async function getPaymentById(paymentId) {
  return await payment.get({
    id: String(paymentId),
  });
}

module.exports = {
  createPixPayment,
  getPaymentById,
};