// 1️⃣ Load environment variables
require('dotenv').config();

// 2️⃣ Import modules
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { getDeals, saveDeals } = require('./utils/storage');
const generateDealId = require('./utils/generateDealId');
const { calculateFee } = require('./services/feeService');
const { wallets, generateWalletAddress } = require('./config/wallets');
const { getAllReviews, addReview, getAverageRating, getTotalReviews } = require('./data/reviews');

function getUserReviews(userId) {
  return getAllReviews().filter(r => r.userId === userId);
}
if (!process.env.ADMIN_ID) {
  console.warn("⚠️ ADMIN_ID is not set in environment variables");
}

// ===== Helper to create file buttons =====
function fileButtons(deal) {
  if (!deal.files || !Array.isArray(deal.files) || deal.files.length === 0) return [];
  return deal.files.map((f, index) => [
    Markup.button.callback(
      `${f.type ? f.type.toUpperCase() : 'FILE'} ${index + 1}`,
      `FILE_${deal.dealId}_${index}`
    )
  ]);
}

// 3️⃣ Create bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// ===== Users registration =====
const usersFile = './data/users.json';
let users = {};
if (fs.existsSync(usersFile)) {
  try { users = JSON.parse(fs.readFileSync(usersFile)); } 
  catch { users = {}; }
}
const saveUsers = () => fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

// ===== User state =====
const userStates = {};
const paymentTimers = {};

// ===== Helper: wait function =====
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ===== START COMMAND / MAIN MENU =====
bot.start(async (ctx) => {
  try {
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
  } catch (err) {
    console.error('Error in /start:', err);
  }
});

// ===== PROFILE =====
bot.action('PROFILE', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const botName = "Sure Deal Escrow";
    const botBio = "🔒 Secure crypto escrow – safe, fast, and reliable.";
    const totalDeals = getDeals().filter(d => d.status === 'completed').length;
    const averageRating = getAverageRating();
    const totalReviews = getTotalReviews();

    const userId = ctx.from.id;
    const reviews = getUserReviews(userId);
    const userDeals = getDeals().filter(d => d.buyer === userId || (users[d.seller] && users[d.seller] === userId)).length;
    const userAvg = reviews.length ? (reviews.reduce((a,b) => a+b.rating,0)/reviews.length).toFixed(1) : 0;

    await ctx.reply(
      `${botName}\n${botBio}\n\n` +
      `Deals Completed (Bot-wide): ${totalDeals}\n` +
      `Average Rating (Bot-wide): ⭐ ${averageRating}/5\n` +
      `Total Reviews (Bot-wide): ${totalReviews}\n\n` +
      `Your Profile:\nTotal Reviews: ${reviews.length}\n` +
      `Average Rating: ⭐ ${userAvg}\n` +
      `Total Deals: ${userDeals}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⭐ View Reviews", callback_data: 'VIEW_REVIEWS' }],
            [{ text: "📊 Deal Statistics", callback_data: 'DEAL_STATS' }]
          ]
        }
      }
    );
  } catch (err) {
    console.error('Error in PROFILE action:', err);
  }
});

// ===== VIEW REVIEWS =====
bot.action('VIEW_REVIEWS', async (ctx) => {
  try {
    const allReviews = getAllReviews();
    const reviewsText = allReviews
      .slice(-10)
      .map(r => `⭐`.repeat(r.rating) + `\n"${r.text}"`)
      .join('\n\n');
    await ctx.reply(`📝 Recent Reviews:\n\n${reviewsText || "No reviews yet."}`);
  } catch (err) {
    console.error('Error in VIEW_REVIEWS:', err);
  }
});

// ===== HELP SYSTEM =====
bot.command('help', async (ctx) => {
  try {
    await ctx.reply(
      "💼 Sure Deal Escrow Help\n\n" +
      "Please describe your issue or provide your Deal ID if relevant.\n" +
      "Your message will be sent directly to our support team.",
      Markup.inlineKeyboard([
        [Markup.button.callback('Submit Query', 'HELP_SUBMIT')]
      ])
    );
  } catch (err) {
    console.error('Error in /help:', err);
  }
});

// ===== HELP / SUPPORT FLOW =====
bot.action('HELP_SUBMIT', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply("📝 Please type your message or Deal ID:");
    userStates[ctx.from.id] = { step: 'awaitingHelpMessage' };
  } catch (err) {
    console.error('Error in HELP_SUBMIT:', err);
  }
});

// ===== CREATE DEAL FLOW =====
bot.action('CREATE_DEAL', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    userStates[ctx.from.id] = {
      step: "awaitingSeller",
      dealData: { buyer: ctx.from.id }
    };
    await ctx.reply(
      "📝 *Create New Deal*\n\nPlease enter the seller's Telegram username.\nExample: @sellerusername",
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error('Error in CREATE_DEAL:', err);
  }
});

// ===== FILE & PAYMENT SCREENSHOT HANDLER =====
bot.on(['document','photo','video','audio','voice'], async (ctx) => {
  try {
    const deals = getDeals();
    const activeDeal = deals.find(
      d => d.buyer === ctx.from.id || (users[d.seller] && users[d.seller] === ctx.from.id)
    );

    if (!activeDeal) return ctx.reply("⚠️ No active deal found.");

    const file = ctx.message.document ||
                 ctx.message.photo?.[ctx.message.photo.length - 1] ||
                 ctx.message.video ||
                 ctx.message.audio ||
                 ctx.message.voice;

    if (!file) return ctx.reply("⚠️ No valid file found.");

    // ===== PAYMENT SCREENSHOT =====
    if (activeDeal.status === "waiting_payment" && ctx.from.id === activeDeal.buyer) {
      activeDeal.screenshotSubmitted = true;
      saveDeals(deals);

      // Notify admin
const adminId = Number(process.env.ADMIN_ID);        // your personal ID
const adminGroupId = Number(process.env.ADMIN_GROUP_ID);  // group ID

// Send the screenshot to the group first for visibility
await ctx.telegram.sendPhoto(
  adminGroupId,
  file.file_id,
  { caption: `📥 Payment Screenshot\nDeal ID: ${activeDeal.dealId}\nUser: ${ctx.from.first_name}` }
);

// Send the admin buttons only to YOU
await ctx.telegram.sendPhoto(
  adminId,
  file.file_id,
  {
    caption: `📥 Payment Screenshot\nDeal ID: ${activeDeal.dealId}\nUser: ${ctx.from.first_name}`,
    ...Markup.inlineKeyboard([
      [Markup.button.callback("✅ Confirm", `ADMIN_CONFIRM_${activeDeal.dealId}`)],
      [Markup.button.callback("❌ Reject", `ADMIN_REJECT_${activeDeal.dealId}`)]
    ])
  }
);

      return ctx.reply("✅ Screenshot received. Waiting for admin verification.");
    }

    // ===== NORMAL FILE SHARING =====
    if (!activeDeal.files) activeDeal.files = [];

    activeDeal.files.push({
      from: ctx.from.id,
      file_id: file.file_id,
      type: ctx.updateType,
      caption: ctx.message.caption || null
    });

    saveDeals(deals);

    const recipientId = ctx.from.id === activeDeal.buyer
      ? users[activeDeal.seller]
      : activeDeal.buyer;

    if (recipientId) {
      switch (ctx.updateType) {
        case 'document':
          await ctx.telegram.sendDocument(recipientId, file.file_id);
          break;
        case 'photo':
          await ctx.telegram.sendPhoto(recipientId, file.file_id);
          break;
        case 'video':
          await ctx.telegram.sendVideo(recipientId, file.file_id);
          break;
        case 'audio':
          await ctx.telegram.sendAudio(recipientId, file.file_id);
          break;
        case 'voice':
          await ctx.telegram.sendVoice(recipientId, file.file_id);
          break;
        default:
          return ctx.reply("⚠️ Unsupported file type.");
      }
      return ctx.reply("✅ File received and forwarded.");
    } else {
      return ctx.reply("⚠️ The other party has not started the bot yet.");
    }

  } catch (err) {
    console.error("Error handling file:", err);
    ctx.reply("❌ Something went wrong while processing your file.");
  }
});

// ===== ADMIN CONFIRM PAYMENT =====
// ===== ADMIN CONFIRM PAYMENT =====
bot.action(/ADMIN_CONFIRM_(.+)/, async (ctx) => {
  try {
    const adminId = Number(process.env.ADMIN_ID);
    if (!adminId || ctx.from.id !== adminId) {
      return ctx.answerCbQuery("❌ Not authorized");
    }

    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);

    if (!deal) return ctx.reply("❌ Deal not found.");

    // ✅ Ensure correct status
    if (deal.status !== 'waiting_payment') {
      return ctx.reply("⚠️ Deal is not awaiting payment.");
    }

    const buyerId = deal.buyer;

    // ✅ FIXED: safe seller resolution (NO fallback to avoid wrong user)
    const sellerKey = deal.seller?.toLowerCase?.() || deal.seller;
    const sellerId = users[sellerKey];

    if (!sellerId) {
      console.error("❌ Seller ID missing for:", deal.seller);
      return ctx.reply("⚠️ Seller has not started the bot. Cannot proceed.");
    }

    // ✅ Mark as paid
    deal.status = 'paid';
    saveDeals(deals);

    // ✅ Notify buyer
    await ctx.telegram.sendMessage(
      buyerId,
      `💰 Payment for Deal ${dealId} has been confirmed by escrow.\n\nThe seller will begin work shortly.`
    );

    // ✅ Notify seller ONLY (FIXED ISSUE)
    await ctx.telegram.sendMessage(
      sellerId,
      `💰 Payment for Deal ${dealId} has been confirmed.\n\nYou can now start work.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 Start Work", callback_data: `START_WORK_${dealId}` }]
          ]
        }
      }
    );

    // ✅ Admin feedback
    await ctx.answerCbQuery("✅ Payment confirmed");
    await ctx.reply(`✅ Deal ${dealId} marked as PAID.\nBuyer & Seller notified.`);

  } catch (err) {
    console.error("Error in ADMIN_CONFIRM:", err);
    ctx.reply("❌ Failed to confirm payment. Please try again.");
  }
});


// ===== ADMIN REJECT PAYMENT =====
bot.action(/ADMIN_REJECT_(.+)/, async (ctx) => {
  try {
    const adminId = Number(process.env.ADMIN_ID);
    if (!adminId || ctx.from.id !== adminId) {
      return ctx.answerCbQuery("❌ Not authorized");
    }

    const dealId = ctx.match[1];
    const deals = getDeals();
    const dealIndex = deals.findIndex(d => d.dealId === dealId);

    if (dealIndex === -1) return ctx.reply("❌ Deal not found.");

    const deal = deals[dealIndex];
    const buyerId = deal.buyer;

    // ✅ FIXED: safe seller resolution
    const sellerKey = deal.seller?.toLowerCase?.() || deal.seller;
    const sellerId = users[sellerKey];

    // ✅ Notify buyer (always)
    await bot.telegram.sendMessage(
      buyerId,
      `⚠️ Payment for Deal ${dealId} was rejected by admin.\n\nPlease provide a valid payment screenshot or retry.`
    );

    // ✅ Notify seller ONLY if exists (prevents crash)
    if (sellerId) {
      await bot.telegram.sendMessage(
        sellerId,
        `❌ Payment for Deal ${dealId} was rejected by admin.\nDeal has been canceled.`
      );
    } else {
      console.warn("Seller not found during reject:", deal.seller);
    }

    // ✅ Remove deal
    deals.splice(dealIndex, 1);
    saveDeals(deals);

    await ctx.answerCbQuery("❌ Payment rejected and deal canceled");

  } catch (err) {
    console.error("Error in ADMIN_REJECT:", err);
    ctx.reply("❌ Failed to reject payment. Please try again.");
  }
});

// ===== PAYMENT METHOD SELECTION =====
bot.action("SELECT_PAYMENT", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    await ctx.reply(
      "Select payment method:",
      Markup.inlineKeyboard([
        [Markup.button.callback("USDT", "PAY_USDT")],
        [Markup.button.callback("BTC", "PAY_BTC")],
        [Markup.button.callback("ETH", "PAY_ETH")],
        [Markup.button.callback("SOL", "PAY_SOL")],
        [Markup.button.callback("LTC", "PAY_LTC")]
      ])
    );

  } catch (err) {
    console.error("Error in SELECT_PAYMENT:", err);
    ctx.reply("❌ Unable to show payment options.");
  }
});

// ===== USDT NETWORK SELECTION =====
bot.action("PAY_USDT", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply(
      "Select USDT network:",
      Markup.inlineKeyboard([
        [Markup.button.callback("TRC20", "NET_USDT_TRC20")],
        [Markup.button.callback("ERC20", "NET_USDT_ERC20")],
        [Markup.button.callback("BEP20", "NET_USDT_BEP20")],
        [Markup.button.callback("SOLANA", "NET_USDT_SOLANA")]
      ])
    );
  } catch (err) {
    console.error("Error in PAY_USDT:", err);
    ctx.reply("❌ Failed to show USDT network options.");
  }
});

bot.action(/NET_USDT_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const network = ctx.match[1];
    const address = wallets.USDT[network];

    if (!address) return ctx.reply("❌ Wallet not configured for this network.");

    await ctx.reply(
      `Send payment to:\n\nUSDT (${network})\n\nAddress:\n${address}\n\nAfter sending payment, upload the transaction screenshot here.`
    );
  } catch (err) {
    console.error("Error in NET_USDT:", err);
    ctx.reply("❌ Failed to process network selection.");
  }
});

// ===== MERGED TEXT HANDLER =====
bot.on('text', async (ctx) => {
  const state = userStates[ctx.from.id];
  const msg = ctx.message.text?.trim();
  if (!msg) return;

  try {
    // ===== 1️⃣ HANDLE HELP MESSAGES =====
    if (state?.step === 'awaitingHelpMessage') {
      const adminId = process.env.ADMIN_ID;
      const fromUser = `@${ctx.from.username || ctx.from.first_name} (ID: ${ctx.from.id})`;

      try {
        await ctx.reply("✅ Your message has been sent to support. They will reply soon.");
        await ctx.telegram.sendMessage(
          adminId,
          `📩 Help request from ${fromUser}\n\nMessage:\n${msg}`
        );
      } catch (err) {
        console.error("Error forwarding help message:", err);
        await ctx.reply("❌ Failed to send message to admin. Try again later.");
      }

      delete userStates[ctx.from.id];
      return;
    }

    // ===== 2️⃣ HANDLE EXTENSION REASON =====
    if (state?.step === 'awaitingExtensionReason') {
      const reason = msg;
      const deals = getDeals();
      const deal = deals.find(d => d.dealId === state.dealId);
      if (!deal) return await ctx.reply("❌ Deal not found.");

      deal.extensionRequested = {
        by: ctx.from.id,
        reason,
        requestedAt: new Date().toISOString()
      };
      saveDeals(deals);

      const buyerId = deal.buyer;
      const sellerUsername = ctx.from.username || ctx.from.first_name;

      try {
        await ctx.telegram.sendMessage(
          buyerId,
          `⏳ Seller (${sellerUsername}) requested a delivery extension for Deal ${deal.dealId}.\n\nReason:\n${reason}\n\nDo you approve the extension?`,
          Markup.inlineKeyboard([
            [Markup.button.callback("✅ Approve Extension", `EXTENSION_APPROVE_${deal.dealId}`)],
            [Markup.button.callback("❌ Decline Extension", `EXTENSION_DECLINE_${deal.dealId}`)]
          ])
        );

        await ctx.reply("✅ Your delivery extension request has been sent to the buyer.");
      } catch (err) {
        console.error("Error sending extension request:", err);
        await ctx.reply("❌ Failed to send extension request. Try again later.");
      }

      delete userStates[ctx.from.id];
      return;
    }

    // ===== 3️⃣ HANDLE REVIEWS =====
    if (state?.step === 'awaitingReview') {
      const deals = getDeals();
      const deal = deals.find(d => d.dealId === state.dealId);
      if (!deal) return await ctx.reply("❌ Deal not found.");

      if (!deal.reviews) deal.reviews = [];
      deal.reviews.push({
        by: ctx.from.id,
        role: state.role,
        rating: state.rating,
        text: msg,
        createdAt: new Date().toISOString()
      });
      saveDeals(deals);

      await ctx.reply("✅ Thank you! Your review has been submitted.");
      delete userStates[ctx.from.id];
      return;
    }

// ===== 4️⃣ DEAL CREATION FLOW =====
if (state?.step === 'awaitingSeller') {
  if (!msg.startsWith("@")) return await ctx.reply("❌ Please enter a valid username starting with @");

  state.dealData.seller = msg;
  state.step = 'awaitingAmount';
  return await ctx.reply("💰 Enter the deal amount (numbers only).\nExample: 50");
}

if (state?.step === 'awaitingAmount') {
  const amount = Number(msg);
  if (isNaN(amount) || amount <= 0) {
    return await ctx.reply("❌ Invalid amount. Enter a valid number.");
  }

  state.dealData.amount = amount;
  state.dealData.currency = "USDT";

  // ✅ ADD THIS PART
  const { fee, sellerReceives } = calculateFee(amount);
  state.dealData.fee = fee;
  state.dealData.sellerReceives = sellerReceives;

  state.step = 'awaitingDescription';
  return await ctx.reply("📝 Enter the project description:");
}

if (state?.step === 'awaitingDescription') {
  state.dealData.description = msg;
  state.step = 'awaitingDeliveryTime';

  return await ctx.reply(
    "⏱ Select delivery time:",
    Markup.inlineKeyboard([
      [Markup.button.callback("1 Day", "TIME_1")],
      [Markup.button.callback("2 Days", "TIME_2")],
      [Markup.button.callback("3 Days", "TIME_3")],
      [Markup.button.callback("5 Days", "TIME_5")],
      [Markup.button.callback("7 Days", "TIME_7")],
      [Markup.button.callback("Custom Time", "TIME_CUSTOM")]
    ])
  );
}


// ✅ ADD THIS RIGHT AFTER (VERY IMPORTANT)

if (state?.step === 'awaitingCustomTime') {
  const days = parseInt(msg);

  if (isNaN(days) || days <= 0) {
    return await ctx.reply("❌ Please enter a valid number of days.");
  }

  state.dealData.deliveryTime = `${days} Day${days > 1 ? "s" : ""}`;
  state.step = "confirmDeal";

  const d = state.dealData;

  return await ctx.reply(
    `✅ *Deal Summary*\n\n` +
    `👤 Seller: ${d.seller}\n` +
    `💰 Amount: ${d.amount} ${d.currency}\n` +
    `📝 Description: ${d.description}\n` +
    `⏱ Delivery: ${d.deliveryTime}\n\n` +
    `Confirm this deal?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Confirm Deal", "CONFIRM_DEAL")],
        [Markup.button.callback("❌ Cancel", "CANCEL_DEAL")]
      ])
    }
  );
}

    // ===== 5️⃣ HANDLE MY DEALS LOOKUP =====
    if (state?.step === 'awaitingDealId') {
      const dealId = msg;
      const deals = getDeals();
      const deal = deals.find(d => d.dealId === dealId);

      if (!deal) {
        delete userStates[ctx.from.id];
        return await ctx.reply("❌ Deal not found.");
      }

      if (ctx.from.id !== deal.buyer && ctx.from.id !== (users[deal.seller] || 0)) {
        delete userStates[ctx.from.id];
        return await ctx.reply("❌ You are not part of this deal.");
      }

      const statusEmoji = deal.status === 'completed' ? '✅' :
                          deal.status === 'waiting_payment' ? '⏳' : '⚠️';

      await ctx.reply(
        `📄 Deal ID: ${deal.dealId}\n` +
        `Buyer: ${deal.buyerUsername || deal.buyer}\n` +
        `Seller: ${deal.sellerUsername || deal.seller}\n` +
        `Status: ${statusEmoji} ${deal.status}\n` +
        `Amount: ${deal.amount} ${deal.currency}`
      );

      delete userStates[ctx.from.id];
      return;
    }

    // ===== 6️⃣ CHAT FLOW =====
    const deals = getDeals();
    const activeDeal = deals.find(
      d => (d.buyer === ctx.from.id || (users[d.seller] && users[d.seller] === ctx.from.id)) &&
           ['pending_seller', 'waiting_payment', 'paid', 'in_progress'].includes(d.status)
    );

    if (!activeDeal) return; // no active deal, ignore

    const recipientId = ctx.from.id === activeDeal.buyer ? users[activeDeal.seller] : activeDeal.buyer;
    if (!recipientId) return await ctx.reply("⚠️ The other party has not started the bot yet.");

    if (!activeDeal.chat) activeDeal.chat = [];
    activeDeal.chat.push({ from: ctx.from.id, message: msg });
    saveDeals(deals);

    try {
      await ctx.telegram.sendMessage(recipientId, `💬 Message from ${ctx.from.first_name}: ${msg}`);
      await ctx.reply("✅ Message sent");
    } catch (err) {
      console.error("Error sending chat message:", err);
      await ctx.reply("❌ Failed to send message. Other party may not have started the bot.");
    }

  } catch (err) {
    console.error("Error in merged text handler:", err);
    // catch-all for deployment safety
    await ctx.reply("❌ An unexpected error occurred. Try again.");
  }
});

// ===== DELIVERY TIME HANDLER =====
bot.action(/TIME_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const state = userStates[ctx.from.id];
    if (!state || !state.dealData || state.step !== "awaitingDeliveryTime") {
      return;
    }

    const selectedRaw = ctx.match[1];

    if (selectedRaw === "CUSTOM") {
      state.step = "awaitingCustomTime";
      return await ctx.reply("✍️ Enter custom delivery time (e.g., 10 Days):");
    }

    const selected = parseInt(selectedRaw);

    if (isNaN(selected)) {
      return await ctx.reply("❌ Invalid delivery time selected.");
    }

    state.dealData.deliveryTime = `${selected} Day${selected > 1 ? "s" : ""}`;
    state.step = "confirmDeal";

    const d = state.dealData;

    await ctx.reply(
      `✅ *Deal Summary*\n\n` +
      `👤 Seller: ${d.seller}\n` +
      `💰 Amount: ${d.amount} ${d.currency}\n` +
      `📝 Description: ${d.description}\n` +
      `⏱ Delivery: ${d.deliveryTime}\n\n` +
      `Confirm this deal?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Confirm Deal", "CONFIRM_DEAL")],
          [Markup.button.callback("❌ Cancel", "CANCEL_DEAL")]
        ])
      }
    );

  } catch (err) {
    console.error("Error in delivery time handler:", err);
    await ctx.reply("❌ Failed to process delivery time. Try again.");
  }
});
// ===== CONFIRM / CANCEL DEAL =====
bot.action('CONFIRM_DEAL', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const state = userStates[ctx.from.id];
    if (!state || !state.dealData) return ctx.reply("❌ No deal to confirm.");

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
  deliveryTime: dealData.deliveryTime, // ✅ ADD THIS
  status: 'pending_seller',
  chat: [],
  files: []
};

    deals.push(newDeal);
    saveDeals(deals);

    await ctx.reply(`✅ Deal Created!\nDeal ID: ${dealId}\nWaiting for seller to accept.`);

    const sellerId = users[dealData.seller];
    if (!sellerId) {
      delete userStates[ctx.from.id];
      return ctx.reply("⚠️ Seller has not started the bot yet. Ask them to /start first.");
    }

    await ctx.telegram.sendMessage(
      sellerId,
      `📢 New Deal Created!\n\nBuyer: @${ctx.from.username}\nProject: ${dealData.description}\nAmount: ${dealData.amount} ${dealData.currency}\nEscrow Fee: ${dealData.fee} ${dealData.currency}\nSeller Receives: ${dealData.sellerReceives} ${dealData.currency}\nDeal ID: ${dealId}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Accept Deal', `ACCEPT_${dealId}`)],
        [Markup.button.callback('❌ Reject Deal', `REJECT_${dealId}`)]
      ])
    );

  } catch (err) {
    console.error("Error confirming deal:", err);
    ctx.reply("❌ Failed to confirm deal. Try again later.");
  } finally {
    delete userStates[ctx.from.id];
  }
});

bot.action('CANCEL_DEAL', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    delete userStates[ctx.from.id];
    ctx.reply("❌ Deal creation canceled.");
  } catch (err) {
    console.error("Error canceling deal:", err);
    ctx.reply("❌ Failed to cancel deal. Try again.");
  }
});


// ===== SELLER ACCEPT DEAL =====
bot.action(/ACCEPT_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);
    if (!deal) return ctx.reply("❌ Deal not found.");

    deal.status = 'waiting_payment';
    saveDeals(deals);

    await ctx.answerCbQuery("✅ Deal accepted!");
    await ctx.reply("You accepted the deal. Waiting for buyer payment...");

    const buyerId = deal.buyer;

    // ===== START 30-MINUTE PAYMENT TIMER =====
if (paymentTimers[dealId]) clearTimeout(paymentTimers[dealId]);

paymentTimers[dealId] = setTimeout(async () => {
  const updatedDeals = getDeals();
  const currentDeal = updatedDeals.find(d => d.dealId === dealId);
  if (!currentDeal) return;

  // Only cancel if payment not made
  if (currentDeal.status === 'waiting_payment') {
    currentDeal.status = 'canceled';
    saveDeals(updatedDeals);

    await bot.telegram.sendMessage(buyerId, `❌ Payment not received within 30 minutes. Deal ${dealId} has been canceled.`);
    const sellerId = users[currentDeal.seller] || currentDeal.seller;
    await bot.telegram.sendMessage(sellerId, `❌ Buyer did not pay within 30 minutes. Deal ${dealId} has been canceled.`);
  }
}, 30 * 60 * 1000); // 30 minutes in ms

    // ===== USDT NETWORK SELECTION =====
    if (deal.currency === 'USDT') {
      await ctx.telegram.sendMessage(
        buyerId,
        "Please select the USDT network:",
        Markup.inlineKeyboard([
          [Markup.button.callback("TRC20", `USDT_NETWORK_TRC20_${dealId}`)],
          [Markup.button.callback("ERC20", `USDT_NETWORK_ERC20_${dealId}`)],
          [Markup.button.callback("BEP20", `USDT_NETWORK_BEP20_${dealId}`)],
          [Markup.button.callback("SOLANA", `USDT_NETWORK_SOLANA_${dealId}`)]
        ])
      );
    } else {
      const networkKey = Object.keys(wallets[deal.currency] || {})[0];
      const walletAddress = wallets[deal.currency]?.[networkKey];
      if (!walletAddress) return ctx.reply("⚠️ Wallet not configured for this currency.");

      await ctx.telegram.sendMessage(
        buyerId,
        `✅ Seller accepted the deal!\n\nSend payment to the escrow wallet below.\n\nDeal ID: ${deal.dealId}\nAmount: ${deal.amount} ${deal.currency}\nEscrow Fee: ${deal.fee} ${deal.currency}\nSeller receives: ${deal.sellerReceives} ${deal.currency}\n\nWallet:\n${walletAddress}\n\nAfter sending payment screenshot, click below:`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Mark as Paid", `PAID_${dealId}`)]
        ])
      );
    }
  } catch (err) {
    console.error("Error in ACCEPT_DEAL:", err);
    ctx.reply("❌ Failed to accept deal. Try again later.");
  }
});

// ===== HANDLE USDT NETWORK SELECTION =====
bot.action(/USDT_NETWORK_(TRC20|ERC20|BEP20|SOLANA)_(.+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const network = ctx.match[1];
    const dealId = ctx.match[2];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);
    if (!deal) return ctx.reply("❌ Deal not found.");

    let walletAddress = generateWalletAddress("USDT", dealId, network);
    if (!walletAddress) return ctx.reply("❌ Failed to generate wallet address. Please try again.");

    const buyerId = deal.buyer;

    await ctx.telegram.sendMessage(
      buyerId,
      `✅ USDT (${network}) Escrow Wallet\n\nDeal ID: ${dealId}\nAmount: ${deal.amount} USDT\nEscrow Fee: ${deal.fee} USDT\nSeller Receives: ${deal.sellerReceives} USDT\n\nSend payment to:\n\`${walletAddress}\`\n\nTap the address to copy.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Mark as Paid", `PAID_${dealId}`)]
        ])
      }
    );
  } catch (err) {
    console.error("Error in USDT_NETWORK handler:", err);
    ctx.reply("❌ Failed to process USDT network selection.");
  }
});

// ===== OTHER CRYPTO PAYMENTS =====
bot.action(/PAY_(BTC|ETH|SOL|LTC)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const currency = ctx.match[1];
    const deals = getDeals();
    const buyerId = ctx.from.id;

    // Use first configured wallet for simplicity
    const networkKey = Object.keys(wallets[currency] || {})[0];
    const walletAddress = wallets[currency]?.[networkKey];
    if (!walletAddress) return ctx.reply("❌ Wallet not configured for this currency.");

    await ctx.reply(
      `✅ ${currency} Escrow Wallet\n\nSend payment to:\n\`${walletAddress}\`\n\nAmount: ${deals.find(d => d.buyer === buyerId)?.amount || "N/A"} ${currency}\nEscrow Fee: ${deals.find(d => d.buyer === buyerId)?.fee || "N/A"} ${currency}\n\nTap the address to copy.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Error in PAY_CRYPTO:", err);
    ctx.reply("❌ Failed to process crypto payment.");
  }
});

bot.action(/PAID_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);
    if (!deal) return ctx.reply("❌ Deal not found.");

    // Disable the inline button immediately
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    // 1️⃣ Ensure screenshot is uploaded first
    if (!deal.screenshotSubmitted) {
      return ctx.reply("⚠️ You must upload a payment screenshot before marking as paid.");
    }

    // 2️⃣ Prevent double marking
    if (deal.status === 'paid') {
      return ctx.reply("ℹ️ Payment already confirmed by admin.");
    }

    // 3️⃣ Mark deal as awaiting admin confirmation (IMPORTANT FIX)
    deal.status = 'waiting_payment';
    saveDeals(deals);

    // 4️⃣ Notify the buyer
    await ctx.reply("⏳ Payment submitted. Waiting for admin confirmation.");

    // 5️⃣ Notify the seller safely (NO start work button here)
    const sellerId = users[deal.seller];

    if (!sellerId) {
      return ctx.reply("⚠️ Seller has not started the bot yet. Ask them to /start first.");
    }

    await ctx.telegram.sendMessage(
      sellerId,
      `💰 Buyer marked payment for Deal ${deal.dealId}.\n\nWaiting for admin confirmation before work starts.`
    );

  } catch (err) {
    console.error("Error in PAID handler:", err);
    ctx.reply("❌ Failed to mark payment. Try again.");
  }
});
// ===== SELLER STARTS WORK =====
bot.action(/START_WORK_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);

    if (!deal) return ctx.reply("❌ Deal not found.");
    if (deal.status !== 'paid') return ctx.reply("⚠️ Payment not confirmed yet.");

    const sellerId = users[deal.seller];
    if (!sellerId) return ctx.reply("⚠️ Seller has not started the bot.");

    const buyerId = deal.buyer;

    // Mark deal as in-progress
    deal.status = 'in_progress';
    saveDeals(deals);

    await ctx.answerCbQuery();

    // Notify buyer
    await bot.telegram.sendMessage(
      buyerId,
      `🟢 Good news! Your seller has started work on Deal ${dealId}.\n⏱ Delivery countdown has started.`
    );

    // Notify seller
    await bot.telegram.sendMessage(
      sellerId,
      "Need more time or ready to deliver?",
      Markup.inlineKeyboard([
        [Markup.button.callback("⏳ Request Extension", `EXTEND_${dealId}`)],
        [Markup.button.callback("📦 Deliver Work", `DELIVER_WORK_${dealId}`)]
      ])
    );

    // ===== DELIVERY COUNTDOWN TIMERS =====
    if (deal.deliveryTime) {
      const deliveryDays = parseInt(deal.deliveryTime.toString().trim());
      if (!isNaN(deliveryDays) && deliveryDays > 0) {
        const deliveryMs = deliveryDays * 24 * 60 * 60 * 1000;

        // Clear existing timers (safe clean)
        if (paymentTimers[dealId]) clearTimeout(paymentTimers[dealId]);
        if (paymentTimers[`${dealId}_24h`]) clearTimeout(paymentTimers[`${dealId}_24h`]);
        if (paymentTimers[`${dealId}_12h`]) clearTimeout(paymentTimers[`${dealId}_12h`]);

        // 24h and 12h reminders
        const reminder24h = deliveryMs - (24 * 60 * 60 * 1000);
        const reminder12h = deliveryMs - (12 * 60 * 60 * 1000);

        if (reminder24h > 0) {
          paymentTimers[`${dealId}_24h`] = setTimeout(async () => {
            try {
              await bot.telegram.sendMessage(buyerId, `⚠️ 24 hours left for Deal ${dealId} delivery!`);
              await bot.telegram.sendMessage(sellerId, `⚠️ 24 hours left to deliver Deal ${dealId}.`);
            } catch (e) {
              console.error("24h reminder error:", e);
            }
          }, reminder24h);
        }

        if (reminder12h > 0) {
          paymentTimers[`${dealId}_12h`] = setTimeout(async () => {
            try {
              await bot.telegram.sendMessage(buyerId, `⚠️ 12 hours left for Deal ${dealId} delivery!`);
              await bot.telegram.sendMessage(sellerId, `⚠️ 12 hours left to deliver Deal ${dealId}.`);
            } catch (e) {
              console.error("12h reminder error:", e);
            }
          }, reminder12h);
        }

        // Final deadline
        paymentTimers[dealId] = setTimeout(async () => {
          try {
            await bot.telegram.sendMessage(buyerId, `⚠️ Delivery time for Deal ${dealId} is over!`);
            await bot.telegram.sendMessage(
              sellerId,
              `⚠️ Delivery time for Deal ${dealId} is over! Please deliver immediately or request admin help.`
            );
          } catch (e) {
            console.error("Final timer error:", e);
          }
        }, deliveryMs);
      } else {
        console.warn(`Invalid deliveryTime for Deal ${dealId}: "${deal.deliveryTime}"`);
      }
    }

  } catch (err) {
    console.error("Error in START_WORK handler:", err);
    ctx.reply("❌ Failed to start work. Please try again.");
  }
});
// ===== SELLER DELIVERS WORK =====
bot.action(/DELIVER_WORK_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);

    if (!deal) return ctx.reply("❌ Deal not found.");
    if (deal.status !== 'in_progress') {
      return ctx.reply("⚠️ Work has not started yet.");
    }

    // ✅ Safe seller ID (FIXED)
    const sellerId = users[deal.seller];
    if (!sellerId) {
      return ctx.reply("⚠️ Seller has not started the bot.");
    }

    const buyerId = deal.buyer;

    deal.status = 'delivered';
    saveDeals(deals);

    // Notify buyer
    await bot.telegram.sendMessage(
      buyerId,
      `📦 Work has been delivered for Deal ${dealId}.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Approve Delivery", `APPROVE_${dealId}`)],
        [Markup.button.callback("⚠️ Open Dispute", `DISPUTE_${dealId}`)]
      ])
    );

    // Notify seller
    await bot.telegram.sendMessage(
      sellerId,
      `✅ You marked the work as delivered for Deal ${dealId}. Waiting for buyer approval.`
    );

  } catch (err) {
    console.error("Error in DELIVER_WORK:", err);
    ctx.reply("❌ Failed to deliver work.");
  }
});

// ===== BUYER APPROVES DELIVERY =====
bot.action(/APPROVE_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);

    if (!deal) return ctx.reply("❌ Deal not found.");
    if (deal.status !== 'delivered') {
      return ctx.reply("⚠️ Work has not been delivered yet.");
    }

    // ✅ Safe seller ID (FIXED)
    const sellerId = users[deal.seller];
    if (!sellerId) {
      return ctx.reply("⚠️ Seller has not started the bot.");
    }

    deal.status = 'completed';
    saveDeals(deals);

    const buyerId = deal.buyer;

    // Notify buyer
    await ctx.telegram.sendMessage(
      buyerId,
      `🎉 Deal ${dealId} completed!`
    );

    // Notify seller
    await ctx.telegram.sendMessage(
      sellerId,
      `🎉 Deal ${dealId} completed!\nYou received ${deal.sellerReceives} ${deal.currency}.`
    );

    // ✅ Safe review prompts (won’t crash if one fails)
    try {
      promptReview(buyerId, dealId, 'buyer');
      promptReview(sellerId, dealId, 'seller');
    } catch (e) {
      console.error("Review prompt error:", e);
    }

  } catch (err) {
    console.error("Error in APPROVE:", err);
    ctx.reply("❌ Failed to approve delivery.");
  }
});


// ===== DISPUTE =====
bot.action(/DISPUTE_(.+)/, async (ctx) => {
  try {
    const dealId = ctx.match[1];
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);

    if (!deal) return ctx.reply("❌ Deal not found.");

    deal.status = 'dispute';
    saveDeals(deals);

    const adminId = process.env.ADMIN_ID;

    await ctx.telegram.sendMessage(
      adminId,
      `⚠️ Dispute opened for Deal ${dealId}`
    );

    await ctx.reply("⚠️ Dispute opened. Admin has been notified.");

  } catch (err) {
    console.error("Error in DISPUTE:", err);
    ctx.reply("❌ Failed to open dispute.");
  }
});


// ===== ADMIN RELEASE =====
bot.command('release', async (ctx) => {
  try {
    const adminId = Number(process.env.ADMIN_ID);
    if (!adminId || ctx.from.id !== adminId) {
      return ctx.reply("❌ Not authorized");
    }

    const args = ctx.message.text.split(' ');
    const dealId = args[1];

    if (!dealId) return ctx.reply("❌ Provide deal ID. Example: /release 12345");

    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);

    if (!deal) return ctx.reply("❌ Deal not found.");

    // ✅ Safe seller ID (FIXED)
    const sellerId = users[deal.seller];
    if (!sellerId) {
      return ctx.reply("⚠️ Seller has not started the bot.");
    }

    const buyerId = deal.buyer;

    deal.status = 'completed';
    saveDeals(deals);

    // Notify buyer
    await ctx.telegram.sendMessage(
      buyerId,
      `🎉 Deal ${dealId} completed!`
    );

    // Notify seller
    await ctx.telegram.sendMessage(
      sellerId,
      `🎉 Deal ${dealId} completed!\nYou received ${deal.sellerReceives} ${deal.currency}.`
    );

    await ctx.reply("✅ Funds released successfully.");

  } catch (err) {
    console.error("Error in ADMIN RELEASE:", err);
    await ctx.reply("❌ Failed to release funds.");
  }
});

// ===== PROMPT REVIEW =====
function promptReview(userId, dealId, role) {
  bot.telegram.sendMessage(
    userId,
    `Leave a review for Deal ${dealId}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("⭐1", `REVIEW_${dealId}_${role}_1`)],
      [Markup.button.callback("⭐2", `REVIEW_${dealId}_${role}_2`)],
      [Markup.button.callback("⭐3", `REVIEW_${dealId}_${role}_3`)],
      [Markup.button.callback("⭐4", `REVIEW_${dealId}_${role}_4`)],
      [Markup.button.callback("⭐5", `REVIEW_${dealId}_${role}_5`)]
    ])
  );
}


// ===== REVIEW HANDLER =====
bot.action(/REVIEW_(.+)_(buyer|seller)_(\d)/, async (ctx) => {
  const dealId = ctx.match[1];
  const role = ctx.match[2];
  const rating = parseInt(ctx.match[3]);

  await ctx.answerCbQuery();
  await ctx.reply("Type your review:");

  userStates[ctx.from.id] = {
    step: 'awaitingReview',
    dealId,
    role,
    rating
  };
});


// ===== FILE SHARING / PAYMENT SCREENSHOT ATTACHMENT =====
bot.action(/FILE_(.+)_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();

  const dealId = ctx.match[1];
  const fileIndex = parseInt(ctx.match[2]);
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");

  const file = deal.files[fileIndex];
  const recipientId = ctx.from.id === deal.buyer ? users[deal.seller] : deal.buyer;

  try {
    // Send the file to recipient
switch (ctx.updateType) {
  case 'document':
    await ctx.telegram.sendDocument(recipientId, file.file_id);
    break;
  case 'photo':
    await ctx.telegram.sendPhoto(recipientId, file.file_id);
    break;
  case 'video':
    await ctx.telegram.sendVideo(recipientId, file.file_id);
    break;
  case 'audio':
    await ctx.telegram.sendAudio(recipientId, file.file_id);
    break;
  case 'voice':
    await ctx.telegram.sendVoice(recipientId, file.file_id);
    break;
  default:
    return ctx.reply("Unsupported file type.");
}

await ctx.reply("✅ File sent.");

  } catch (err) {
    console.error("FILE_SEND_ERROR:", err);
    ctx.reply("❌ Failed to send file.");
  }
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

// ===== RENDER DEPLOYMENT =====
const PORT = process.env.PORT || 3000;

bot.launch({
  webhook: {
    domain: process.env.RENDER_EXTERNAL_URL,
    port: PORT
  }
});

console.log("Bot running with webhook...");