
var http = require("http");
var cheerio = require("cheerio");
var numeral = require("numeral");
var moment = require("moment");


var express = require("express");
var app = express();

app.set("views", __dirname + "/views");
app.set("view engine", "jade");

app.use("/css", express.static("css"));
app.use("/images", express.static("images"));
app.use("/js", express.static("js"));

var online = false;
function getOnlineStatus() {
	http.get("http://steamcommunity.com/id/TRADEBASE-BOT/?xml=1", function(HTTPResponse) {
		HTTPResponse.setEncoding("utf8");
		var content = "";
		HTTPResponse.on("data", function (chunk) {
			content += chunk;
		});
		HTTPResponse.on("end", function() {
			var $ = cheerio.load(content, {xmlMode: true});
			online = ($("onlineState").text() === "online");
		});
	}).on("error", function(err) {
		console.error(err);
	});
}
getOnlineStatus();


var memberCount = 0;
var memberCountDisplay = "0";
function getGroupMemberCount() {
	http.get("http://steamcommunity.com/gid/103582791436344514/memberslistxml/?xml=1", function(HTTPResponse) {
		HTTPResponse.setEncoding("utf8");
		var content = "";
		HTTPResponse.on("data", function (chunk) {
			content += chunk;
		});
		HTTPResponse.on("end", function() {
			var $ = cheerio.load(content, {xmlMode: true});
			memberCount = parseInt($("groupDetails memberCount").text(), 10);
			memberCountDisplay = numeral(memberCount).format("0,0");
		});
	}).on("error", function(err) {
		console.error(err);
	});
}
getGroupMemberCount();


// Get the online status and member count of the bot every minute
setInterval(function () {
	getOnlineStatus();
	getGroupMemberCount();
}, 1000 * 60);

// MongoDB connection stuff
var MongoClient = require("mongodb").MongoClient;
MongoClient.connect("mongodb://localhost:27017/gamerscoinbot", function(err, db) {
if (err)
	throw err
var Collections = {
	Users: db.collection("users"),
	Tips: db.collection("tips"),
	Donations: db.collection("donations"),
	Blacklist: db.collection("blacklist"),
	Errors: db.collection("errors")
};

// Middleware for setting Jade variables upon each request
app.use(function(request, response, next) {
	response.locals.online = online;
	response.locals.memberCount = memberCount;
	response.locals.memberCountDisplay = memberCountDisplay;
	next();
});

app.route("/").get(function(request, response) {
	response.render("index", function(err, html) {
		if (err) {
			console.error(err);
			return;
		}
		response.send(html);
	});
});

app.route("/stats").get(function(request, response) {
	response.render("stats", function(err, html) {
		if (err) {
			console.error(err);
			return;
		}
		response.send(html);
	});
});
app.route("/stats/data").get(function(request, response) {
	var userStream = Collections.Users.find().sort({"_id": -1}).stream();
	var tipStream = Collections.Tips.find().sort({"_id": -1}).stream();

	var usersEachDay = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 2 weeks of data (14 days)
	userStream.on("data", function(user) {
		var creationDate = user["_id"].getTimestamp();

		for (var i = 0; i < usersEachDay.length; i++) {
			if (moment().subtract("days", i).isAfter(creationDate))
				usersEachDay[i]++;
		}
	});

	var tips = {
		"0-10": 0,
		"10-100": 0,
		"100-1000": 0,
		">1000": 0,
		"total": 0
	}
	tipStream.on("data", function(tip) {
		var tipDate = tip["_id"].getTimestamp();
		// Ignore tips older than 14 days
		if (moment().subtract("days", 14).isAfter(tipDate))
			return;
		if (tip.amount > 0 && tip.amount <= 10)
			tips["0-10"]++;
		if (tip.amount > 10 && tip.amount <= 100)
			tips["10-100"]++;
		if (tip.amount > 100 && tip.amount <= 1000)
			tips["100-1000"]++;
		if (tip.amount > 1000)
			tips[">1000"]++;
		tips.total++;
	});

	var usersFinished = false;
	var tipsFinished = false;
	userStream.on("end", function() {
		// Reverse the array to make the most recent data last
		usersEachDay.reverse();
		usersFinished = true;
		finished();
	});
	tipStream.on("end", function() {
		tipsFinished = true;
		finished();
	});
	function finished() {
		if (!tipsFinished || !usersFinished)
			return;
		response.json({
			usersEachDay: usersEachDay,
			tips: tips
		});
	}
});
app.route("/stats/donors").get(function(request, response) {
	Collections.Donations.find({}, {"_id": 0, "time": 0, "groupID": 0}).sort({"amount": -1}).toArray(function(err, arrayOfDonations) {
		if (err) {
			response.json({"status": "failure", "error": err});
			return;
		}
		var donors = {};
		var topDonor = {name: undefined, amount: 0};
		for (var i = 0; i < arrayOfDonations.length; i++) {
			var donation = arrayOfDonations[i];
			if (donors[donation.sender.name])
				donors[donation.sender.name] += donation.amount;
			else
				donors[donation.sender.name] = donation.amount;
			if (donation.amount > topDonor.amount)
				topDonor = {name: donation.sender.name, amount: donation.amount};
		}
		response.json({
			"status": "success",
			"donations": arrayOfDonations, // Will be largest first
			"donors": donors,
			"topDonor": topDonor
		});
	});
});

app.route("/donors").get(function(request, response) {
	Collections.Donations.find({}, {"_id": 0, "time": 0, "groupID": 0}).sort({"amount": -1}).toArray(function(err, arrayOfDonations) {
		if (err) {
			response.json({"status": "failure", "error": err});
			return;
		}
		var donors = {};
		var topDonor = {name: undefined, amount: 0};
		for (var i = 0; i < arrayOfDonations.length; i++) {
			var donation = arrayOfDonations[i];
			if (donors[donation.sender.name])
				donors[donation.sender.name] += donation.amount;
			else
				donors[donation.sender.name] = donation.amount;
			if (donation.amount > topDonor.amount)
				topDonor = {name: donation.sender.name, amount: donation.amount};
		}

		response.render("donors", {donors: donors}, function(err, html) {
			if (err) {
				console.error(err);
				return;
			}
			response.send(html);
		});
	});

});

app.all("/favicon.ico", function(request, response) {
	response.sendfile("favicon.ico");
});

app.listen(8080);
});