const { getUserReviews } = require("../services/reviewService");

module.exports = (bot) => {
  // Unified function to send profile info
  const sendProfile = (ctx) => {
    const userId = ctx.from.id;
    const reviews = getUserReviews(userId);

    if (reviews.length === 0) {
      return ctx.reply("No reviews yet.");
    }

    const avg = reviews.reduce((a, b) => a + b.rating, 0) / reviews.length;

    ctx.reply(
      `👤 Reputation\n\n` +
      `Total Reviews: ${reviews.length}\n` +
      `Average Rating: ${avg.toFixed(1)} ⭐`
    );
  };

  // Triggered by /profile command
  bot.command("profile", sendProfile);

  // Triggered by Profile button in menu
  bot.action("PROFILE", async (ctx) => {
    await ctx.answerCbQuery(); // removes "loading..." on button
    sendProfile(ctx);
  });
};