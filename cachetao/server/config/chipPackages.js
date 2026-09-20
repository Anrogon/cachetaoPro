const CHIP_PACKAGES = [
  {
    id: "pack_1000",
    label: "1.000 fichas",
    priceCents: 299,
    chips: 1000,
  },
  {
    id: "pack_5000",
    label: "5.000 fichas",
    priceCents: 499,
    chips: 5000,
  },
  {
    id: "pack_10000",
    label: "10.000 fichas",
    priceCents: 799,
    chips: 10000,
  },
  {
    id: "pack_20000",
    label: "20.000 fichas",
    priceCents: 1499,
    chips: 20000,
  },
  {
    id: "pack_50000",
    label: "50.000 fichas",
    priceCents: 3499,
    chips: 50000,
  },
];


// =========================================================
// PACOTES DE DEPÓSITO — SALDO EM R$
// =========================================================

const CASH_PACKAGES = [
  {
    id: "cash_20",
    label: "R$ 20,00",
    amountCents: 2000,
  },
  {
    id: "cash_50",
    label: "R$ 50,00",
    amountCents: 5000,
  },
  {
    id: "cash_100",
    label: "R$ 100,00",
    amountCents: 10000,
  },
  {
    id: "cash_150",
    label: "R$ 150,00",
    amountCents: 15000,
  },
  {
    id: "cash_200",
    label: "R$ 200,00",
    amountCents: 20000,
  },
  {
    id: "cash_250",
    label: "R$ 250,00",
    amountCents: 25000,
  },
];


function getChipPackage(packageId) {
  return CHIP_PACKAGES.find(p => p.id === packageId) || null;
}


function getCashPackage(packageId) {
  return CASH_PACKAGES.find(p => p.id === packageId) || null;
}


module.exports = {
  CHIP_PACKAGES,
  CASH_PACKAGES,
  getChipPackage,
  getCashPackage,
};