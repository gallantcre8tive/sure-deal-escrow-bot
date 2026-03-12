const fs = require("fs");

function getDeals(){
 const data = fs.readFileSync("./data/deals.json");
 return JSON.parse(data);
}

function saveDeals(deals){
 fs.writeFileSync("./data/deals.json", JSON.stringify(deals,null,2));
}

function getReviews(){
 const data = fs.readFileSync("./data/reviews.json");
 return JSON.parse(data);
}

function saveReviews(reviews){
 fs.writeFileSync("./data/reviews.json", JSON.stringify(reviews,null,2));
}

module.exports = {
 getDeals,
 saveDeals,
 getReviews,
 saveReviews
};