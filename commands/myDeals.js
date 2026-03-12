const { getDeals, saveDeals } = require("../utils/storage");
const { Markup } = require("telegraf");

const userChatStates = {}; // Track which deal a user is currently chatting in

module.exports = (bot) => {
  // ===== Show deals with buttons =====
  bot.action("MY_DEALS", async (ctx) => {
    await ctx.answerCbQuery();

    const deals = getDeals();
    const userDeals = deals.filter(
      (d) => d.buyer === ctx.from.id || d.seller === ctx.from.id
    );

    if (userDeals.length === 0) return ctx.reply("No deals found.");

    for (const d of userDeals) {
      let msg = `📄 Deal ID: ${d.dealId}\nBuyer: ${d.buyer}\nSeller: ${d.seller}\nAmount: ${d.amount} ${d.currency}\nStatus: ${d.status}\n`;

      const buttons = [];

      // Buyer can mark as paid
      if (ctx.from.id === d.buyer && d.status === "waiting_payment") {
        buttons.push([Markup.button.callback("💰 Mark as Paid", `PAID_${d.dealId}`)]);
      }

      // Chat button
      buttons.push([Markup.button.callback("💬 Chat", `CHAT_${d.dealId}`)]);

      await ctx.reply(msg, Markup.inlineKeyboard(buttons));
    }
  });

  // ===== Start chat for a deal =====
  bot.action(/CHAT_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find((d) => d.dealId === dealId);
    if (!deal) return ctx.reply("Deal not found.");

    // Set the user's chat state
    userChatStates[ctx.from.id] = dealId;
    ctx.reply(
      `💬 You are now chatting in Deal ID: ${dealId}. Send a message and it will be forwarded to the other party.`
    );
  });

  // ===== Handle text messages for chat =====
  bot.on("text", async (ctx) => {
    const dealId = userChatStates[ctx.from.id];
    if (!dealId) return; // Not in chat mode

    const deals = getDeals();
    const deal = deals.find((d) => d.dealId === dealId);
    if (!deal) return ctx.reply("Deal not found.");

    // Determine recipient (use registered users mapping if needed)
    const recipientId =
      ctx.from.id === deal.buyer
        ? deal.seller.startsWith("@")
          ? require("fs")
              .existsSync("./data/users.json") &&
            JSON.parse(require("fs").readFileSync("./data/users.json"))[deal.seller]
          : deal.seller
        : deal.buyer;

    if (!recipientId) return ctx.reply("The other party has not started the bot yet.");

    // Save chat
    deal.chat = deal.chat || [];
    deal.chat.push({ from: ctx.from.id, message: ctx.message.text });
    saveDeals(deals);

    // Forward message
    try {
      await ctx.telegram.sendMessage(
        recipientId,
        `💬 Message from ${ctx.from.first_name}: ${ctx.message.text}`
      );
      ctx.reply("Message sent to the other party ✅");
    } catch (err) {
      ctx.reply("Failed to send message. The other party may not have started the bot.");
    }
  });
};