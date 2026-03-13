const { getReviews, saveReviews } = require("../utils/storage");

// Add a review
function addReview(review) {
  const reviews = getReviews();
  reviews.push(review);
  saveReviews(reviews);
}

// Get all reviews for a specific user (buyer or seller)
function getUserReviews(userId) {
  const reviews = getReviews();
  return reviews.filter(r => r.target == userId);
}

module.exports = {
  addReview,
  getUserReviews
};