const { Markup } = require("telegraf");

module.exports = (bot) => {
  // We no longer need bot.start here because it's handled in bot.js main menu
  // But if you want, we can add a small greeting for users who re-enter
  bot.start((ctx) => {
    ctx.reply(
      `Welcome back to Sure Deal Escrow, ${ctx.from.first_name}!`,
      Markup.inlineKeyboard([
        [Markup.button.callback("💼 Create Deal", "CREATE_DEAL")],
        [Markup.button.callback("📄 My Deals", "MY_DEALS")],
        [Markup.button.callback("👤 Profile", "PROFILE")],
        [Markup.button.callback("❓ Help", "HELP")],
      ])
    );
  });
};