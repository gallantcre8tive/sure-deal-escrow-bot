const { getReviews, saveReviews } = require("../utils/storage");

function addReview(review){
 const reviews = getReviews();
 reviews.push(review);
 saveReviews(reviews);
}

function getUserReviews(userId){
 const reviews = getReviews();
 return reviews.filter(r => r.target == userId);
}

module.exports = {
 addReview,
 getUserReviews
};