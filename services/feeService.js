/**
 * Calculates escrow fee and seller receives amount
 * Fee = 5% of total amount
 */
function calculateFee(amount) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) return { fee: 0, sellerReceives: 0 };

  const feeRate = 0.05;
  const fee = numericAmount * feeRate;
  const sellerReceives = numericAmount - fee;

  return {
    fee: Math.round(fee * 1e8) / 1e8,
    sellerReceives: Math.round(sellerReceives * 1e8) / 1e8,
  };
}

module.exports = { calculateFee };