const crypto = require("crypto");

// Base wallet addresses for each currency
const baseWallets = {
  USDT: "4H5c9hPyfqNcc5MhDyDXySDcAX26hwmFN6b5RRqmit5L",
  BTC: "bc1q830vrunneuthylm6jy4akn624vqhestu22s9d9",
  ETH: "0x751B9DdB0a14aeb7607C4CAc0D7F9c5266ADA39E",
};

// Normalize currency input (handles "50 USDT", "usdt", etc.)
function normalizeCurrency(input) {
  if (!input) return null;

  // Convert to string and split if amount is included
  const parts = String(input).trim().split(" ");

  // If user passed "50 USDT"
  if (parts.length === 2) {
    return parts[1].toUpperCase();
  }

  // If only "usdt"
  return parts[0].toUpperCase();
}

// Generate unique wallet per deal
function getWallet(currencyInput, dealId) {
  const currency = normalizeCurrency(currencyInput);

  if (!baseWallets[currency]) {
    throw new Error(`Currency not supported: ${currency}`);
  }

  const uniqueSuffix = crypto
    .createHash("sha256")
    .update(dealId)
    .digest("hex")
    .slice(0, 8);

  return `${baseWallets[currency]}_${uniqueSuffix}`;
}

module.exports = getWallet;