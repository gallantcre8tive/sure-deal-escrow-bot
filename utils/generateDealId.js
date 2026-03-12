const { v4: uuidv4 } = require("uuid");

function generateDealId(){
 return "DEAL-" + uuidv4().slice(0,8);
}

module.exports = generateDealId;