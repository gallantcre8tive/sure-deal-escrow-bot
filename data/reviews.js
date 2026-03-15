// reviews.js

// Preloaded reviews (~sample 10 for brevity, you can expand to 300)
const reviews = [
  { rating: 5, text: "Very smooth transaction. Escrow worked perfectly." },
  { rating: 5, text: "Fast confirmation and safe deal." },
  { rating: 4, text: "Reliable service." },
  { rating: 5, text: "Highly recommended escrow bot!" },
  { rating: 4, text: "Good experience, very trustworthy." },
  { rating: 5, text: "Safe and fast crypto escrow." },
  { rating: 5, text: "Excellent support, smooth transaction." },
  { rating: 4, text: "Efficient and reliable service." },
  { rating: 5, text: "Escrow worked perfectly, very happy!" },
  { rating: 5, text: "Professional and safe platform." },
];

// Function to get all reviews
function getAllReviews() {
  return reviews;
}

// Function to add a new review
function addReview(rating, text) {
  reviews.push({ rating, text });
}

// Function to calculate average rating
function getAverageRating() {
  if (reviews.length === 0) return 0;
  const total = reviews.reduce((acc, r) => acc + r.rating, 0);
  return (total / reviews.length).toFixed(1);
}

// Function to get total number of reviews
function getTotalReviews() {
  return reviews.length;
}

module.exports = {
  getAllReviews,
  addReview,
  getAverageRating,
  getTotalReviews
};