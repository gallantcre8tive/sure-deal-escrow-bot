const crypto = require("crypto");

// Base wallet addresses for each currency
const baseWallets = {
  USDT: "4H5c9hPyfqNcc5MhDyDXySDcAX26hwmFN6b5RRqmit5L",
  BTC: "bc1q830vrunneuthylm6jy4akn624vqhestu22s9d9",
  ETH: "0x751B9DdB0a14aeb7607C4CAc0D7F9c5266ADA39E",
};

// Generate unique wallet per deal
function getWallet(currency, dealId) {
  if (!baseWallets[currency]) throw new Error("Currency not supported");
  const uniqueSuffix = crypto.createHash("sha256").update(dealId).digest("hex").slice(0, 8);
  return `${baseWallets[currency]}_${uniqueSuffix}`;
}

module.exports = getWallet;