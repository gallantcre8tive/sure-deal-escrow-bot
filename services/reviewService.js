const { getReviews, saveReviews } = require("../utils/storage");

// Add a review
function addReview(rating, text, role = 'buyer', dealId = null) {
  const reviews = getReviews();
  const review = {
    rating,
    text,
    role,     // 'buyer' or 'seller'
    dealId,   // optional: track which deal this review is for
    date: new Date().toISOString()
  };
  reviews.push(review);
  saveReviews(reviews);
}

// Get all reviews for a specific user (buyer or seller)
function getUserReviews(userId) {
  const reviews = getReviews();
  return reviews.filter(r => r.target == userId || r.role === 'buyer' || r.role === 'seller'); 
  // Adjust filter if you want to store target user
}

// Optional: get average rating
function getAverageRating() {
  const reviews = getReviews();
  if (reviews.length === 0) return 0;
  const total = reviews.reduce((acc, r) => acc + r.rating, 0);
  return (total / reviews.length).toFixed(1);
}

module.exports = {
  addReview,
  getUserReviews,
  getAverageRating
};