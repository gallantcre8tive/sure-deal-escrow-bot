/**
 * Calculates escrow fee and seller receives amount.
 * Fee is 5% of total amount.
 * Supports BTC, ETH, USDT, etc.
 *
 * @param {number} amount - The total deal amount
 * @returns {Object} - { fee, sellerReceives }
 */
function calculateFee(amount) {
  const numericAmount = Number(amount);

  // Validate input
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return { fee: 0, sellerReceives: 0 };
  }

  const feeRate = 0.05; // 5% escrow fee
  const fee = numericAmount * feeRate;
  const sellerReceives = numericAmount - fee;

  // Round to 8 decimals (safe for crypto)
  return {
    fee: Math.round(fee * 1e8) / 1e8,
    sellerReceives: Math.round(sellerReceives * 1e8) / 1e8,
  };
}

module.exports = { calculateFee };