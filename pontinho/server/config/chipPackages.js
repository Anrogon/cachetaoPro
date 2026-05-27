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

function getChipPackage(packageId) {
  return CHIP_PACKAGES.find(p => p.id === packageId) || null;
}

module.exports = {
  CHIP_PACKAGES,
  getChipPackage,
};