const fs = require("fs");
const path = require("path");

const dealsFile = path.join(__dirname, "../data/deals.json");
const reviewsFile = path.join(__dirname, "../data/reviews.json");

// ===== Deals =====
function getDeals() {
  if (!fs.existsSync(dealsFile)) fs.writeFileSync(dealsFile, "[]");
  const data = fs.readFileSync(dealsFile);
  return JSON.parse(data);
}

function saveDeals(deals) {
  fs.writeFileSync(dealsFile, JSON.stringify(deals, null, 2));
}

// ===== Reviews =====
function getReviews() {
  if (!fs.existsSync(reviewsFile)) fs.writeFileSync(reviewsFile, "[]");
  const data = fs.readFileSync(reviewsFile);
  return JSON.parse(data);
}

function saveReviews(reviews) {
  fs.writeFileSync(reviewsFile, JSON.stringify(reviews, null, 2));
}

module.exports = {
  getDeals,
  saveDeals,
  getReviews,
  saveReviews,
};