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

/**
 * Generate deal-specific wallet address
 * @param {string} currency - USDT/BTC/ETH/SOL/LTC
 * @param {string} dealId - unique deal ID
 * @param {string} network - optional network for USDT
 * @returns {string} address including deal memo/tag
 */
function generateWalletAddress(currency, dealId, network = null) {
  if (!WALLET_ADDRESSES[currency]) throw new Error('Currency not supported');

  let baseAddress;
  if (currency === 'USDT') {
    if (!network || !WALLET_ADDRESSES.USDT[network])
      throw new Error('USDT network not supported');
    baseAddress = WALLET_ADDRESSES.USDT[network];
    return `${baseAddress}?memo=${dealId}`; // memo/tag for traceability
  } else {
    baseAddress = WALLET_ADDRESSES[currency][currency];
    return `${baseAddress}?memo=${dealId}`;
  }
}

module.exports = generateWalletAddress;