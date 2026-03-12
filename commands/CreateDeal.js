const { generateDealId } = require("../utils/generateDealId");
const { getDeals, saveDeals } = require("../utils/storage");
const { calculateFee } = require("../services/feeService");
const { Markup } = require("telegraf"); // <- needed

module.exports = (bot, users, userStates) => {
  bot.action("CREATE_DEAL", async (ctx) => {
    await ctx.answerCbQuery();
    userStates[ctx.from.id] = { step: "awaitingSeller", dealData: {} };
    ctx.reply("Enter the seller's username (e.g., @seller):");
  });

  bot.action("CONFIRM_DEAL", async (ctx) => {
    await ctx.answerCbQuery();
    const state = userStates[ctx.from.id];
    if (!state || !state.dealData) return ctx.reply("No deal to confirm.");

    const dealData = state.dealData;
    const dealId = generateDealId();

    const deals = getDeals();
    const newDeal = {
      dealId,
      buyer: ctx.from.id,
      seller: dealData.seller,
      amount: dealData.amount,
      fee: dealData.fee,
      sellerReceives: dealData.sellerReceives,
      currency: dealData.currency,
      status: "pending_seller",
      chat: [],
    };
    deals.push(newDeal);
    saveDeals(deals);

    ctx.reply(`✅ Deal Created! Deal ID: ${dealId}\nWaiting for seller to accept.`);

    // Notify seller
    const sellerId = users[dealData.seller];
    if (!sellerId) {
      delete userStates[ctx.from.id];
      return ctx.reply("⚠️ Seller has not started the bot yet. Ask them to /start first.");
    }

    try {
      await ctx.telegram.sendMessage(
        sellerId,
        `📢 New Deal Created!\nBuyer: @${ctx.from.username}\nAmount: ${dealData.amount} ${dealData.currency}\nFee: ${dealData.fee} ${dealData.currency}\nSeller Receives: ${dealData.sellerReceives} ${dealData.currency}\nDeal ID: ${dealId}`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Accept Deal", `ACCEPT_${dealId}`)],
          [Markup.button.callback("❌ Reject Deal", `REJECT_${dealId}`)],
        ])
      );
    } catch (err) {
      console.log("Could not notify seller:", err);
    }

    delete userStates[ctx.from.id];
  });

  bot.action("CANCEL_DEAL", async (ctx) => {
    await ctx.answerCbQuery();
    const state = userStates[ctx.from.id];
    if (!state || !state.dealData) return ctx.reply("No deal to cancel.");
    delete userStates[ctx.from.id];
    ctx.reply("❌ Deal creation canceled.");
  });
};