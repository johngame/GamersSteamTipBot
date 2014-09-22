/// <reference path="typescript_defs/node.d.ts" />
/// <reference path="typescript_defs/mongodb.d.ts" />
import mongodb = require("mongodb");

var http = require("http");
var https = require("https");
var urllib = require("url");
var fs = require("fs");
var crypto = require("crypto");
var MongoClient = require("mongodb").MongoClient;
var Steam = require("steam");
var gamerscoin = require("node-gamerscoin")()
var async = require("async");
var cheerio = require("cheerio");
var numeral = require("numeral");
var requester = require("request");

var credentials: {
	steam: {
		accountName?: string;
		password?: string;
		shaSentryfile?: any; // Buffer
	};
	rpc: {
		username?: string;
		password?: string;
	};
} = {steam: {}, rpc: {}};
var rawCredentials = JSON.parse(fs.readFileSync("auth.json", {"encoding": "utf8"}));
credentials.steam.accountName = rawCredentials.steam.accountName;
credentials.steam.password = rawCredentials.steam.password;
//credentials.steam.shaSentryfile = new Buffer(rawCredentials.steam.shaSentryfile, "hex");
credentials.rpc.username = rawCredentials.rpc.username;
credentials.rpc.password = rawCredentials.rpc.password;
 
// Connect to Gamerscoin daemon
gamerscoin.auth(credentials.rpc.username, credentials.rpc.password);

// Steam GroupID
var GamersTipGroupID: string = "103582791436371782";

// GamersCoin Well Foundation address for The Water Project 
// More Infos : http://gamers-coin.org/foundation
var donationAddress: string = "GamenzL8ULFz1yBFykLrja7F5DL5zjCyYC";

// Hours until tips to nonregistered users are refunded
var purgeTime: number = 24; 

// Bot Version 
var version = "v0.0.2";

// Connect to MongoDB
MongoClient.connect("mongodb://localhost:27017/gamerscointipbotdb", function(err: any, db: mongodb.Db) {
if (err)
	throw err
var Collections: {
	Users: mongodb.Collection;
	Tips: mongodb.Collection;
	Donations: mongodb.Collection;
	Blacklist: mongodb.Collection;
	Errors: mongodb.Collection;
	OldUsers: mongodb.Collection;
} = {
	Users: db.collection("users"),
	Tips: db.collection("tips"),
	Donations: db.collection("donations"),
	Blacklist: db.collection("blacklist"),
	Errors: db.collection("errors"),
	OldUsers: db.collection("oldusers")
};

var bot = new Steam.SteamClient();
bot.logOn(credentials.steam);
bot.on("loggedOn", function(): void {
	console.log("Logged in as " + credentials.steam.accountName);
	bot.setPersonaState(Steam.EPersonaState.Online) // to display your bot's status as "Online"
	console.log("SteamID: " + bot.steamID);
	
	bot.joinChat(GamersTipGroupID);
	//bot.sendMessage(GamersTipGroupID, "gamerstippingbot is back online");

	unClaimedTipCheck();
	setInterval(unClaimedTipCheck, 1000 * 60 * 60); // Check every hour
});

function getNameFromID(steamID: string): string {
	if (bot.users[steamID])
		return bot.users[steamID].playerName;
	else
		return undefined;
}
function reportError(err: any, context: string, justID: boolean = false) {
	var errorID: string = crypto.randomBytes(16).toString("hex");
	Collections.Errors.insert({
		"id": errorID,
		"timestamp": Date.now(),
		"time": new Date().toString(),
		"error": err,
		"context": context || "No context reported"
	}, {w:0}, function(): void {});
	if (justID) {
		return errorID;
	} else {
		return "An error occurred! Don't worry, it has been reported. To receive support with this error, please include the error code of '" + errorID + "'. Sorry for the inconvenience.";
	}
}
function getHTTPPage(url: string, callback: (err: Error, content: string) => void): void {
	requester(url, function (err, response, body) {
		if (err) {
			err.URL = url;
			callback(err, null);
			return;
		}
		callback(null, body);
	});
}
var prices = {
	"BTC/USD": null,
	"GMC/BTC": null,
	"GMC/USD": null,
	"LastUpdated": null
};
function getPrices(): void {
	async.parallel([
		function(callback) {
			// Coinbase BTC/USD price
			getHTTPPage("https://coinbase.com/api/v1/currencies/exchange_rates", callback);
		},
		function(callback) {
			// Mintpal GMC/BTC price
			getHTTPPage("https://api.comkort.com/v1/public/market/summary?market_alias=gmc_btc", callback);
		}
	], function(err: Error, results: any[]): void {
		if (err) {
			reportError(err, "Getting current prices");
			return;
		}
		try {
			prices["BTC/USD"] = parseFloat(JSON.parse(results[0])["btc_to_usd"]);
			prices["GMC/BTC"] = parseFloat(JSON.parse(results[1]).markets["GMC/BTC"].last_price);
		}
		catch(e) {
			return;
		}
		prices["GMC/USD"] = prices["BTC/USD"] * prices["GMC/BTC"];
		// Return to strings with .toFixed(8)
		prices.LastUpdated = Date.now();
	});
}
getPrices();
// Both API's are updated every minute so update every 5 minutes
setInterval(getPrices, 1000 * 60 * 5);

function stringifyAndEscape(object: any): string {
	return JSON.stringify(object).replace(/[\u0080-\uFFFF]/g, function(m) {
		return "\\u" + ("0000" + m.charCodeAt(0).toString(16)).slice(-4);
	});
}
// Save the cookies to a file to allow the TF2 bot to access them
function botWebLogOn(cb?: (steamCookies: string[]) => void) {
	cb = cb || function(): void {};
	bot.webLogOn(function(steamCookies: string[]): void {
		fs.writeFile("cookies.json", JSON.stringify(steamCookies), function(): void {
			cb(steamCookies);
		});
	});
}
bot.on("webSessionID", function(): void {
	botWebLogOn();
	console.info("Web cookies saved");
});

function meCommand(chatterID: string, message: string, group: boolean = true) {
	var toSend: string = (group) ? GamersTipGroupID : chatterID;
	bot.sendMessage(toSend, bot.users[chatterID].playerName);
	bot.sendMessage(toSend, chatterID);
}
function statsCommand(chatterID: string, message: string, group: boolean = true) {
	var toSend: string = (group) ? GamersTipGroupID : chatterID;
	async.parallel([
		function(callback) {
			Collections.Users.find().toArray(callback);
		},
		function(callback) {
			Collections.Tips.find({"accepted": true}).toArray(callback);
		}
	], function(err: Error, results: any[]): void {
		if (err) {
			bot.sendMessage(toSend, reportError(err, "Retrieving stats for +stats"));
			return;
		}
		var users: any = results[0];
		var tips: any = results[1];
		var totalAmount: number = 0;
		for (var i: number = 0; i < tips.length; i++) {
			totalAmount += tips[i].amount;
		}
		var statsMessage: string = 
			[
				"Stats current as of " + new Date().toString(),
				"Registered users: " + users.length,
				"Total tips: " + tips.length,
				"Total tip volume: " + totalAmount + " Gamerscoins"
			].join("\n");
		bot.sendMessage(toSend, statsMessage);
	});
}
function priceCommand(chatterID: string, message: string, group: boolean = true) {
	var toSend: string = (group) ? GamersTipGroupID : chatterID;
	var priceMessage: string[] = [
		"Exchange rates as of " + new Date(prices.LastUpdated).toString() + ":",
		"BTC/USD: $" + prices["BTC/USD"].toFixed(2) + " (Coinbase)",
		"GMC/BTC: " + prices["GMC/BTC"].toFixed(8) + " BTC (https://comkort.com/market/trade/gmc_btc)",
		"GMC/USD: $" + prices["GMC/USD"].toFixed(8),
		"1 GMC = 1 GMC"
	];
	if (message.split(" ")[1]) {
		var amount: number = numeral().unformat(message.split(" ")[1]);
		var amountUSD: number = amount * prices["GMC/USD"];
		priceMessage.push(amount + " Gamerscoins = " + numeral(amountUSD).format("$0,0.00"));
	}
	bot.sendMessage(toSend, priceMessage.join("\n"));
}
function inviteToGroup(invitee) {
	botWebLogOn(function(steamCookies: string[]): void {
		var j = requester.jar();
		j.setCookie(requester.cookie(steamCookies[0]), "http://steamcommunity.com");
		j.setCookie(requester.cookie(steamCookies[1]), "http://steamcommunity.com");
		requester.post({url: "http://steamcommunity.com/actions/GroupInvite", jar: j, form: {
			"type": "groupInvite",
			"inviter": bot.steamID,
			"invitee": invitee,
			"group": GamersTipGroupID, // Gamerscoin group
			"sessionID": (/sessionid=(.*)/).exec(steamCookies[0])[1]
		}}, function (err, httpResponse, body) {
			Collections.Errors.insert({
				"timestamp": Date.now(),
				"time": new Date().toString(),
				"type": "Invite Response",
				"info": {
					err: err,
					httpResponse: httpResponse,
					body: body
				}
			}, {w:0}, undefined);
		});
	});
}

bot.on("chatMsg", function(sourceID: string, message: string, type: number, chatterID: string): void {
	if (message[0] === "+") {
    	switch (message.split(" ")[0]) {
			case "+me":
				meCommand(chatterID, message);
				break;
			case "+stats":
				statsCommand(chatterID, message);
				break;
			case "+prices":
			case "+price":
				priceCommand(chatterID, message);
				break;
			case "+joinmatch":
			case "+joingame":
			case "+joinserver":
				bot.sendMessage(GamersTipGroupID, "Our TF2 server is at steam://connect/80.240.134.134:27015/ Click to join and place wagers on matches!");
				break;
			default:
				bot.sendMessage(GamersTipGroupID, "I won't respond to commands in the group chat. Open up a private message by double clicking on my name in the sidebar to send me commands.");
    	}
  	}
});
bot.on("friendMsg", function(chatterID: string, message: string, type: number): void {
	// Private messages
	if (message === "")
		return;
	switch (message.split(" ")[0]) { // The command part
		case "+register":
			var name: string = getNameFromID(chatterID);

			Collections.Users.findOne({"id": chatterID}, function(err: Error, previousUser) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Checking for previous user in +register"));
					return;
				}
				if (previousUser) {
					bot.sendMessage(chatterID, "You've already registered");
					return;
				}

				gamerscoin.getNewAddress(chatterID, function(err: Error, address: string) { // chatterID is that user's account
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Generating address for new user"));
						return;
					}
					var userEntry = {
						"id": chatterID,
						"name": name,
						"address": address,
						"favorites": {}
					};
					Collections.Users.insert(userEntry, {w:1}, function(err: Error) {
						if (err) {
							bot.sendMessage(chatterID, reportError(err, "Adding new user to the database"));
						}
						bot.sendMessage(chatterID, "Welcome " + name + "!");
						bot.sendMessage(chatterID, "Your deposit address is: " + address);
						bot.sendMessage(chatterID, "Tip users with '+tip <STEAM NAME> <AMOUNT> Gamerscoins'");
						bot.sendMessage(chatterID, "If you need help, reply with '+help'");
						// Check if they are an old user
						Collections.OldUsers.findOne({"id": chatterID}, function(err: Error, oldUser) {
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Checking for old user"));
								return;
							}
							if (oldUser && oldUser.funds > 0) {
								// Move their funds to their account for them
								var tipComment = {
									"sender": "gamerstippingbot (v1)",
									"recipient": name,
									"refund": false,
									"USD": oldUser.funds * prices["GMC/USD"]
								};
								gamerscoin.move("OldUsersPool", chatterID, oldUser.funds, 1, stringifyAndEscape(tipComment), function(err: any, success: boolean) {
									if (err) {
										bot.sendMessage(chatterID, reportError(err, "Moving balance for old user"));
										return;
									}
									bot.sendMessage(chatterID, "Hey " + name + ", " + oldUser.funds + " Gamerscoins has been added to your account from your v1 wallet.");
								});
							}
						});
						// Check for giveaway
						var giveawayInfo = JSON.parse(fs.readFileSync("giveaway.json", {"encoding": "utf8"}));
						if (giveawayInfo.happening) {
							var amountToGive = giveawayInfo.amount / giveawayInfo.shibes;
							var tipComment = {
								"sender": "gamerstippingbot",
								"recipient": name,
								"refund": false,
								"USD": amountToGive * prices["GMC/USD"]
							};
							gamerscoin.move(giveawayInfo.account, chatterID, amountToGive, 1, stringifyAndEscape(tipComment), function(err: any, success: boolean) {
								if (err) {
									bot.sendMessage(chatterID, reportError(err, "Moving balance for a giveaway"));
									return;
								}
								bot.sendMessage(chatterID, "As part of the current giveaway, you've been given " + amountToGive + " Gamerscoin! You can use that Gamerscoins to tip others on Steam and help spread the word!");
							});
						}
					});
				});
			});
			break;
		case "+deposit":
		case "+add":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +add"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to add funds");
					return;
				}
				bot.sendMessage(chatterID, "Your deposit address is: " + user.address);
				bot.sendMessage(chatterID, "This address is locked to your account and will not change");
			});
			break;
		case "+balance":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +balance"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to view your balance");
					return;
				}
				gamerscoin.getBalance(chatterID, function(err: Error, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +balance"));
						return;
					}
					bot.sendMessage(chatterID, "Your current balance is: " + balance + " Gamerscoins");
					bot.sendMessage(chatterID, "Your deposit address is: " + user.address);
				});
			});
			break;
		case "+history":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +history"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to view your history");
					return;
				}
				var numberOfTransactions: number = 10;
				async.parallel([
					function(callback) {
						gamerscoin.getBalance(chatterID, callback);
					},
					function(callback) {
						// Get 20 most recent transactions because moves from the FeePool also count and must be expunged
						gamerscoin.listTransactions(chatterID, numberOfTransactions * 2, callback);
					}
				], function(err: any, results: any) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "async.parallel in +history"));
						return;
					}
					var balance: number = results[0];
					var rawTransactions: any[] = results[1];
					var transactions: any[] = [];
					// Purge tx fee reimbursements
					for (var i: number = 0; i < rawTransactions.length; i++) {
						if (rawTransactions[i].category === "move" && rawTransactions[i].otheraccount === "FeePool") {
							continue;
						}
						transactions.unshift(rawTransactions[i]);
					}
					// Restrict to 10 transactions
					transactions.splice(numberOfTransactions, transactions.length);
					var message: string = "\n" + user.name + ", here are your last 10 transactions:\n";
					message += "Your current balance is: " + balance + " Gamerscoins\n";
					message += "Your deposit address is: " + user.address + "\n";
					for (var i: number = 0; i < transactions.length; i++) {
						var transaction: any = transactions[i];
						switch (transaction.category) {
							case "move":
								var parsedComment: any;
								try {
									parsedComment = JSON.parse(transaction.comment);
								}
								catch (e) {
									continue;
								}
								if (parsedComment.refund) {
									// Refunded tip
									var sender: string = parsedComment.sender;
									message += "\n\tType: refunded tip, Amount: " + transaction.amount + ", Original Recipient: " + sender;
									if (parsedComment.USD)
										message += ", USD: $" + parsedComment.USD.toPrecision(2);
								}
								else if (transaction.amount > 0) {
									// Received tip
									var sender: string = parsedComment.sender;
									message += "\n\tType: received tip, Amount: " + transaction.amount + ", Sender: " + sender;
									if (parsedComment.USD)
										message += ", USD: $" + parsedComment.USD.toPrecision(2);
								}
								else if (transaction.amount < 0) {
									// Sent tip
									var recipient: string = parsedComment.recipient;
									message += "\n\tType: sent tip, Amount: " + transaction.amount + ", Recipient: " + recipient;
									if (parsedComment.USD)
										message += ", USD: $" + parsedComment.USD.toPrecision(2);
								}
								break;
							case "send":
								if (transaction.address === donationAddress)
									message += "\n\tType: donation, Amount: " + transaction.amount + ", Address: " + transaction.address + ", Confirmations: " + transaction.confirmations;
								else
									message += "\n\tType: withdraw, Amount: " + transaction.amount + ", Address: " + transaction.address + ", Confirmations: " + transaction.confirmations;
								break;
							case "receive":
								message += "\n\tType: deposit, Amount: " + transaction.amount + ", Confirmations: " + transaction.confirmations;
								break;
						}
						var time: Date = new Date(transaction.time * 1000); // Gamerscoind returns a time that is missing the last 3 digits so multiplying by 1000 fixes this
						message += ", Date: " + time.toDateString() + " (EST)";
					}
					bot.sendMessage(chatterID, message);
				});
			});
			break;
		case "+withdraw":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +withdraw"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to withdraw your Gamerscoins");
					return;
				}
				gamerscoin.getBalance(chatterID, function(err: Error, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +withdraw"));
						return;
					}

					var sendToAddress: string = message.split(" ")[1];
					if (sendToAddress === undefined) {
						bot.sendMessage(chatterID, "Missing address. Notation for +withdraw is '+withdraw <ADDRESS> <AMOUNT|all> Gamerscoins'.");
						return;
					}

					var rawAmount: string = message.split(" ")[2];
					var sendAmount: number = 0;
					if (rawAmount === undefined) {
						bot.sendMessage(chatterID, "Missing amount. Notation for +withdraw is '+withdraw <ADDRESS> <AMOUNT|all> Gamerscoins'.");
						return;
					}
					if (rawAmount.toLowerCase() === "all") {
						sendAmount = balance;
					}
					else {
						sendAmount = numeral().unformat(rawAmount);
					}
					if (sendAmount < 1) {
						bot.sendMessage(chatterID, "Invalid amount of Gamerscoins to withdraw");
						return;
					}

					gamerscoin.sendFrom(chatterID, sendToAddress, sendAmount, function(err: any, txid: string) {
						// Full list of errors at https://github.com/gamerscoin/gamerscoin/blob/master/src/rpcprotocol.h#L43
						if (err) {
							if (err.code === -5) {
								bot.sendMessage(chatterID, "Invalid withdrawal address");
							}
							else if (err.code === -4) {
								// Wallet probably doesn't have enough funds
								reportError({message: "Insufficient server funds to complete withdrawal request", id: chatterID, address: sendToAddress, amount: sendAmount}, "Withdrawing funds");
								bot.sendMessage(chatterID, "Sorry, the server doesn't have enough funds currently to complete that request. Most of the server's funds are kept offline in cold wallets to increase security. This bot's maintainer (RazeTheRoof) has been notified of the server's insufficient balance. He will fix this shortly. If this problem persists, please don't hesitate to email him at <petschekr@gmail.com>.");
							}
							else if (err.code === -6) {
								bot.sendMessage(chatterID, "You have insufficient funds to withdraw " + sendAmount + " Gamerscoins");
								bot.sendMessage(chatterID, "Your current balance is: " + balance + " Gamerscoins");
							}
							else {
								bot.sendMessage(chatterID, reportError({code: err.code, id: chatterID, address: sendToAddress, amount: sendAmount}, "Withdrawing funds"));
							}
							return;
						}
						bot.sendMessage(chatterID, "Sent " + sendAmount + " Gamerscoins to " + sendToAddress + " in tx " + txid);
						// Reimburse the user for their transaction fee
						gamerscoin.getTransaction(txid, function(err: any, txInfo: any) {
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Retrieving tx info in +withdraw"));
								return;
							}
							var fee: number = Math.abs(txInfo.fee);
							if (fee === 0) {
								bot.sendMessage(chatterID, "The transaction fee was 0 Gamerscoins");
								return;
							}
							gamerscoin.move("FeePool", chatterID, fee, function(err: any, success: boolean) {
								if (err) {
									bot.sendMessage(chatterID, reportError(err, "Reimbursing the user for their transaction fee"));
									return;
								}
								bot.sendMessage(chatterID, "The transaction fee of " + fee + " Gamerscoins has been reimbursed");
							});
						});
					});
				});
			});
			break;
		case "+help":
			var helpMessage: string = 
				[
					"Hello there. I'm gamerstippingbot.",
					"New to Gamerscoin? Visit the official page: http://www.gamers-coin.org",
					"",
					"Commands:",
					"	+register - Notify the bot that you exist. You will be added to the database and will receive a deposit address",
					"	+deposit - View your deposit address",
					"	+balance - Check the amount of Gamerscoins in your account",
					"	+history - Display your current balance and a list of your 10 most recent transactions",
					"	+withdraw <ADDRESS> <AMOUNT|all> Gamerscoins - Withdraw funds in your account to the specified address (the 1 Gamerscoins transaction fee will be covered by the bot)",
					"	+tip <STEAM NAME|COMMUNITY URL> <AMOUNT|all> Gamerscoins [+verify] - Send a Steam user a tip. To send tips to users that aren't registered with the bot, tip to their profile URL. (More details about tipping available at http://steamdogebot.com/ ) If +verify is added, the bot will send a message confirming the tip to the group chat.",
					"	+donate <AMOUNT|all> Gamerscoins - Donate Gamerscoins to the developer to keep the bot alive. The server costs about 17,000 Gamerscoins a month. Any help is greatly appreciated!",
					"	+version - Current bot version",
					"	+help - This help dialog",
					"",
					"Find a bug? Want a feature? File an issue at https://github.com/petschekr/SteamDogeTipBot/issues or submit a pull request",
					"Check out our website at http://steamdogebot.com/ for more information",
					"Need anything else? Email me at <petschekr@gmail.com>"
				].join("\n");
			bot.sendMessage(chatterID, helpMessage);
			break;
		case "+version":
			bot.sendMessage(chatterID, "GamerscoinTippingBot " + version + " by Ryan Petschek (RazeTheRoof) <petschekr@gmail.com>\nDonate to " + donationAddress + " if you enjoy this bot and want keep it running. Servers cost money! (You can also send the bot '+donate <AMOUNT> Gamerscoin' to donate from your tipping balance.)");
			break;
		case "+donate":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +donate"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to donate with your tipping account. You can also send some Gamerscoins over to " + donationAddress);
					return;
				}
				gamerscoin.getBalance(chatterID, function(err: any, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +donate"));
						return;
					}

					var rawDonationAmount: string = message.split(" ")[1];
					var donationAmount: number = 0;
					if (rawDonationAmount === undefined) {
						bot.sendMessage(chatterID, "Missing amount. Notation for +donate is '+donate <AMOUNT|all> Gamerscoins'.");
						return;
					}
					if (rawDonationAmount.toLowerCase() === "all") {
						donationAmount = balance;
					}
					else {
						donationAmount = numeral().unformat(rawDonationAmount);
					}
					if (donationAmount < 1) {
						bot.sendMessage(chatterID, "Invalid amount of Gamerscoins to donate");
						return;
					}
					gamerscoin.sendFrom(chatterID, donationAddress, donationAmount, function(err: any, txid: string) {
						if (err) {
							if (err.code === -4) {
								// Wallet probably doesn't have enough funds
								reportError({message: "Insufficient server funds to complete donation request", id: chatterID, address: donationAddress, amount: donationAmount}, "Donating funds");
								bot.sendMessage(chatterID, "Sorry, the server doesn't have enough funds currently to complete that request. Most of the server's funds are kept offline in cold wallets to increase security. This bot's maintainer (RazeTheRoof) has been notified of the server's insufficient balance. He will fix this shortly. If this problem persists, please don't hesitate to email him at <petschekr@gmail.com>.");
							}
							else if (err.code === -6) {
								bot.sendMessage(chatterID, "You have insufficient funds to donate " + donationAmount + " Gamerscoins");
								bot.sendMessage(chatterID, "Your current balance is: " + balance + " Gamerscoins");
							}
							else {
								bot.sendMessage(chatterID, reportError({code: err.code, id: chatterID, address: donationAddress, amount: donationAmount}, "Donating funds"));
							}
							return;
						}
						bot.sendMessage(chatterID, "Your donation of " + donationAmount + " Gamerscoins was successfully donated. (Donation address: " + donationAddress + ")\nTxID for this donation is: " + txid + "\nThank you very much for your support of this project.");
						// Record the donation in the database
						Collections.Donations.insert({
							"sender": {
								"name": user.name,
								"id": chatterID
							},
							"amount": donationAmount,
							"USD": donationAmount * prices["GMC/USD"],
							"timestamp": Date.now(),
							"time": new Date().toString(),
							"groupID": GamersTipGroupID,
						}, {w:1}, function(err): void {
							if (err) {
								err.txid = txid;
								bot.sendMessage(chatterID, reportError(err, "Inserting donation into the database"));
								return;
							}
						});
						// Reimburse the user for their transaction fee
						gamerscoin.getTransaction(txid, function(err: any, txInfo: any) {
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Retrieving tx info in +donate"));
								return;
							}
							var fee: number = Math.abs(txInfo.fee);
							if (fee === 0) {
								bot.sendMessage(chatterID, "The transaction fee was 0 Gamerscoins");
								return;
							}
							gamerscoin.move("FeePool", chatterID, fee, function(err: any, success: boolean) {
								if (err) {
									bot.sendMessage(chatterID, reportError(err, "Reimbursing the user for their transaction fee"));
									return;
								}
								bot.sendMessage(chatterID, "The transaction fee of " + fee + " Gamerscoins has been reimbursed");
							});
						});
					});
				});
			});
			break;
		case "+tip":
			console.log(1);
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +tip"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to tip someone");
					return;
				}
				console.log(2);
				gamerscoin.getBalance(chatterID, function(err: any, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +tip"));
						return;
					}

					var tipInfo: any = message.split(" ");
					tipInfo.shift(); // Remove first element (the "+tip" command)
					tipInfo = tipInfo.join(" ");
					tipInfo = (/(.+?) ([\d\.]+|all)/i).exec(tipInfo) // Handle names with spaces
					if (tipInfo) {
						var personToTipName = tipInfo[1];
						var rawAmount: string = tipInfo[2];
					}
					else {
						bot.sendMessage(chatterID, "Invalid +tip format. Notation for +tip is '+tip <STEAM NAME|COMMUNITY URL> <AMOUNT|all> Gamerscoins'.");
						return;
					}
					var amount: number = 0;
					if (rawAmount.toLowerCase() === "all") {
						amount = balance;
					}
					else {
						amount = numeral().unformat(rawAmount);
						if (amount === 0) {
							bot.sendMessage(chatterID, "Invalid Gamerscoins amount to tip entered");
							return;
						}
					}
					if (amount > balance) {
						bot.sendMessage(chatterID, "Insufficient funds to tip " + amount + " Gamerscoins");
						bot.sendMessage(chatterID, "You can deposit more Gamerscoins to your deposit address: " + user.address);
						return;
					}
					if (amount < 1) {
						bot.sendMessage(chatterID, "You must tip at least 1 Gamerscoins");
						return;
					}
					var personToTipID: string = undefined;
					var unregisteredUser: boolean = false;
					var usedURL: boolean = false;
					console.log(3);
					if ((/^https?:\/\/steamcommunity\.com\/(?:id|profiles)\/.*$/i).exec(personToTipName)) {
						console.log(4);
						var communityURL: string = personToTipName;
						communityURL += "?xml=1"; // Get Steam to return an XML description
						usedURL = true;

						getHTTPPage(communityURL, function(err: Error, content: string): void {
							console.log(5);
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Retrieving user information via their community URL"));
								return;
							}
							var $: any = cheerio.load(content, {xmlMode: true});
							personToTipID = $("steamID64").text();
							personToTipName = $("steamID").text();
							if (!personToTipName || !personToTipID) {
								bot.sendMessage(chatterID, "Oops, you probably entered the wrong Steam Community URL.");
								bot.sendMessage(chatterID, "These URLs have the format of <http://steamcommunity.com/id/razed> or <http://steamcommunity.com/profiles/76561198066172487>");
								bot.sendMessage(chatterID, "Make sure that you go to the person you want to tip's profile page and right click > Copy Page URL.");
								return;
							}
							console.log(6);
							Collections.Users.findOne({"id": personToTipID}, function(err: Error, personToTip): void {
								console.log(7);
								if (err) {
									bot.sendMessage(chatterID, reportError(err, "Checking if the tippee is registered"));
									return;
								}
								if (personToTip) {
									console.log(8);
									unregisteredUser = false;
									if (!(/\+nosave/i.test(message))) {
										// Update the tipper's db entry to include their new favorite
										user.favorites[personToTipName] = personToTipID;
										console.log(9);
										Collections.Users.update({"id": chatterID}, {$set: {"favorites": user.favorites}}, {w:1}, function(err: Error): void {
											console.log(10);
											if (err) {
												bot.sendMessage(chatterID, reportError(err, "Setting user's favorites"));
												return;
											}
											continueWithTip();
										});
									}
									else {
										console.log(11);
										continueWithTip();
									}
								}
								else {
									console.log(12);
									unregisteredUser = true;
									// Check the Steam ID against the blacklist
									Collections.Blacklist.findOne({"id": personToTipID}, function(err: Error, blacklistedUser) {
										console.log(13);
										if (err) {
											bot.sendMessage(chatterID, reportError(err, "Checking user against blacklist"));
											return;
										}
										if (blacklistedUser) {
											bot.sendMessage(chatterID, personToTipName + " has requested to be left alone by the bot. Please contact RazeTheRoof if this is somehow in error.");
											return;
										}
										// Invite them to the group and add them to the db
										//bot.addFriend(personToTipID);
										inviteToGroup(personToTipID);
										console.log(14);
										gamerscoin.getNewAddress(personToTipID, function(err: Error, address: string) {
											console.log(15);
											if (err) {
												bot.sendMessage(chatterID, reportError(err, "Generating address for autoregistered user"));
												return;
											}
											Collections.Users.insert({
												"id": personToTipID,
												"name": personToTipName,
												"address": address,
												"favorites": {},
												"autoregistered": true
											}, {w:1}, function(err: Error) {
												console.log(16);
												if (err) {
													bot.sendMessage(chatterID, reportError(err, "Autoregistering user in database"));
													return;
												}
												continueWithTip();
											});
										});
									});
								}
							});
						});
					}
					else {
						continueWithTip();
					}
					function continueWithTip(): void {
						console.log(17);
						Collections.Users.find({name: personToTipName}).toArray(function(err: Error, possibleUsers: any[]) {
							console.log(18);
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Retrieving users for +tip"));
								return;
							}
							// Check favorites list
							if (!usedURL && user.favorites[personToTipName] && possibleUsers.length > 1) {
								personToTipID = user.favorites[personToTipName];
								bot.sendMessage(chatterID, "Tip sent to " + personToTipName + " <http://steamcommunity.com/profiles/" + personToTipID + "> from your favorites list because there is more than one user with that nickname");
							}
							if (personToTipID === undefined) {
								if (possibleUsers.length < 1) {
									bot.sendMessage(chatterID, "I can't find any users with that nickname!");
									bot.sendMessage(chatterID, "Find community URL to tip them. You can find this URL by visiting their profile page and right clicking > Copy Page URL.");
									bot.sendMessage(chatterID, "Then, tip with '+tip <COMMUNITY URL> <AMOUNT> Gamerscoin'");
									bot.sendMessage(chatterID, "For example, '+tip http://steamcommunity.com/id/razed/ 100 Gamerscoin +verify'");
									bot.sendMessage(chatterID, "They will receive a friend request and if they accept, they will be registered with the bot so you can tip them with their nickname.");
									bot.sendMessage(chatterID, "They will have " + purgeTime + " hours to accept before the tip is refunded.");
									return;
								}
								if (possibleUsers.length > 1) {
									bot.sendMessage(chatterID, "There are " + possibleUsers.length + " users with that nickname!");
									bot.sendMessage(chatterID, "To tip the right one, find their community URL by visiting their profile page and right clicking > Copy Page URL.");
									bot.sendMessage(chatterID, "Then, tip with '+tip <COMMUNITY URL> <AMOUNT> Gamerscoins'");
									bot.sendMessage(chatterID, "For example, '+tip http://steamcommunity.com/id/razed/ 100 Gamerscoin +verify'");
									bot.sendMessage(chatterID, "That user will be automatically linked to that nickname for you so can use their nickname to tip them in the future.");
									bot.sendMessage(chatterID, "If you would not like them to be linked to that nickname for you, include '+nosave' at the end of the tip.");
									return;
								}
								personToTipID = possibleUsers[0].id;
							}
							if (personToTipID === chatterID) {
								bot.sendMessage(chatterID, "wow. such self tip.");
							}
							if (personToTipID === bot.steamID) {
								bot.sendMessage(chatterID, "I'm sorry, but you can't tip me. If you would like to donate, please reply with '+donate <AMOUNT> Gamerscoins'. Thank you!");
								return;
							}
							var tipComment = {
								"sender": user.name,
								"recipient": personToTipName,
								"refund": false,
								"USD": amount * prices["GMC/USD"]
							};
							console.log(19);
							gamerscoin.move(chatterID, personToTipID, amount, 1, stringifyAndEscape(tipComment), function(err: any, success: boolean) {
								console.log(20);
								if (err) {
									err.chatterID = chatterID;
									err.personToTipID = personToTipID;
									err.amount = amount;
									err.comment = tipComment;
									bot.sendMessage(chatterID, reportError(err, "Moving funds while tipping"));
									return;
								}
								if (/\+verify/i.test(message))
									bot.sendMessage(GamersTipGroupID, personToTipName + " was tipped " + amount + " Gamerscoins by " + user.name + "!");
								// Add the tip to the database
								console.log(21);
								Collections.Tips.insert({
									"sender": {
										"name": tipComment.sender,
										"id": chatterID
									},
									"recipient": {
										"name": tipComment.recipient,
										"id": personToTipID
									},
									"amount": amount,
									"USD": amount * prices["GMC/USD"],
									"timestamp": Date.now(),
									"time": new Date().toString(),
									"groupID": GamersTipGroupID,
									"unregisteredUser": unregisteredUser,
									"accepted": !unregisteredUser,
									"refunded": false
								}, {w:1}, function(err): void {
									console.log(22);
									if (err) {
										bot.sendMessage(chatterID, reportError(err, "Inserting tip into database"));
										return;
									}
									if (!unregisteredUser) {
										// Notify both parties of tip
										bot.sendMessage(chatterID, "You tipped " + personToTipName + " " + amount + " Gamerscoins successfully");
										bot.sendMessage(personToTipID, "You were tipped " + amount + " Gamerscoins by " + user.name);
									}
									else {
										bot.sendMessage(chatterID, "You tipped " + personToTipName + " " + amount + " Gamerscoins successfully. If they do not accept the tip within " + purgeTime + " hours, the tip will be refunded back to you.");
									}
								});
							});
						});
					}
				});
			});
			break;
		case "+accept":
			// Accept a pending tip and welcome that user to Gamerscoin
			// Unfriend the user
			bot.removeFriend(chatterID);
			Collections.Tips.findOne({"recipient.id": chatterID, "unregisteredUser": true}, function(err: Error, tip: any) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving tip in +accept"));
					return;
				}
				if (!tip) {
					bot.sendMessage(chatterID, "There are no pending tips involving you");
					return;
				}
				async.parallel([
					function(callback) {
						Collections.Tips.update({"_id": tip["_id"]}, {$set: {accepted: true}}, {multi: true}, callback);
					},
					function(callback) {
						// Delete the autoregistered attribute because that user is now fully registered
						Collections.Users.update({"id": chatterID}, {$unset: {"autoregistered": ""}}, callback);
					}
				], function(err: Error) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "async.parallel in +accept"));
					}
					bot.sendMessage(chatterID, "Congrats, your tip of " + tip.amount + " Gamerscoins from " + tip.sender.name + " was accepted! Welcome to GamersTippingBot!");
					bot.sendMessage(chatterID, "You can open up the group chat and double click on my name in the sidebar (with the gold star) to send me commands in the future.");
					bot.sendMessage(chatterID, "Send '+help' to see all of the available commands.");
					bot.sendMessage(chatterID, "If you have any questions or suggestions, please start a discussion within the group. RazeTheRoof <petschekr@gmail.com> is this bot's author so send any hate/love mail his way. Remember to pay your tips forward and have fun on your way to the moon!");
				});
			});
			break;
		case "+reject":
			// Reject a pending tip and don't bother this user ever again
			bot.removeFriend(chatterID);
			Collections.Tips.findOne({"recipient.id": chatterID, "unregisteredUser": true}, function(err: Error, tip: any) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving tip in +reject"));
					return;
				}
				if (!tip) {
					bot.sendMessage(chatterID, "There are no pending tips involving you");
					return;
				}
				Collections.Users.update({"id": chatterID}, {$set: {"blacklisted": true}}, {w:0}, function(): void {});
				Collections.Blacklist.insert({"id": chatterID}, {w:0}, function(): void {});
				bot.sendMessage(chatterID, "I'm sorry for disturbing you, " + tip.recipient.name + ". Your tip has been rejected, you have been unfriended, and you will not be bothered ever again by me.");
				bot.sendMessage(chatterID, "If this was in error, please contact RazeTheRoof <petschekr@gmail.com> and he can remove you from the blacklist.");
			});
			break;
		// Extra commands
		case "+me":
				meCommand(chatterID, message, false);
				break;
		case "+stats":
			statsCommand(chatterID, message, false);
			break;
		case "+prices":
		case "+price":
			priceCommand(chatterID, message, false);
			break;
		default:
			bot.sendMessage(chatterID, "I couldn't understand your request. Reply with '+help' for a list of available commands and functions.");
	}
});

bot.on("friend", function(steamID: string, relationship: number): void {
	// Somebody friended the bot
	if (relationship === Steam.EFriendRelationship.RequestRecipient) {
		bot.addFriend(steamID);
		setTimeout(function(): void {
			bot.sendMessage(steamID, "Go to the GamersTradeBase Tip group to message me. I can't accept friend requests.");
			bot.sendMessage(steamID, "Removing friend...");
			setTimeout(function(): void {
				bot.removeFriend(steamID);
			}, 2000);
		}, 2000);
	}
});
bot.on("user", function(userInfo): void {
	Collections.Users.findOne({"id": userInfo.friendid}, function(err: Error, user) {
		if (err) {
			reportError(err, "Retrieving user in user change handler");
			return;
		}
		if (!user)
			return;
		// Handle user nickname changes
		if (user.name !== userInfo.playerName) {
			// If the name was changed, update it in the database
			Collections.Users.update({"id": userInfo.friendid}, {$set: {"name": userInfo.playerName}}, {w:1}, function(err: Error) {
				if (err)
					reportError(err, "Changing player's name in user change handler");
			});
		}
		// Pending tip recipient stuff
		Collections.Tips.findOne({"recipient.id": userInfo.friendid, "accepted": false, "refunded": false}, function(err: Error, tip: any) {
			if (err) {
				bot.sendMessage(GamersTipGroupID, reportError(err, "Retrieving tip in friend accept handler"));
				return;
			}
			if (!user || !tip)
				return;
			bot.sendMessage(userInfo.friendid, "Hello " + tip.recipient.name + ", you've been tipped " + tip.amount + " Gamerscoins by " + tip.sender.name);
			bot.sendMessage(userInfo.friendid, "Gamerscoin is a revolutionary digital currency sent through the internet. You can find out more at http://gamerscoin.com/");
			bot.sendMessage(userInfo.friendid, "If you would like to accept this tip, please reply with '+accept'.");
			bot.sendMessage(userInfo.friendid, "If you would like to reject this tip and want me to leave you alone, please reply with '+reject'.");
		});
	});
});
// Check for unclaimed tips older than 6 hours
function unClaimedTipCheck(): void {
	Collections.Tips.find({unregisteredUser: true, accepted: false, refunded: false}).toArray(function(err: Error, unregisteredUserTips: any[]) {
		async.each(unregisteredUserTips, function(tip, callback) {
			var tipTime = tip["_id"].getTimestamp().valueOf();
			var currentTime = Date.now();
			if ((currentTime - tipTime) > (60 * 60 * purgeTime * 1000)) { // x hours in milliseconds
				// Remove friend
				bot.removeFriend(tip.recipient.id);
				// Tip is older than 6 hours and has not been accepted
				var tipComment = {
					"sender": tip.recipient.name,
					"recipient": tip.sender.name,
					"refund": true,
					"USD": tip.amount * prices["GMC/USD"]
				};
				gamerscoin.move(tip.recipient.id, tip.sender.id, tip.amount, 1, stringifyAndEscape(tipComment), function(err: any, success: boolean) {
					if (err) {
						callback(err);
						return;
					}
					Collections.Tips.update({"_id": tip["_id"]}, {$set: {"refunded": true}}, {w:1}, callback);
				});
			}
			else {
				callback(null);
			}
		}, function(err) {
			if (err) {
				console.error("An error occurred: " + reportError(err, "Checking for expired tips to refund", true));
			}
		});
	});
}

});
