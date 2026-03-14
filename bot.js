// 1️⃣ Load environment variables
require('dotenv').config();

// 2️⃣ Import modules
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { getDeals, saveDeals } = require('./utils/storage');
const wallets = require('./config/wallets');
const generateDealId = require('./utils/generateDealId');
const { calculateFee } = require('./services/feeService');
const { getUserReviews, saveUserReview } = require('./services/reviewService');

// ===== Helper to create file buttons =====
function fileButtons(deal) {
  if (!deal.files || deal.files.length === 0) return [];
  return deal.files.map((f, index) => [
    Markup.button.callback(
      `${f.type.toUpperCase()} ${index + 1}`,
      `FILE_${deal.dealId}_${index}`
    )
  ]);
}

// 3️⃣ Create bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== Users registration =====
const usersFile = './data/users.json';
let users = {};
if (fs.existsSync(usersFile)) users = JSON.parse(fs.readFileSync(usersFile));
const saveUsers = () => fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

// ===== User state =====
const userStates = {};
const paymentTimers = {};

// ===== Helper: wait function =====
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ===== START COMMAND / MAIN MENU =====
bot.start(async (ctx) => {
  const username = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name;
  if (!users[username]) {
    users[username] = ctx.from.id;
    saveUsers();
    console.log(`Registered new user: ${username} (${ctx.from.id})`);
  }

  await ctx.reply(
    `Welcome to Sure Deal Escrow, ${ctx.from.first_name}!\n\nChoose an option:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('💼 Create Deal', 'CREATE_DEAL')],
      [Markup.button.callback('📄 My Deals', 'MY_DEALS')],
      [Markup.button.callback('👤 Profile', 'PROFILE')],
      [Markup.button.callback('❓ Help', 'HELP')]
    ])
  );
});

// ===== HELP BUTTON =====
bot.action('HELP', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    "Sure Deal Escrow Bot Help:\n\n" +
    "- 💼 Create Deal: Start a new escrow deal\n" +
    "- 📄 My Deals: View your active deals and chat\n" +
    "- 👤 Profile: See your reviews and completed deals\n" +
    "- ❓ Help: This menu\n" +
    "\nIf payment is not confirmed after 30 minutes, submit your Deal ID via this menu to contact support."
  );
});

// ===== PROFILE BUTTON =====
bot.action('PROFILE', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const reviews = getUserReviews(userId);
  const totalDeals = getDeals().filter(d => d.buyer === userId || users[d.seller] === userId).length;

  if (reviews.length === 0) return ctx.reply(`No reviews yet. Total Deals: ${totalDeals}`);
  const avg = reviews.reduce((a, b) => a + b.rating, 0) / reviews.length;
  ctx.reply(
    `👤 Profile\n\n` +
    `Total Reviews: ${reviews.length}\n` +
    `Average Rating: ${avg.toFixed(1)} ⭐\n` +
    `Total Deals: ${totalDeals}`
  );
});

// ===== CREATE DEAL FLOW =====
bot.action('CREATE_DEAL', async (ctx) => {
  await ctx.answerCbQuery();
  userStates[ctx.from.id] = { step: 'awaitingSeller', dealData: {} };
  ctx.reply("Enter the seller's username (e.g., @seller):");
});

// ===== HANDLE FILES =====
bot.on(['document', 'photo', 'video', 'audio', 'voice'], async (ctx) => {
  const deals = getDeals();
  const activeDeal = deals.find(
    d => (d.buyer === ctx.from.id || users[d.seller] === ctx.from.id) &&
         ['waiting_payment', 'paid', 'in_progress'].includes(d.status)
  );
  if (!activeDeal) return ctx.reply("No active deal for file upload.");

  if (!activeDeal.files) activeDeal.files = [];
  const fileInfo = ctx.message.document || ctx.message.photo?.[ctx.message.photo.length-1] || ctx.message.video || ctx.message.audio || ctx.message.voice;
  activeDeal.files.push({
    from: ctx.from.id,
    file_id: fileInfo.file_id,
    type: ctx.updateType,
    caption: ctx.message.caption || null
  });
  saveDeals(deals);

  const recipientId = ctx.from.id === activeDeal.buyer ? users[activeDeal.seller] : activeDeal.buyer;

  try {
    await ctx.telegram.sendMessage(recipientId, `📂 ${ctx.from.first_name} sent a file for Deal ID: ${activeDeal.dealId}`);
  } catch (err) {
    console.log("Error sending file notification:", err);
  }

  await ctx.reply("✅ File received and forwarded to the other party.");
});

// ===== HANDLE TEXT INPUT =====
bot.on('text', async (ctx) => {
  const state = userStates[ctx.from.id];
  const msg = ctx.message.text.trim();

  // ===== Deal Creation Flow =====
  if (state && state.step) {
    const dealData = state.dealData;

    if (state.step === 'awaitingSeller') {
      dealData.seller = msg;
      state.step = 'awaitingDescription';
      return ctx.reply("Enter the project description for this deal:");
    }

    if (state.step === 'awaitingDescription') {
      dealData.description = msg;
      state.step = 'awaitingAmountCurrency';
      return ctx.reply("Enter the deal amount and currency (e.g., 50 USDT):");
    }

    if (state.step === 'awaitingAmountCurrency') {
      const parts = msg.split(' ');
      if (parts.length !== 2) return ctx.reply("Format: <amount> <currency> (e.g., 50 USDT)");

      const amount = Number(parts[0]);
      const currency = parts[1].toUpperCase();
      if (isNaN(amount) || amount <= 0) return ctx.reply("Invalid amount.");
      const supportedCurrencies = ['USDT','BTC','ETH'];
      if (!supportedCurrencies.includes(currency)) {
        return ctx.reply("Currency not supported.");
      }

      const { fee, sellerReceives } = calculateFee(amount);
      dealData.amount = amount;
      dealData.currency = currency;
      dealData.fee = fee;
      dealData.sellerReceives = sellerReceives;
      state.step = 'confirmDeal';

      return ctx.reply(
        `✅ Deal Summary:\n\n` +
        `Seller: ${dealData.seller}\n` +
        `Project: ${dealData.description}\n` +
        `Amount: ${amount} ${currency}\n` +
        `Escrow Fee (5%): ${fee} ${currency}\n` +
        `Seller Receives: ${sellerReceives} ${currency}\n\n` +
        `Confirm deal?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Confirm Deal', 'CONFIRM_DEAL')],
          [Markup.button.callback('❌ Cancel', 'CANCEL_DEAL')]
        ])
      );
    }
    return;
  }

  // ===== CHAT FLOW =====
  const deals = getDeals();
  const activeDeal = deals.find(
    d => (d.buyer === ctx.from.id || users[d.seller] === ctx.from.id) &&
    ['pending_seller', 'waiting_payment', 'paid', 'in_progress'].includes(d.status)
  );

  if (activeDeal) {
    const recipientId = ctx.from.id === activeDeal.buyer ? users[activeDeal.seller] : activeDeal.buyer;
    if (!recipientId) return ctx.reply("The other party has not started the bot yet.");

    if (!activeDeal.chat) activeDeal.chat = [];
    activeDeal.chat.push({ from: ctx.from.id, message: msg });
    saveDeals(deals);

    try {
      await ctx.telegram.sendMessage(recipientId, `💬 Message from ${ctx.from.first_name}: ${msg}`);
      ctx.reply("Message sent ✅");
    } catch (err) {
      ctx.reply("Failed to send message. Other party may not have started the bot.");
    }
  }
});

// ===== CONFIRM / CANCEL DEAL =====
bot.action('CONFIRM_DEAL', async (ctx) => {
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
    description: dealData.description,
    amount: dealData.amount,
    fee: dealData.fee,
    sellerReceives: dealData.sellerReceives,
    currency: dealData.currency,
    status: 'pending_seller',
    chat: [],
    files: []
  };
  deals.push(newDeal);
  saveDeals(deals);

  ctx.reply(`✅ Deal Created! Deal ID: ${dealId}\nWaiting for seller to accept.`);

  const sellerId = users[dealData.seller];
  if (!sellerId) {
    delete userStates[ctx.from.id];
    return ctx.reply("⚠️ Seller has not started the bot yet. Ask them to /start first.");
  }

  try {
    await ctx.telegram.sendMessage(
      sellerId,
      `📢 New Deal Created!\nBuyer: @${ctx.from.username}\nProject: ${dealData.description}\nAmount: ${dealData.amount} ${dealData.currency}\nFee: ${dealData.fee} ${dealData.currency}\nSeller Receives: ${dealData.sellerReceives} ${dealData.currency}\nDeal ID: ${dealId}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Accept Deal', `ACCEPT_${dealId}`)],
        [Markup.button.callback('❌ Reject Deal', `REJECT_${dealId}`)]
      ])
    );
  } catch (err) {
    console.log("Could not notify seller:", err);
  }

  delete userStates[ctx.from.id];
});

bot.action('CANCEL_DEAL', async (ctx) => {
  await ctx.answerCbQuery();
  const state = userStates[ctx.from.id];
  if (!state || !state.dealData) return ctx.reply("No deal to cancel.");
  delete userStates[ctx.from.id];
  ctx.reply("❌ Deal creation canceled.");
});

// ===== SELLER ACCEPT =====
bot.action(/ACCEPT_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");

  // Update deal status
  deal.status = 'waiting_payment';
  saveDeals(deals);

  await ctx.answerCbQuery("Deal accepted!");
  await ctx.reply("You accepted the deal. Waiting for buyer payment...");

  const buyerId = deal.buyer;
  const walletAddress = wallets(deal.currency, deal.dealId);

  try {
    await ctx.telegram.sendMessage(
      buyerId,
      `✅ Seller accepted the deal!\n\n` +
      `Send payment to the escrow wallet below.\n\n` +
      `Deal ID: ${deal.dealId}\n` +
      `Amount: ${deal.amount} ${deal.currency}\n` +
      `Escrow Fee: ${deal.fee} ${deal.currency}\n` +
      `Seller receives: ${deal.sellerReceives} ${deal.currency}\n\n` +
      `Escrow Wallet:\n${walletAddress}\n\n` +
      `After sending payment screenshot, click "Mark as Paid".\n` +
      `You have 30 minutes to complete payment.`
    );
  } catch (err) {
    console.log("Error sending payment instructions:", err);
  }

  // Start 30-min reminder
  if (paymentTimers[dealId]) clearTimeout(paymentTimers[dealId]);
  paymentTimers[dealId] = setTimeout(async () => {
    const currentDeals = getDeals();
    const updatedDeal = currentDeals.find(d => d.dealId === dealId);
    if (updatedDeal && updatedDeal.status === 'waiting_payment') {
      try {
        await ctx.telegram.sendMessage(
          buyerId,
          `⚠️ Payment not confirmed within 30 minutes. Please mark as paid or contact support via /help with your Deal ID: ${dealId}`
        );
      } catch (err) {
        console.log("Error sending 30-min reminder:", err);
      }
    }
  }, 30 * 60 * 1000);
});

// ===== REJECT DEAL =====
bot.action(/REJECT_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deals = getDeals();
  const index = deals.findIndex(d => d.dealId === dealId);
  if (index === -1) return ctx.reply("Deal not found.");
  const deal = deals[index];
  deals.splice(index, 1);
  saveDeals(deals);
  await ctx.answerCbQuery("Deal rejected.");
  ctx.reply("You rejected the deal.");
  try { await ctx.telegram.sendMessage(deal.buyer, `Seller rejected your deal (ID: ${dealId}).`); } catch {}
});

// ===== BUYER MARKS PAID =====
bot.action(/PAID_(.+)/, async (ctx) => {
  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'paid';
  saveDeals(deals);
  await ctx.answerCbQuery("Payment marked as sent.");
  ctx.reply("Payment marked as sent. Waiting for admin release.");
});

// ===== ADMIN RELEASE =====
bot.command('release', async (ctx) => {
  if (ctx.from.id != process.env.ADMIN_ID) return;
  const args = ctx.message.text.split(' ');
  const dealId = args[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'completed';
  saveDeals(deals);
  ctx.reply(`Deal ${dealId} released.`);

  try {
    const sellerId = users[deal.seller] || deal.seller;
    await ctx.telegram.sendMessage(deal.buyer, `🎉 Deal ${dealId} completed!`);
    await ctx.telegram.sendMessage(sellerId, `🎉 Deal ${dealId} completed! You received ${deal.sellerReceives} ${deal.currency}.`);
  } catch (err) {}
});

// ===== MY DEALS =====
bot.action('MY_DEALS', async (ctx) => {
  await ctx.answerCbQuery();
  const deals = getDeals();
  const userDeals = deals.filter(d => d.buyer === ctx.from.id || users[d.seller] === ctx.from.id);
  if (!userDeals.length) return ctx.reply("No deals found.");

  for (const d of userDeals) {
    const buttons = [];
    if (ctx.from.id === d.buyer && d.status === 'waiting_payment') {
      buttons.push([Markup.button.callback('💰 Mark as Paid', `PAID_${d.dealId}`)]);
    }
    buttons.push([Markup.button.callback('💬 Chat', `CHAT_${d.dealId}`)]);
    if (d.files && d.files.length > 0) {
      buttons.push(...fileButtons(d));
    }

    await ctx.reply(
      `Deal ID: ${d.dealId}\nBuyer: ${d.buyer}\nSeller: ${d.seller}\nAmount: ${d.amount} ${d.currency}\nStatus: ${d.status}\nProject: ${d.description}`,
      Markup.inlineKeyboard(buttons)
    );
  }
});

// ===== HANDLE FILE BUTTON CLICK =====
bot.action(/FILE_(.+)_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const dealId = ctx.match[1];
  const fileIndex = parseInt(ctx.match[2]);
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");
  if (!deal.files || !deal.files[fileIndex]) return ctx.reply("File not found.");

  const file = deal.files[fileIndex];
  const recipientId = ctx.from.id === deal.buyer ? users[deal.seller] : deal.buyer;
  if (!recipientId) return ctx.reply("Other party has not started the bot yet.");

  try {
    switch (file.type) {
      case 'document': await ctx.telegram.sendDocument(recipientId, file.file_id, { caption: file.caption || '' }); break;
      case 'photo': await ctx.telegram.sendPhoto(recipientId, file.file_id, { caption: file.caption || '' }); break;
      case 'video': await ctx.telegram.sendVideo(recipientId, file.file_id, { caption: file.caption || '' }); break;
      case 'audio': await ctx.telegram.sendAudio(recipientId, file.file_id, { caption: file.caption || '' }); break;
      case 'voice': await ctx.telegram.sendVoice(recipientId, file.file_id, { caption: file.caption || '' }); break;
      default: ctx.reply("Unknown file type."); return;
    }
    ctx.reply("✅ File sent to the other party.");
  } catch (err) {
    console.log("Error sending file:", err);
    ctx.reply("Failed to send the file.");
  }
});

// ===== START BOT ON RENDER (WEBHOOK) =====
const PORT = process.env.PORT || 3000;
bot.launch({
  webhook: {
    domain: process.env.RENDER_EXTERNAL_URL,
    port: PORT
  }
});
console.log("Bot running with webhook...");