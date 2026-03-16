// =======================================
// SURE DEAL ESCROW BOT
// PROFESSIONAL REFACTORED VERSION
// PART 1
// =======================================


// ===== LOAD ENV =====
require('dotenv').config()

// ===== IMPORT MODULES =====
const { Telegraf, Markup } = require('telegraf')
const fs = require('fs')
const path = require('path')

const { getDeals, saveDeals } = require('./utils/storage')
const generateDealId = require('./utils/generateDealId')
const { calculateFee } = require('./services/feeService')
const { wallets, generateWalletAddress } = require('./config/wallets')

const {
  getAllReviews,
  addReview,
  getAverageRating,
  getTotalReviews
} = require('./data/reviews')


// =======================================
// BOT INITIALIZATION
// =======================================

const bot = new Telegraf(process.env.BOT_TOKEN)

const ADMIN_ID = Number(process.env.ADMIN_ID)


// =======================================
// USERS DATABASE
// =======================================

const usersFile = './data/users.json'

let users = {}

if (fs.existsSync(usersFile)) {
  users = JSON.parse(fs.readFileSync(usersFile))
}

function saveUsers() {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2))
}


// =======================================
// USER STATES
// =======================================

const userStates = {}


// =======================================
// UTILITIES
// =======================================

function getUserReviews(userId) {
  return getAllReviews().filter(r => r.userId === userId)
}

function getTotalDealsCompleted() {
  return getDeals().filter(d => d.status === "completed").length
}

function calculateDeliveryDate(days) {

  const now = new Date()

  now.setDate(now.getDate() + days)

  return now.toDateString()

}


// =======================================
// START COMMAND
// =======================================

bot.start(async (ctx) => {

  const username = ctx.from.username
    ? '@' + ctx.from.username
    : ctx.from.first_name

  if (!users[username]) {
    users[username] = ctx.from.id
    saveUsers()
  }

  await ctx.reply(

    `Welcome to Sure Deal Escrow, ${ctx.from.first_name}!\n\nChoose an option:`,

    Markup.inlineKeyboard([

      [Markup.button.callback("💼 Create Deal", "CREATE_DEAL")],

      [Markup.button.callback("📄 My Deals", "MY_DEALS")],

      [Markup.button.callback("👤 Profile", "PROFILE")],

      [Markup.button.callback("❓ Help", "HELP")]

    ])

  )

})


// =======================================
// PROFILE SYSTEM
// =======================================

bot.action("PROFILE", async (ctx) => {

  await ctx.answerCbQuery()

  const totalDeals = getTotalDealsCompleted()

  const avgRating = getAverageRating()

  const totalReviews = getTotalReviews()

  const userId = ctx.from.id

  const reviews = getUserReviews(userId)

  const userDeals = getDeals().filter(
    d => d.buyer === userId || users[d.seller] === userId
  ).length

  const userAvg = reviews.length
    ? (
        reviews.reduce((a,b)=>a+b.rating,0) /
        reviews.length
      ).toFixed(1)
    : 0


  await ctx.reply(

`SureDeal Escrow

Trusted crypto escrow service.

Deals Completed: ${totalDeals}
Average Rating: ⭐ ${avgRating}/5
Total Reviews: ${totalReviews}

Your Stats

Reviews: ${reviews.length}
Rating: ⭐ ${userAvg}
Deals: ${userDeals}`,

Markup.inlineKeyboard([

[Markup.button.callback("⭐ View Reviews","VIEW_REVIEWS")],

[Markup.button.callback("📊 Deal Statistics","DEAL_STATS")]

])

)

})


// =======================================
// VIEW REVIEWS
// =======================================

bot.action("VIEW_REVIEWS", async (ctx)=>{

const reviews = getAllReviews()

.slice(-10)

.map(r=>`⭐`.repeat(r.rating)+`\n"${r.text}"`)

.join("\n\n")

await ctx.reply(

`Recent Reviews\n\n${reviews || "No reviews yet."}`

)

})


// =======================================
// HELP MENU
// =======================================

bot.action("HELP", async(ctx)=>{

await ctx.answerCbQuery()

await ctx.reply(

`Sure Deal Escrow Bot Help

💼 Create Deal – Start a new escrow deal
📄 My Deals – View your deals
👤 Profile – See reviews and stats
❓ Help – Open help menu

If your payment has not been confirmed after 30 minutes, submit your Deal ID to contact support.`,

Markup.inlineKeyboard([

[Markup.button.callback("Contact Support","HELP_SUPPORT")]

])

)

})

bot.action("HELP_SUPPORT", async(ctx)=>{

await ctx.answerCbQuery()

await ctx.reply("Please send your message or Deal ID.")

userStates[ctx.from.id] = {
step:"awaitingHelpMessage"
}

})


// =======================================
// CREATE DEAL FLOW
// =======================================

bot.action("CREATE_DEAL", async(ctx)=>{

await ctx.answerCbQuery()

userStates[ctx.from.id] = {
step:"awaitingSeller",
dealData:{}
}

await ctx.reply("Enter the seller username (example: @seller)")

})


// =======================================
// MY DEALS SYSTEM
// =======================================

bot.action("MY_DEALS", async(ctx)=>{

await ctx.answerCbQuery()

await ctx.reply("Please enter the Deal ID you want to view.")

userStates[ctx.from.id] = {
step:"awaitingDealLookup"
}

})


// =======================================
// PAYMENT METHOD SELECTOR
// =======================================

bot.action("SELECT_PAYMENT", async(ctx)=>{

await ctx.answerCbQuery()

await ctx.reply(

"Select payment method",

Markup.inlineKeyboard([

[Markup.button.callback("USDT","PAY_USDT")],

[Markup.button.callback("BTC","PAY_BTC")],

[Markup.button.callback("ETH","PAY_ETH")],

[Markup.button.callback("SOL","PAY_SOL")],

[Markup.button.callback("LTC","PAY_LTC")]

])

)

})


// =======================================
// USDT NETWORK
// =======================================

bot.action("PAY_USDT", async(ctx)=>{

await ctx.answerCbQuery()

await ctx.reply(

"Select USDT network",

Markup.inlineKeyboard([

[Markup.button.callback("TRC20","NET_USDT_TRC20")],

[Markup.button.callback("ERC20","NET_USDT_ERC20")],

[Markup.button.callback("BEP20","NET_USDT_BEP20")],

[Markup.button.callback("SOLANA","NET_USDT_SOLANA")]

])

)

})


// =======================================
// FILE BUTTON HELPER
// =======================================

function fileButtons(deal){

if(!deal.files || deal.files.length===0) return []

return deal.files.map((f,index)=>[

Markup.button.callback(

`${f.type.toUpperCase()} ${index+1}`,

`FILE_${deal.dealId}_${index}`

)

])

}


// =======================================
// PAYMENT SCREENSHOT HANDLER
// =======================================

bot.on(['photo','document'], async(ctx)=>{

const deals = getDeals()

const activeDeal = deals.find(

d => d.buyer === ctx.from.id &&
d.status === "waiting_payment"

)

if(!activeDeal){

return ctx.reply("No payment pending.")

}

const file =

ctx.message.photo?.[ctx.message.photo.length-1] ||

ctx.message.document

if(!file){

return ctx.reply(

"⚠️ The screenshot provided does not appear to be a valid transaction proof.\nPlease send a clear screenshot."

)

}

// notify buyer

await ctx.reply(

"⏳ Payment proof received.\nPlease wait while we confirm the transaction."

)

// forward to admin

await ctx.telegram.sendPhoto(

ADMIN_ID,

file.file_id,

{

caption:

`Payment Screenshot Received

Deal ID: ${activeDeal.dealId}

Buyer: ${ctx.from.username}

Seller: ${activeDeal.seller}

Description:
${activeDeal.description}

Amount:
${activeDeal.amount} ${activeDeal.currency}`,

reply_markup:{
inline_keyboard:[

[
{text:"Confirm Payment",callback_data:`ADMIN_CONFIRM_${activeDeal.dealId}`}
],

[
{text:"Payment Not Received",callback_data:`ADMIN_REJECT_${activeDeal.dealId}`}
]

]
}

}

)

})


// =======================================
// ADMIN PAYMENT CONFIRM
// =======================================

bot.action(/ADMIN_CONFIRM_(.+)/, async(ctx)=>{

if(ctx.from.id !== ADMIN_ID) return

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found")

deal.status="paid"

saveDeals(deals)

await ctx.answerCbQuery("Payment confirmed")

const sellerId = users[deal.seller]

await ctx.telegram.sendMessage(

sellerId,

`Payment has been confirmed by escrow.

The buyer has completed payment.

Please proceed with the project.`,

Markup.inlineKeyboard([

[Markup.button.callback("Start Work",`START_WORK_${dealId}`)]

])

)

})


// =======================================
// ADMIN REJECT PAYMENT
// =======================================

bot.action(/ADMIN_REJECT_(.+)/, async(ctx)=>{

if(ctx.from.id !== ADMIN_ID) return

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found")

await ctx.telegram.sendMessage(

deal.buyer,

`The screenshot provided does not appear to be a valid transaction proof.

Please send a clear screenshot showing the completed crypto payment.`

)

})



//// PART 2 CONTINUES BELOW
// =======================================
// START WORK
// =======================================

bot.action(/START_WORK_(.+)/, async (ctx) => {

  const dealId = ctx.match[1]

  const deals = getDeals()

  const deal = deals.find(d => d.dealId === dealId)

  if (!deal) return ctx.reply("Deal not found.")

  deal.status = "in_progress"

  saveDeals(deals)

  await ctx.answerCbQuery("Work started")

  await ctx.telegram.sendMessage(

    deal.buyer,

    `Seller has started working on your project.

Deal ID: ${dealId}

Delivery Time: ${deal.deliveryDays} days
Expected Delivery: ${calculateDeliveryDate(deal.deliveryDays)}`

  )

  const sellerId = users[deal.seller]

  await ctx.telegram.sendMessage(

    sellerId,

    `If you need more time you may request a delivery extension.`,

    Markup.inlineKeyboard([
      [Markup.button.callback("Request Delivery Extension", `EXTEND_${dealId}`)]
    ])

  )

})


// =======================================
// EXTENSION REQUEST
// =======================================

bot.action(/EXTEND_(.+)/, async(ctx)=>{

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found")

userStates[ctx.from.id] = {
step:"awaitingExtensionReason",
dealId
}

await ctx.reply("Enter the reason you need to extend delivery time.")

})


// =======================================
// BUYER APPROVE EXTENSION
// =======================================

bot.action(/EXTENSION_APPROVE_(.+)/, async(ctx)=>{

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found")

deal.extensionApproved = true

saveDeals(deals)

await ctx.answerCbQuery("Extension approved")

await ctx.telegram.sendMessage(

users[deal.seller],

"Your delivery extension request has been approved."

)

})


// =======================================
// BUYER DECLINE EXTENSION
// =======================================

bot.action(/EXTENSION_DECLINE_(.+)/, async(ctx)=>{

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found")

await ctx.answerCbQuery("Extension declined")

await ctx.telegram.sendMessage(

users[deal.seller],

"Buyer declined your extension request."

)

})


// =======================================
// SELLER DELIVERS WORK
// =======================================

bot.action(/DELIVER_WORK_(.+)/, async(ctx)=>{

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found.")

deal.status = "delivered"

saveDeals(deals)

await ctx.answerCbQuery("Work delivered")

await ctx.telegram.sendMessage(

deal.buyer,

`Work has been delivered.

Deal ID: ${dealId}

Please review the delivery.`,

Markup.inlineKeyboard([

[Markup.button.callback("Approve Delivery",`APPROVE_${dealId}`)],

[Markup.button.callback("Open Dispute",`DISPUTE_${dealId}`)]

])

)

})


// =======================================
// BUYER APPROVES DELIVERY
// =======================================

bot.action(/APPROVE_(.+)/, async(ctx)=>{

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found.")

deal.status="completed"

saveDeals(deals)

await ctx.answerCbQuery("Deal completed")

const sellerId = users[deal.seller]

await ctx.telegram.sendMessage(

sellerId,

`Deal Completed.

You received ${deal.sellerReceives} ${deal.currency}`

)

await ctx.telegram.sendMessage(

deal.buyer,

`Deal completed successfully.`

)

promptReview(deal.buyer,dealId,"buyer")

promptReview(sellerId,dealId,"seller")

})


// =======================================
// DISPUTE SYSTEM
// =======================================

bot.action(/DISPUTE_(.+)/, async(ctx)=>{

const dealId = ctx.match[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found.")

deal.status="dispute"

saveDeals(deals)

await ctx.answerCbQuery("Dispute opened")

await ctx.telegram.sendMessage(

ADMIN_ID,

`Dispute opened.

Deal ID: ${dealId}

Buyer: ${deal.buyer}
Seller: ${deal.seller}`

)

})


// =======================================
// ADMIN RELEASE
// =======================================

bot.command("release", async(ctx)=>{

if(ctx.from.id !== ADMIN_ID) return

const args = ctx.message.text.split(" ")

const dealId = args[1]

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found.")

deal.status="completed"

saveDeals(deals)

const sellerId = users[deal.seller]

await ctx.telegram.sendMessage(

sellerId,

`Admin released the escrow.

Amount: ${deal.sellerReceives} ${deal.currency}`

)

})


// =======================================
// REVIEW SYSTEM
// =======================================

function promptReview(userId,dealId,role){

bot.telegram.sendMessage(

userId,

"Please rate this deal",

Markup.inlineKeyboard([

[Markup.button.callback("⭐ 1",`REVIEW_${dealId}_${role}_1`)],

[Markup.button.callback("⭐ 2",`REVIEW_${dealId}_${role}_2`)],

[Markup.button.callback("⭐ 3",`REVIEW_${dealId}_${role}_3`)],

[Markup.button.callback("⭐ 4",`REVIEW_${dealId}_${role}_4`)],

[Markup.button.callback("⭐ 5",`REVIEW_${dealId}_${role}_5`)]

])

)

}


bot.action(/REVIEW_(.+)_(buyer|seller)_(\d)/, async(ctx)=>{

const dealId = ctx.match[1]

const role = ctx.match[2]

const rating = parseInt(ctx.match[3])

await ctx.answerCbQuery(`Rating ${rating}`)

await ctx.reply("Write your review message")

userStates[ctx.from.id] = {
step:"awaitingReview",
dealId,
role,
rating
}

})


// =======================================
// FILE SYSTEM
// =======================================

bot.action(/FILE_(.+)_(\d+)/, async(ctx)=>{

await ctx.answerCbQuery()

const dealId = ctx.match[1]

const fileIndex = parseInt(ctx.match[2])

const deals = getDeals()

const deal = deals.find(d=>d.dealId===dealId)

if(!deal) return ctx.reply("Deal not found")

if(!deal.files || !deal.files[fileIndex]) return ctx.reply("File not found")

const file = deal.files[fileIndex]

const recipientId = ctx.from.id === deal.buyer
? users[deal.seller]
: deal.buyer

switch(file.type){

case "document":

await ctx.telegram.sendDocument(recipientId,file.file_id)

break

case "photo":

await ctx.telegram.sendPhoto(recipientId,file.file_id)

break

case "video":

await ctx.telegram.sendVideo(recipientId,file.file_id)

break

default:

ctx.reply("Unsupported file type")

}

})


// =======================================
// TEXT HANDLER (MASTER HANDLER)
// =======================================

bot.on("text", async (ctx) => {

const state = userStates[ctx.from.id]
if (!state) return

const msg = ctx.message.text.trim()

// =============================
// CREATE DEAL FLOW
// =============================

// SELLER USERNAME
if (state.step === "awaitingSeller") {

  if (!msg.startsWith("@")) {
    return ctx.reply("❌ Please enter a valid seller username starting with @")
  }

  state.dealData.seller = msg
  state.step = "awaitingDescription"

  await ctx.reply("📝 Enter the deal description:")
  return
}

// DEAL DESCRIPTION
if (state.step === "awaitingDescription") {

  state.dealData.description = msg
  state.step = "awaitingAmount"

  await ctx.reply("💰 Enter the deal amount:")
  return
}

// DEAL AMOUNT
if (state.step === "awaitingAmount") {

  const amount = parseFloat(msg)

  if (isNaN(amount)) {
    return ctx.reply("❌ Please enter a valid number.")
  }

  state.dealData.amount = amount
  state.step = "awaitingDeliveryDays"

  await ctx.reply("📦 Enter delivery time in days:")
  return
}

// DELIVERY DAYS
if (state.step === "awaitingDeliveryDays") {

  const days = parseInt(msg)

  if (isNaN(days)) {
    return ctx.reply("❌ Enter a valid number of days.")
  }

  const dealId = generateDealId()

  const deals = getDeals()

  const fee = calculateFee(state.dealData.amount)

  const newDeal = {

    dealId: dealId,
    buyer: ctx.from.id,
    seller: state.dealData.seller,
    description: state.dealData.description,
    amount: state.dealData.amount,
    currency: "USDT",
    sellerReceives: state.dealData.amount - fee,
    deliveryDays: days,
    status: "waiting_payment",
    createdAt: new Date().toISOString()

  }

  deals.push(newDeal)
  saveDeals(deals)

  await ctx.reply(

`✅ Deal Created Successfully

Deal ID: ${dealId}

Seller: ${state.dealData.seller}
Description: ${state.dealData.description}
Amount: ${state.dealData.amount} USDT
Delivery: ${days} days

Select payment method below.`,

Markup.inlineKeyboard([
[Markup.button.callback("💰 Pay with USDT","PAY_USDT")]
])

)

  delete userStates[ctx.from.id]
  return
}


// =============================
// HELP MESSAGE
// =============================

if (state.step === "awaitingHelpMessage") {

  await ctx.telegram.sendMessage(

    ADMIN_ID,

`📩 Support Request

From: @${ctx.from.username || ctx.from.first_name}

Message:
${msg}`

  )

  await ctx.reply("✅ Message sent to support.")
  delete userStates[ctx.from.id]
  return
}


// =============================
// EXTENSION REASON
// =============================

if (state.step === "awaitingExtensionReason") {

  const deals = getDeals()
  const deal = deals.find(d => d.dealId === state.dealId)

  if (!deal) {
    delete userStates[ctx.from.id]
    return ctx.reply("Deal not found.")
  }

  await ctx.telegram.sendMessage(

    deal.buyer,

`⏳ Seller requested delivery extension.

Reason:
${msg}`,

Markup.inlineKeyboard([
[Markup.button.callback("✅ Approve",`EXTENSION_APPROVE_${deal.dealId}`)],
[Markup.button.callback("❌ Decline",`EXTENSION_DECLINE_${deal.dealId}`)]
])

  )

  delete userStates[ctx.from.id]
  return
}


// =============================
// REVIEW MESSAGE
// =============================

if (state.step === "awaitingReview") {

  addReview({

    dealId: state.dealId,
    rating: state.rating,
    text: msg,
    userId: ctx.from.id,
    role: state.role

  })

  await ctx.reply("⭐ Review submitted. Thank you!")

  delete userStates[ctx.from.id]
  return
}

})

// =======================================
// RENDER DEPLOYMENT (WEBHOOK)
// =======================================

const PORT = process.env.PORT || 3000

bot.launch({

webhook:{
domain:process.env.RENDER_EXTERNAL_URL,
port:PORT
}

})

console.log("SureDeal Escrow Bot Running")