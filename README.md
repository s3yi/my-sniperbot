# my-sniperbot
The bot is developed to snip tokens on BNB,
create a folder and open in your IDE ,go to run terminal and install npm using "npm install",  create a file and name it ".env".

create .env file and copy and paste this.
PRIVATE_KEY= **********
SNIPER_CONTRACT= *********

input your wallet address private key, you will get your sniper contract after deploying the contract in remix.

download BscSniper.js put it in your folder

go to https://remix.ethereum.org/ and connect your evm wallet to your remix IDE, go to "contract folder" and create "SniperBot.sol" file , paste the codes in Sniper.sol file  and paste it there. 

deploy contract and use these information:

factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
  router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",

  After deploying contract , copy the contract address and paste it in ".env" file

  Then run node BscSniper.js in your terminal, you will newly launched tokens awaiting to be sniped

in summary:
STEP 1: DEPLOY CONTRACT (Remix)                    
│  ✅ Compile SniperBot.sol                           
│  ✅ Deploy to BSC Mainnet                           
│  ✅ Copy contract address

STEP 2: FUND CONTRACT                              
│  ✅ Send 0.1 BNB to contract or less                       
│  ✅ Verify on BscScan   

STEP 3: SETUP BOT FILES                            
│  ✅ npm install ethers dotenv                       
│  ✅ Create SniperBSC_MAINNET.js                     
│  ✅ Create AutoSell.js                            
│  ✅ Create sellControl.js    

STEP 5: RUN BOT                                    
│  ✅ node BscSniper.js                       
│  ✅ Bot monitors PancakeSwap                        
│  ✅ Auto-buys new tokens                            
│  ✅ Auto-sells at profit/loss targets 

STEP 6: MONITOR (Optional)                         
│  ✅ node sellControl.js (manual control)            
│  ✅ Check BscScan for transactions                  
│  ✅ Watch console for updates    
