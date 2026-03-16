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

const totalDeals = getTotalDealsCompleted();
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

  // Show last 10 reviews
  const reviewsText = allReviews
    .slice(-10)
    .map(r => `⭐`.repeat(r.rating) + `\n"${r.text}"`)
    .join('\n\n');

  await ctx.reply(`📝 Recent Reviews:\n\n${reviewsText || "No reviews yet."}`);
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

  // Save user state so main text handler processes next message
  userStates[ctx.from.id] = {
    step: 'awaitingHelpMessage'
  };
});


// ===== CREATE DEAL FLOW =====
bot.action('CREATE_DEAL', async (ctx) => {
  await ctx.answerCbQuery();

  userStates[ctx.from.id] = {
    step: 'awaitingSeller',
    dealData: {}
  };

  await ctx.reply("Enter the seller's username (e.g., @seller):");
});


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

  // PAYMENT SCREENSHOT
if (activeDeal.status === "waiting_payment" && ctx.from.id === activeDeal.buyer) {

  const adminId = process.env.ADMIN_ID;

  await ctx.telegram.sendMessage(
    adminId,
    `📥 Payment screenshot received\nDeal ID: ${activeDeal.dealId}`
  );

  return ctx.reply("✅ Screenshot received. Admin will verify the payment.");
}

  // NORMAL FILE SHARING
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

    await ctx.telegram.sendMessage(
      recipientId,
      `📂 ${ctx.from.first_name} sent a file for Deal ID: ${activeDeal.dealId}`
    );

    await ctx.reply("✅ File received and forwarded.");
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

// ===== MERGED TEXT HANDLER =====
bot.on('text', async (ctx) => {
  const state = userStates[ctx.from.id];
  const msg = ctx.message.text.trim();

  // ===== HANDLE HELP MESSAGES =====
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
      console.log("Error forwarding help message:", err);
      await ctx.reply("❌ Failed to send message to admin. Try again later.");
    }
    delete userStates[ctx.from.id];
    return;
  }

  // ===== HANDLE EXTENSION REASON =====
  if (state?.step === 'awaitingExtensionReason') {
    const reason = msg;
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === state.dealId);
    if (!deal) return ctx.reply("Deal not found.");

    deal.extensionRequested = {
      by: ctx.from.id,
      reason,
      requestedAt: new Date().toISOString()
    };
    saveDeals(deals);

    const buyerId = deal.buyer;
    const sellerUsername = ctx.from.username || ctx.from.first_name;

    await ctx.telegram.sendMessage(
      buyerId,
      `⏳ Seller (${sellerUsername}) requested a delivery extension for Deal ${deal.dealId}.\n\nReason:\n${reason}\n\nDo you approve the extension?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Approve Extension", `EXTENSION_APPROVE_${deal.dealId}`)],
        [Markup.button.callback("❌ Decline Extension", `EXTENSION_DECLINE_${deal.dealId}`)]
      ])
    );

    await ctx.reply("Your delivery extension request has been sent to the buyer.");
    delete userStates[ctx.from.id];
    return;
  }

  // ===== HANDLE REVIEWS =====
  if (state?.step === 'awaitingReview') {
    const reviewText = msg;
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === state.dealId);
    if (!deal) return ctx.reply("Deal not found.");

    if (!deal.reviews) deal.reviews = [];
    deal.reviews.push({
      by: ctx.from.id,
      role: state.role,
      rating: state.rating,
      text: reviewText,
      createdAt: new Date().toISOString()
    });
    saveDeals(deals);

    await ctx.reply("✅ Thank you! Your review has been submitted.");
    delete userStates[ctx.from.id];
    return;
  }

  // ===== HANDLE DEAL CREATION =====
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
    const parts = msg.split(" ");
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

  // ===== HANDLE MY DEALS LOOKUP =====
  if (state?.step === 'awaitingDealId') {
    const dealId = msg;
    const deals = getDeals();
    const deal = deals.find(d => d.dealId === dealId);
    if (!deal) {
      await ctx.reply("❌ Deal not found.");
      delete userStates[ctx.from.id];
      return;
    }
    if (ctx.from.id !== deal.buyer && ctx.from.id !== deal.seller) {
      await ctx.reply("❌ You are not part of this deal.");
      delete userStates[ctx.from.id];
      return;
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

  // ===== NORMAL FILE SHARING / OTHER TEXT HANDLERS =====
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

  await ctx.reply(`✅ Deal Created!\nDeal ID: ${dealId}\nWaiting for seller to accept.`);

  const sellerId = users[dealData.seller];

  if (!sellerId) {
    delete userStates[ctx.from.id];
    return ctx.reply("⚠️ Seller has not started the bot yet. Ask them to /start first.");
  }

  try {
    await ctx.telegram.sendMessage(
      sellerId,
      `📢 New Deal Created!

Buyer: @${ctx.from.username}
Project: ${dealData.description}

Amount: ${dealData.amount} ${dealData.currency}
Escrow Fee: ${dealData.fee} ${dealData.currency}
Seller Receives: ${dealData.sellerReceives} ${dealData.currency}

Deal ID: ${dealId}`,
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
  delete userStates[ctx.from.id];
  ctx.reply("❌ Deal creation canceled.");
});


// ===== SELLER ACCEPT DEAL =====
bot.action(/ACCEPT_(.+)/, async (ctx) => {

  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'waiting_payment';
  saveDeals(deals);

  await ctx.answerCbQuery("Deal accepted!");
  await ctx.reply("You accepted the deal. Waiting for buyer payment...");

  const buyerId = deal.buyer;

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

    const networkKey = Object.keys(wallets[deal.currency])[0];
    const walletAddress = wallets[deal.currency][networkKey];

    if (!walletAddress) {
      return ctx.reply("⚠️ Wallet not configured for this currency.");
    }

    await ctx.telegram.sendMessage(
      buyerId,
      `✅ Seller accepted the deal!

Send payment to the escrow wallet below.

Deal ID: ${deal.dealId}
Amount: ${deal.amount} ${deal.currency}
Escrow Fee: ${deal.fee} ${deal.currency}
Seller receives: ${deal.sellerReceives} ${deal.currency}

Wallet:
${walletAddress}

After sending payment screenshot, click below:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Mark as Paid", `PAID_${dealId}`)]
      ])
    );
  }
});


// ===== HANDLE USDT NETWORK SELECTION =====
bot.action(/USDT_NETWORK_(TRC20|ERC20|BEP20|SOLANA)_(.+)/, async (ctx) => {

  await ctx.answerCbQuery();

  const network = ctx.match[1];
  const dealId = ctx.match[2];

  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) {
    return ctx.reply("Deal not found.");
  }

  let walletAddress;

  try {

    walletAddress = generateWalletAddress("USDT", dealId, network);

  } catch (err) {

    console.log("Wallet error:", err);
    return ctx.reply("Wallet configuration error.");

  }

  const buyerId = deal.buyer;

  await ctx.telegram.sendMessage(
    buyerId,
`✅ USDT (${network}) Escrow Wallet

Deal ID: ${dealId}

Amount: ${deal.amount} USDT
Escrow Fee: ${deal.fee} USDT
Seller Receives: ${deal.sellerReceives} USDT

Send payment to the address below:

\`${walletAddress}\`

Tap the address to copy.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Mark as Paid", `PAID_${dealId}`)]
      ])
    }
  );

});


// ===== BUYER MARKS PAYMENT =====
bot.action(/PAID_(.+)/, async (ctx) => {

  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'paid';
  saveDeals(deals);

  const sellerId = users[deal.seller] || deal.seller;

  await ctx.telegram.sendMessage(
    sellerId,
    `💰 Payment received for Deal ${deal.dealId}.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("🟢 Start Work", `START_WORK_${dealId}`)]
    ])
  );

  await ctx.reply("Payment marked as sent.");
});


// ===== SELLER START WORK =====
bot.action(/START_WORK_(.+)/, async (ctx) => {

  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'in_progress';
  saveDeals(deals);

  await ctx.answerCbQuery();

  const buyerId = deal.buyer;

  await ctx.telegram.sendMessage(
    buyerId,
    `🟢 Seller started work on Deal ${dealId}.`
  );

  const sellerId = users[deal.seller] || deal.seller;

  await ctx.telegram.sendMessage(
    sellerId,
    "Need more time?",
    Markup.inlineKeyboard([
      [Markup.button.callback("⏳ Request Extension", `EXTEND_${dealId}`)],
      [Markup.button.callback("📦 Deliver Work", `DELIVER_WORK_${dealId}`)]
    ])
  );

});


// ===== SELLER DELIVERS WORK =====
bot.action(/DELIVER_WORK_(.+)/, async (ctx) => {

  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'delivered';
  saveDeals(deals);

  const buyerId = deal.buyer;

  await ctx.telegram.sendMessage(
    buyerId,
    `📦 Work delivered for Deal ${dealId}.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Approve Delivery", `APPROVE_${dealId}`)],
      [Markup.button.callback("⚠️ Open Dispute", `DISPUTE_${dealId}`)]
    ])
  );

});


// ===== BUYER APPROVES DELIVERY =====
bot.action(/APPROVE_(.+)/, async (ctx) => {

  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'completed';
  saveDeals(deals);

  const sellerId = users[deal.seller] || deal.seller;

  await ctx.telegram.sendMessage(deal.buyer, `🎉 Deal ${dealId} completed!`);
  await ctx.telegram.sendMessage(
    sellerId,
    `🎉 Deal ${dealId} completed!\nYou received ${deal.sellerReceives} ${deal.currency}.`
  );

  promptReview(deal.buyer, dealId, 'buyer');
  promptReview(sellerId, dealId, 'seller');

});


// ===== DISPUTE =====
bot.action(/DISPUTE_(.+)/, async (ctx) => {

  const dealId = ctx.match[1];
  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'dispute';
  saveDeals(deals);

  const adminId = process.env.ADMIN_ID;

  await ctx.telegram.sendMessage(
    adminId,
    `⚠️ Dispute opened for Deal ${dealId}`
  );

  await ctx.reply("Admin notified.");

});


// ===== ADMIN RELEASE =====
bot.command('release', async (ctx) => {

  if (ctx.from.id !== Number(process.env.ADMIN_ID)) {
    return ctx.reply("Not authorized.");
  }

  const args = ctx.message.text.split(' ');
  const dealId = args[1];

  const deals = getDeals();
  const deal = deals.find(d => d.dealId === dealId);

  if (!deal) return ctx.reply("Deal not found.");

  deal.status = 'completed';
  saveDeals(deals);

  const sellerId = users[deal.seller] || deal.seller;

  await ctx.telegram.sendMessage(deal.buyer, `🎉 Deal ${dealId} completed!`);
  await ctx.telegram.sendMessage(
    sellerId,
    `🎉 Deal ${dealId} completed!\nYou received ${deal.sellerReceives} ${deal.currency}.`
  );

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


// ===== FILE SHARING =====
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

    switch (file.type) {

      case 'document':
        await ctx.telegram.sendDocument(recipientId, file.file_id);
        break;

      case 'photo':
        await ctx.telegram.sendPhoto(recipientId, file.file_id);
        break;

      case 'video':
        await ctx.telegram.sendVideo(recipientId, file.file_id);
        break;

      default:
        return ctx.reply("Unsupported file.");

    }

    ctx.reply("File sent.");

  } catch (err) {

    console.log(err);
    ctx.reply("Failed to send file.");

  }

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