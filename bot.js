// 1️⃣ Load environment variables
require('dotenv').config();

// 2️⃣ Import modules
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { getDeals, saveDeals } = require('./utils/storage');
const address = wallets.USDT[network]; // network must be defined
const generateDealId = require('./utils/generateDealId');
const { calculateFee } = require('./services/feeService');
const { getAllReviews, addReview, getAverageRating, getTotalReviews } = require('./data/reviews');
function getUserReviews(userId) {
  return getAllReviews().filter(r => r.userId === userId);
}
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

bot.action('PROFILE', async (ctx) => {
  await ctx.answerCbQuery();

  // ===== Bot Info =====
  const botName = "Sure Deal Escrow";
  const botBio = "🔒 Secure crypto escrow – safe, fast, and reliable.";
  function getTotalDealsCompleted() {
  return getDeals().filter(d => d.status === 'completed').length;
}
  const averageRating = getAverageRating();
  const totalReviews = getTotalReviews();

  // ===== User Info =====
  const userId = ctx.from.id;
  const reviews = getUserReviews(userId);
  const userDeals = getDeals().filter(d => d.buyer === userId || users[d.seller] === userId).length;
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
});

// ===== VIEW REVIEWS BUTTON =====
bot.action('VIEW_REVIEWS', async (ctx) => {
  const allReviews = getAllReviews();

  // Show last 10 reviews for simplicity
  const reviewsText = allReviews.slice(-10).map(r => `⭐`.repeat(r.rating) + `\n"${r.text}"`).join('\n\n');

  await ctx.reply(`📝 Recent Reviews:\n\n${reviewsText}`);
});

// ===== HELP SYSTEM =====
bot.command('help', async (ctx) => {
  await ctx.reply(
    "💼 Sure Deal Escrow Help\n\n" +
    "Please describe your issue or provide your Deal ID if relevant.\n" +
    "Your message will be sent directly to our support team.",
    Markup.inlineKeyboard([
      [Markup.button.callback('Submit Query', 'HELP_SUBMIT')]
    ])
  );
});

// ===== HELP / SUPPORT FLOW =====
bot.action('HELP_SUBMIT', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("📝 Please type your message or Deal ID:");

  // Set user state so main bot.on('text') can handle the next message
  userStates[ctx.from.id] = { step: 'awaitingHelpMessage' };
});

// ===== HANDLE HELP MESSAGES =====
if (state?.step === 'awaitingHelpMessage') {
  const adminId = process.env.ADMIN_ID;
  const userMsg = msg;
  const fromUser = `@${ctx.from.username || ctx.from.first_name} (ID: ${ctx.from.id})`;

  try {
    await ctx.reply("✅ Your message has been sent to support. They will reply soon.");
    await ctx.telegram.sendMessage(
      adminId,
      `📩 Help request from ${fromUser}\n\nMessage:\n${userMsg}`
    );
  } catch (err) {
    console.log("Error forwarding help message:", err);
    await ctx.reply("❌ Failed to send message to admin. Try again later.");
  }

  delete userStates[ctx.from.id]; // clear the state
  return;
}


// ===== CREATE DEAL FLOW =====
bot.action('CREATE_DEAL', async (ctx) => {
  await ctx.answerCbQuery();
  userStates[ctx.from.id] = { step: 'awaitingSeller', dealData: {} };
  ctx.reply("Enter the seller's username (e.g., @seller):");
});

// ===== HANDLE FILES (SECURE VERSION) =====
bot.on(['document','photo','video','audio','voice'], async (ctx) => {

  const deals = getDeals();

  const activeDeal = deals.find(
    d => (d.buyer === ctx.from.id || users[d.seller] === ctx.from.id)
  );

  if (!activeDeal) {
    return ctx.reply("No active deal found.");
  }

  const file =
    ctx.message.document ||
    ctx.message.photo?.[ctx.message.photo.length - 1] ||
    ctx.message.video ||
    ctx.message.audio ||
    ctx.message.voice;

  // ===== PAYMENT SCREENSHOT FLOW =====
  if (activeDeal.status === "waiting_payment" && ctx.from.id === activeDeal.buyer) {

    // prevent screenshot spam
    if (activeDeal.screenshotSubmitted) {
      return ctx.reply("⚠️ Payment screenshot already submitted. Please wait for escrow confirmation.");
    }

    activeDeal.screenshotSubmitted = true;
    saveDeals(deals);

    await ctx.reply("⏳ Payment proof received. Please hold on while we confirm the transaction.");

    const adminId = process.env.ADMIN_ID;

    try {

      await ctx.telegram.sendPhoto(
        adminId,
        file.file_id,
        {
          caption:
`💰 PAYMENT PROOF RECEIVED

Deal ID: ${activeDeal.dealId}

Buyer: ${ctx.from.username || ctx.from.first_name}

Seller: ${activeDeal.seller}

Amount: ${activeDeal.amount} ${activeDeal.currency}`,
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback("✅ Confirm Payment", `ADMIN_CONFIRM_${activeDeal.dealId}`)
            ],
            [
              Markup.button.callback("⏳ Not Yet Received", `ADMIN_REJECT_${activeDeal.dealId}`)
            ]
          ])
        }
      );

    } catch (err) {
      console.log("Error sending screenshot to admin:", err);
    }

    return;
  }

  // ===== NORMAL FILE SHARING =====
  if (["paid","in_progress"].includes(activeDeal.status)) {

    if (!activeDeal.files) activeDeal.files = [];

    activeDeal.files.push({
      from: ctx.from.id,
      file_id: file.file_id,
      type: ctx.updateType,
      caption: ctx.message.caption || null
    });

    saveDeals(deals);

    const recipientId =
      ctx.from.id === activeDeal.buyer
        ? users[activeDeal.seller]
        : activeDeal.buyer;

    try {
      await ctx.telegram.sendMessage(
        recipientId,
        `📂 ${ctx.from.first_name} sent a file for Deal ID: ${activeDeal.dealId}`
      );
    } catch (err) {
      console.log(err);
    }

    await ctx.reply("✅ File received and forwarded to the other party.");
  }

});

// ===== ADMIN CONFIRM PAYMENT =====
bot.action(/ADMIN_CONFIRM_(.+)/, async (ctx) => {

if (ctx.from.id !== Number(process.env.ADMIN_ID)) {
  return ctx.answerCbQuery("Not authorized");
}

  const dealId = ctx.match[1];

  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = "paid";
  saveDeals(deals);

  await ctx.answerCbQuery("Payment confirmed");

  const sellerId = users[deal.seller];

  try {

    await ctx.telegram.sendMessage(
      sellerId,
      `✅ Payment has been confirmed by escrow.

The buyer has completed payment.

Please proceed with the project.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✔ OK", "SELLER_OK")]
      ])
    );

  } catch (err) {
    console.log(err);
  }

});

// ===== ADMIN REJECT PAYMENT =====
bot.action(/ADMIN_REJECT_(.+)/, async (ctx) => {

if (ctx.from.id !== Number(process.env.ADMIN_ID)) {
  return ctx.answerCbQuery("Not authorized");
}

  const dealId = ctx.match[1];

  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.screenshotSubmitted = false;
  saveDeals(deals);

  await ctx.answerCbQuery("Marked as not received");

  await ctx.telegram.sendMessage(
    deal.buyer,
`⚠️ The screenshot provided does not look like a valid transaction proof.

Please send a clear and real screenshot of the completed crypto transaction.`
  );

});

bot.on('text', async (ctx) => {
  const state = userStates[ctx.from.id];
  const msg = ctx.message.text.trim();

  // ===== HANDLE HELP MESSAGES =====
  if (state?.step === 'awaitingHelpMessage') {
    const adminId = process.env.ADMIN_ID;
    const userMsg = msg;
    const fromUser = `@${ctx.from.username || ctx.from.first_name} (ID: ${ctx.from.id})`;

    try {
      await ctx.reply("✅ Your message has been sent to support. They will reply soon.");
      await ctx.telegram.sendMessage(
        adminId,
        `📩 Help request from ${fromUser}\n\nMessage:\n${userMsg}`
      );
    } catch (err) {
      console.log("Error forwarding help message:", err);
      await ctx.reply("❌ Failed to send message to admin. Try again later.");
    }

    delete userStates[ctx.from.id];
    return;
  }

  // ===== HANDLE REVIEWS =====
  if (state?.step === 'awaitingReview') {
    addReview(state.rating, msg, state.role);
    await ctx.reply("⭐ Review recorded!");
    delete userStates[ctx.from.id];
    return;
  }

  // ===== DEAL CREATION =====
  if (state?.step === 'awaitingSeller') {
    state.dealData.seller = msg;
    state.step = 'awaitingDescription';
    return ctx.reply("Enter the project description for this deal:");
  }

  if (state?.step === 'awaitingDescription') {
    state.dealData.description = msg;
    state.step = 'awaitingAmountCurrency';
    return ctx.reply("Enter the deal amount and currency (e.g., 50 USDT):");
  }

  if (state?.step === 'awaitingAmountCurrency') {
    const parts = msg.split(' ');
    if (parts.length !== 2) return ctx.reply("Format: <amount> <currency> (e.g., 50 USDT)");

    const amount = Number(parts[0]);
    const currency = parts[1].toUpperCase();
    if (isNaN(amount) || amount <= 0) return ctx.reply("Invalid amount.");

    const supportedCurrencies = ['USDT','BTC','ETH'];
    if (!supportedCurrencies.includes(currency)) return ctx.reply("Currency not supported.");

    const { fee, sellerReceives } = calculateFee(amount);

    state.dealData.amount = amount;
    state.dealData.currency = currency;
    state.dealData.fee = fee;
    state.dealData.sellerReceives = sellerReceives;
    state.step = 'confirmDeal';

    return ctx.reply(
      `✅ Deal Summary:\n\n` +
      `Seller: ${state.dealData.seller}\n` +
      `Project: ${state.dealData.description}\n` +
      `Amount: ${amount} ${currency}\n` +
      `Escrow Fee: ${fee} ${currency}\n` +
      `Seller Receives: ${sellerReceives} ${currency}\n\n` +
      `Confirm deal?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Deal', 'CONFIRM_DEAL')],
        [Markup.button.callback('❌ Cancel', 'CANCEL_DEAL')]
      ])
    );
  }

  // ===== MY DEALS LOOKUP =====
  if (state?.step === 'awaitingDealId') {

    const dealId = msg;
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);

    if (!deal) {
      await ctx.reply("❌ Deal not found.");
      delete userStates[ctx.from.id];
      return;
    }

    if (ctx.from.id != deal.buyer && ctx.from.id != deal.seller) {
      await ctx.reply("❌ You are not part of this deal.");
      delete userStates[ctx.from.id];
      return;
    }

    const statusEmoji =
      deal.status === 'completed'
        ? '✅'
        : deal.status === 'waiting_payment'
        ? '⏳'
        : '⚠️';

    await ctx.reply(
      `📄 Deal ID: ${deal.dealId}\n` +
      `Buyer: ${deal.buyerUsername || deal.buyer}\n` +
      `Seller: ${deal.sellerUsername || deal.seller}\n` +
      `Status: ${statusEmoji} ${deal.status}\n` +
      `Amount: ${deal.amount} ${deal.currency}`,
    );

    delete userStates[ctx.from.id];
    return;
  }

});

  // ===== PAYMENT METHOD SELECTION =====

bot.action("SELECT_PAYMENT", async (ctx) => {

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

});

// ===== USDT NETWORK SELECTION =====

bot.action("PAY_USDT", async (ctx) => {

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

});

const wallets = require('./config/wallets');

bot.action(/NET_USDT_(.+)/, async (ctx) => {

  await ctx.answerCbQuery();

  const network = ctx.match[1];

  const address = wallets.USDT[network];

  if (!address) {
    return ctx.reply("Wallet not configured.");
  }

  await ctx.reply(
`Send payment to:

USDT (${network})

Address:
${address}

After sending payment, upload the transaction screenshot here.`
  );

});

bot.action(/PAY_(BTC|ETH|SOL|LTC)/, async (ctx) => {

  await ctx.answerCbQuery();

  const currency = ctx.match[1];

  const network = Object.keys(wallets[currency])[0];
  const address = wallets[currency][network];

  await ctx.reply(
`Send payment to:

${currency}

Address:
${address}

After sending payment, upload the transaction screenshot here.`
  );

});
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

// ===== Seller accepts deal & send buyer payment instructions =====
deal.status = 'waiting_payment';
saveDeals(deals);

await ctx.answerCbQuery("Deal accepted!");
await ctx.reply("You accepted the deal. Waiting for buyer payment...");

const buyerId = deal.buyer;

// If currency is USDT, ask buyer to pick network
if (deal.currency === 'USDT') {
  await ctx.telegram.sendMessage(
    buyerId,
    "Please select the network for USDT payment:",
    Markup.inlineKeyboard([
      [Markup.button.callback('TRC20', `USDT_NETWORK_TRC20_${deal.dealId}`)],
      [Markup.button.callback('ERC20', `USDT_NETWORK_ERC20_${deal.dealId}`)],
      [Markup.button.callback('BEP20', `USDT_NETWORK_BEP20_${deal.dealId}`)],
      [Markup.button.callback('SOLANA', `USDT_NETWORK_SOLANA_${deal.dealId}`)]
    ])
  );
} else {
const networkKey = Object.keys(wallets[deal.currency])[0];
const walletAddress = wallets[deal.currency][networkKey];

if (!walletAddress) return ctx.reply("⚠️ Wallet not configured for this currency/network.");
  try {
    await ctx.telegram.sendMessage(
      buyerId,
      `✅ Seller accepted the deal!\n\n` +
      `Send payment to the escrow wallet below.\n\n` +
      `Deal ID: ${deal.dealId}\n` +
      `Amount: ${deal.amount} ${deal.currency}\n` +
      `Escrow Fee: ${deal.fee} ${deal.currency}\n` +
      `Seller receives: ${deal.sellerReceives} ${deal.currency}\n\n` +
      `${deal.currency} Wallet:\n${walletAddress}\n\n` +
      `After sending payment screenshot, click "Mark as Paid".\n` +
      `You have 30 minutes to complete payment.`
    );
  } catch (err) {
    console.log("Error sending payment instructions:", err);
  }
}

// ===== Handle USDT network selection =====
bot.action(/USDT_NETWORK_(.+)_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const network = ctx.match[1]; // TRC20, ERC20, BEP20, SOLANA
  const dealId = ctx.match[2];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);
  if (!deal) return ctx.reply("Deal not found.");

  const buyerId = deal.buyer;
  const walletAddress = wallets('USDT', dealId, network);

  try {
    await ctx.telegram.sendMessage(
      buyerId,
      `✅ USDT (${network}) Wallet Selected\n\n` +
      `Send payment to the escrow wallet below.\n\n` +
      `Deal ID: ${dealId}\n` +
      `Amount: ${deal.amount} USDT\n` +
      `Escrow Fee: ${deal.fee} USDT\n` +
      `Seller receives: ${deal.sellerReceives} USDT\n\n` +
      `Wallet Address:\n${walletAddress}\n\n` +
      `After sending payment screenshot, click "Mark as Paid".\n` +
      `You have 30 minutes to complete payment.`
    );
  } catch (err) {
    console.log("Error sending USDT network wallet:", err);
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
if (ctx.from.id !== Number(process.env.ADMIN_ID)) {
  return ctx.answerCbQuery("Not authorized");
}
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

    // Notify both parties
    await ctx.telegram.sendMessage(deal.buyer, `🎉 Deal ${dealId} completed!`);
    await ctx.telegram.sendMessage(sellerId, `🎉 Deal ${dealId} completed! You received ${deal.sellerReceives} ${deal.currency}.`);

    // ===== Prompt both buyer and seller to leave a review =====
    promptReview(deal.buyer, dealId, 'buyer');
    promptReview(sellerId, dealId, 'seller');

  } catch (err) {
    console.log("Error notifying parties on deal release:", err);
  }
});

// ===== Function to prompt review =====
function promptReview(userId, dealId, role) {
  // Ask rating first
  bot.telegram.sendMessage(userId, `✅ Your deal (ID: ${dealId}) is complete! Please leave a ${role} review.`);

  bot.telegram.sendMessage(userId, "Select a rating for this deal:", 
    Markup.inlineKeyboard([
      [Markup.button.callback('⭐ 1', `REVIEW_${dealId}_${role}_1`)],
      [Markup.button.callback('⭐ 2', `REVIEW_${dealId}_${role}_2`)],
      [Markup.button.callback('⭐ 3', `REVIEW_${dealId}_${role}_3`)],
      [Markup.button.callback('⭐ 4', `REVIEW_${dealId}_${role}_4`)],
      [Markup.button.callback('⭐ 5', `REVIEW_${dealId}_${role}_5`)]
    ])
  );
}


// ===== Handle review rating selection =====
bot.action(/REVIEW_(.+)_(buyer|seller)_(\d)/, async (ctx) => {
  const dealId = ctx.match[1];
  const role = ctx.match[2]; // buyer or seller
  const rating = parseInt(ctx.match[3]);

  // Only allow the user who clicked to submit
  if ((role === 'buyer' && ctx.from.id !== getDeals().find(d => d.dealId === dealId).buyer) ||
      (role === 'seller' && ctx.from.id !== getDeals().find(d => d.dealId === dealId).seller)) {
    return ctx.answerCbQuery("You cannot submit a review for the other party.");
  }

  await ctx.answerCbQuery(`You selected ⭐ ${rating}`);

  await ctx.reply("Great! Now type your review text for this deal:");

  const reviewListener = async (ctx2) => {
    const reviewText = ctx2.message.text;
    addReview(rating, reviewText, role); // Save review with role

    await ctx2.reply("⭐ Thank you! Your review has been recorded.");

    // Remove listener after use
    bot.off('text', reviewListener);
  };

const userId = ctx.from.id;
userStates[userId] = { step: 'awaitingReview', dealId, role, rating };
});

// ===== MY DEALS SYSTEM (NEW: Deal ID lookup) =====
bot.command('mydeals', async (ctx) => {
  await ctx.reply("📄 Please enter your Deal ID to view:");

  // Set user state — main bot.on('text') will handle it
  userStates[ctx.from.id] = { step: 'awaitingDealId' };
});

// ===== HANDLE MY DEALS INPUT =====
if (state?.step === 'awaitingDealId') {
  const dealId = msg.trim();
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) {
    await ctx.reply("❌ Deal not found. Please check your Deal ID.");
    delete userStates[ctx.from.id];
    return;
  }

  if (ctx.from.id != deal.buyer && ctx.from.id != deal.seller) {
    await ctx.reply("❌ You do not have access to this deal.");
    delete userStates[ctx.from.id];
    return;
  }

  const statusEmoji = deal.status === 'completed' ? '✅' : (deal.status === 'waiting_payment' ? '⏳' : '⚠️');

  await ctx.reply(
    `📄 Deal ID: ${deal.dealId}\n` +
    `Buyer: ${deal.buyerUsername || deal.buyer}\n` +
    `Seller: ${deal.sellerUsername || deal.seller}\n` +
    `Payment Status: ${statusEmoji} ${deal.status}\n` +
    `Delivery Deadline: ${deal.deliveryDeadline || 'N/A'}\n` +
    `Amount: ${deal.amount} ${deal.currency}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📞 Contact Support', 'HELP_SUBMIT')],
      ...(ctx.from.id === deal.buyer && deal.status !== 'completed' ? [[Markup.button.callback('Mark as Paid', `PAID_${dealId}`)]] : []),
      ...(ctx.from.id === deal.seller && deal.status === 'waiting_payment' ? [[Markup.button.callback('Request Extension', `EXTEND_${dealId}`)]] : [])
    ])
  );

  delete userStates[ctx.from.id]; // clear the state
  return;
}

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