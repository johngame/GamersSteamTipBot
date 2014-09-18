GamersSteamTipBot
=================

![Gamerscoin](https://raw.githubusercontent.com/gamers-coin/gamers-coinv3/01d1ca6d63b565ea46dcee3b6552b030d57d1187/src/qt/res/icons/bitcoin.png)![Gamerscoin](http://i.imgur.com/Nfb8DQx.png)

Project supported by :
[![tip for next commit](http://game4commit.gamers-coin.org/projects/21.svg)](http://game4commit.gamers-coin.org/projects/21)

Tip Gamers on Steam with Gamerscoin! We are one big Happy Family !!!

What is Gamerscoin?[gamers-coin.org]

If you have been invited to join the group by gamerstippingbot, someone tipped you! 
Join the group chat room to accept your tip!

To send the bot commands, open up the group chat and double click on gamerstippingbot's name (with the golden star) in the sidebar to send a private message. Send "+register" to register yourself with the bot, receive a deposit address and start tipping!

The bot's name is 'gamerstippingbot' Don't interact with anyone else that pretends to be him

Commands:
```
+register - Notify the bot that you exist. You will receive a deposit address that is locked to your account.
+deposit - Display deposit address
+balance - Check the amount of Gamerscoin in your wallet.
+history - Display your current balance and a list of your 10 most recent transactions
+withdraw Gamerscoins - Withdraw funds in your account to the specified address
+tip Gamerscoin (+verify) - Send a Steam user a tip. People who aren't registered with the bot will be sent a friend request. 
If +verify is added, the bot will send a message confirming the tip to the group chat. More information at the bot's website[gamerstipbot.gamers-coin.org]
+version - Current bot version
+help - Help dialog with these commands
```    
    
    GamersTippingBot by Ryan Petschek (RazeTheRoof) <petschekr@gmail.com>
    
    Donate Gamerscoins to Ryan : GebvwKXVPxj9KVjqQsHP3jvHKR1ZzNnaTe

	
All Contributors are Welcome!!!

Installing GamerscoinTipBot on Linux :

```
//Install Gamerscoin Daemon
echo "deb http://debian.gamers-coin.org:8080 debian/" >> /etc/apt/sources.list
apt-get update
apt-get install gamerscoind

//Start Gamerscoin Deamon
gamerscoind

//Change gamerscoin.conf ~/.gamerscoin/gamerscoin.conf
rpcuser=gamerscoinrpc
rpcpassword=enter_your_password
rpcallowip=127.0.0.1
server=1
daemon=1
txindex=1

//Clone the Project and compile the Tipbot
git clone https://github.com/johngame/GamersSteamTipBot
cd GamersSteamTipBot
npm install
tsc bot.ts --module "commonjs"

//Run the GamerscoinTipBot
node bot.js
```
	