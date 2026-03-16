// ===== WALLET DATABASE =====

const wallets = {

  USDT: {
    TRC20: "TBxEn1jr6QnpogBsSvKM8yFAvEZioZfmYa",
    ERC20: "0x751B9DdB0a14aeb7607C4CAc0D7F9c5266ADA39E",
    BEP20: "0x751B9DdB0a14aeb7607C4CAc0D7F9c5266ADA39E",
    SOLANA: "4H5c9hPyfqNcc5MhDyDXySDcAX26hwmFN6b5RRqmit5L"
  },

  BTC: {
    BTC: "bc1q830vrunneuthylm6jy4akn624vqhestu22s9d9"
  },

  ETH: {
    ERC20: "0x751B9DdB0a14aeb7607C4CAc0D7F9c5266ADA39E"
  },

  SOL: {
    SOLANA: "4H5c9hPyfqNcc5MhDyDXySDcAX26hwmFN6b5RRqmit5L"
  },

  LTC: {
    LTC: "ltc1qqcrzru4tgqt4w5ea5a0x0s8ntlnwacs9paaaxy"
  }

};

// ===== GENERATE WALLET ADDRESS =====
function generateWalletAddress(currency, dealId, network = null) {

  let baseAddress;

  if (currency === "USDT") {

    if (!network || !wallets.USDT[network]) {
      throw new Error("USDT network not supported");
    }

    baseAddress = wallets.USDT[network];

  } else {

    if (!wallets[currency]) {
      throw new Error("Currency not supported");
    }

    const networkKey = Object.keys(wallets[currency])[0];
    baseAddress = wallets[currency][networkKey];

  }

  return baseAddress;

}

module.exports = {
  wallets,
  generateWalletAddress
};