require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const { getDeals, saveDeals } = require("./utils/storage");
const wallets = require("./config/wallets");
const generateDealId = require("./utils/generateDealId");
const { calculateFee } = require("./services/feeService");
const { getUserReviews } = require("./services/reviewService");

const bot = new Telegraf(process.env.BOT_TOKEN);
const userStates = {}; // Track deal creation or chat states

// ===== Users registration =====
const usersFile = "./data/users.json";
let users = {};
if (fs.existsSync(usersFile)) {
  users = JSON.parse(fs.readFileSync(usersFile));
}
const saveUsers = () =>
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

// ===== Start Command / Main Menu =====
bot.start(async (ctx) => {
  const username = ctx.from.username ? "@" + ctx.from.username : ctx.from.first_name;
  if (!users[username]) {
    users[username] = ctx.from.id;
    saveUsers();
    console.log(`Registered new user: ${username} (${ctx.from.id})`);
  }

  await ctx.reply(
    `Welcome to Sure Deal Escrow, ${ctx.from.first_name}!\n\nChoose an option:`,
    Markup.inlineKeyboard([
      [Markup.button.callback("💼 Create Deal", "CREATE_DEAL")],
      [Markup.button.callback("📄 My Deals", "MY_DEALS")],
      [Markup.button.callback("👤 Profile", "PROFILE")],
      [Markup.button.callback("❓ Help", "HELP")],
    ])
  );
});

// ===== Help =====
bot.action("HELP", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    "Sure Deal Escrow Bot Help:\n\n" +
      "- 💼 Create Deal: Start a new escrow deal\n" +
      "- 📄 My Deals: View your active deals\n" +
      "- 👤 Profile: Check your reputation\n" +
      "- ❓ Help: This menu\n" +
      "- 💬 Chat: Send messages to the other party within a deal"
  );
});

// ===== Profile =====
bot.action("PROFILE", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const reviews = getUserReviews(userId);
  if (reviews.length === 0) return ctx.reply("No reviews yet.");
  const avg = reviews.reduce((a, b) => a + b.rating, 0) / reviews.length;
  ctx.reply(`👤 Reputation\n\nTotal Reviews: ${reviews.length}\nAverage Rating: ${avg.toFixed(1)} ⭐`);
});

// ===== Create Deal =====
bot.action("CREATE_DEAL", async (ctx) => {
  await ctx.answerCbQuery();
  userStates[ctx.from.id] = { step: "awaitingSeller", dealData: {} };
  ctx.reply("Enter the seller's username (e.g., @seller):");
});

// ===== Handle Text Input for Deal & Chat =====
bot.on("text", async (ctx) => {
  const state = userStates[ctx.from.id];
  const msg = ctx.message.text.trim();

  // ===== Deal creation steps =====
  if (state && state.step) {
    const dealData = state.dealData;

    // Step 1: seller
    if (state.step === "awaitingSeller") {
      dealData.seller = msg;
      state.step = "awaitingAmountCurrency";
      return ctx.reply("Enter the deal amount and currency (e.g., 2 BTC, 100 USDT):");
    }

    // Step 2: amount + currency
    if (state.step === "awaitingAmountCurrency") {
      const parts = msg.split(" ");
      if (parts.length !== 2) return ctx.reply("Enter in format: <amount> <currency> (e.g., 2 BTC)");

      const amount = Number(parts[0]);
      const currency = parts[1].toUpperCase();

      if (isNaN(amount) || amount <= 0) return ctx.reply("Invalid amount. Enter a valid number:");
      if (!wallets[currency]) return ctx.reply("Currency not supported. Try USDT, BTC, ETH, etc.");

      // Calculate fee and seller receives
      const { fee, sellerReceives } = calculateFee(amount);

      // Save deal data temporarily
      dealData.amount = amount;
      dealData.currency = currency;
      dealData.fee = fee;
      dealData.sellerReceives = sellerReceives;

      state.step = "confirmDeal";

      // Show confirmation message with buttons
      return ctx.reply(
        `✅ Deal Summary:\n\n` +
          `Seller: ${dealData.seller}\n` +
          `Amount: ${amount} ${currency}\n` +
          `Escrow Fee (5%): ${fee} ${currency}\n` +
          `Seller Receives: ${sellerReceives} ${currency}\n\n` +
          `Do you want to create this deal?`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Confirm Deal", "CONFIRM_DEAL")],
          [Markup.button.callback("❌ Cancel", "CANCEL_DEAL")]
        ])
      );
    }

    return;
  }

  // ===== Chat between buyer and seller =====
  const deals = getDeals();
  const activeDeal = deals.find(
    (d) =>
      (d.buyer === ctx.from.id || users[d.seller] === ctx.from.id) &&
      ["pending_seller", "waiting_payment", "paid"].includes(d.status)
  );

  if (activeDeal) {
    const recipientId = ctx.from.id === activeDeal.buyer ? users[activeDeal.seller] : activeDeal.buyer;
    if (!recipientId) return ctx.reply("The other party has not started the bot yet.");
    activeDeal.chat.push({ from: ctx.from.id, message: msg });
    saveDeals(deals);

    try {
      await ctx.telegram.sendMessage(recipientId, `💬 Message from ${ctx.from.first_name}: ${msg}`);
      ctx.reply("Message sent to the other party ✅");
    } catch (err) {
      ctx.reply("Failed to send message. The other party may not have started the bot.");
    }
  }
});

// ===== Confirm / Cancel Deal =====
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

// ===== Seller Accept/Reject Deal =====
bot.action(/ACCEPT_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find((d) => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");

  deal.status = "waiting_payment";
  saveDeals(deals);

  ctx.answerCbQuery("Deal accepted!");
  ctx.reply("You accepted the deal. Waiting for buyer payment...");

  try {
    await ctx.telegram.sendMessage(deal.buyer, `Seller has accepted your deal! Please send the payment to escrow.`);
  } catch (err) {}
});

bot.action(/REJECT_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deals = getDeals();
  const index = deals.findIndex((d) => d.dealId === dealId);
  if (index === -1) return ctx.reply("Deal not found.");
  const deal = deals[index];
  deals.splice(index, 1);
  saveDeals(deals);
  ctx.answerCbQuery("Deal rejected.");
  ctx.reply("You rejected the deal.");
  try {
    await ctx.telegram.sendMessage(deal.buyer, `Seller rejected your deal (ID: ${dealId}).`);
  } catch (err) {}
});

// ===== Buyer Marks as Paid =====
bot.action(/PAID_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find((d) => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");
  deal.status = "paid";
  saveDeals(deals);

  ctx.answerCbQuery("Payment marked as sent.");
  ctx.reply("Payment marked as sent. Waiting for admin release.");

  try {
    const sellerId = users[deal.seller] || deal.seller;
    await ctx.telegram.sendMessage(sellerId, `Buyer has sent payment for Deal ID: ${dealId}. Waiting for admin release.`);
  } catch (err) {}
});

// ===== Admin Release =====
bot.command("release", (ctx) => {
  if (ctx.from.id != process.env.ADMIN_ID) return;
  const args = ctx.message.text.split(" ");
  const dealId = args[1];
  const deals = getDeals();
  const deal = deals.find((d) => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");

  deal.status = "completed";
  saveDeals(deals);
  ctx.reply(`Deal ${dealId} released.`);

  try {
    const sellerId = users[deal.seller] || deal.seller;
    ctx.telegram.sendMessage(deal.buyer, `Deal ${dealId} completed!`);
    ctx.telegram.sendMessage(sellerId, `Deal ${dealId} completed! You received ${deal.sellerReceives} ${deal.currency}.`);
  } catch (err) {}
});

// ===== My Deals with Buttons =====
bot.action("MY_DEALS", async (ctx) => {
  await ctx.answerCbQuery();
  const deals = getDeals();
  const userDeals = deals.filter((d) => d.buyer === ctx.from.id || users[d.seller] === ctx.from.id);
  if (userDeals.length === 0) return ctx.reply("No deals found.");

  for (const d of userDeals) {
    let msg = `Deal ID: ${d.dealId}\nBuyer: ${d.buyer}\nSeller: ${d.seller}\nAmount: ${d.amount} ${d.currency}\nStatus: ${d.status}\n`;
    let buttons = [];
    if (ctx.from.id === d.buyer && d.status === "waiting_payment") {
      buttons.push([Markup.button.callback("💰 Mark as Paid", `PAID_${d.dealId}`)]);
    }
    buttons.push([Markup.button.callback("💬 Chat", `CHAT_${d.dealId}`)]);
    await ctx.reply(msg, Markup.inlineKeyboard(buttons));
  }
});

// ===== Launch Bot =====
bot.launch();
console.log("Sure Deal Escrow Bot Running...");