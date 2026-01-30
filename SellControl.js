// sellControl.js - Manual sell interface
require("dotenv").config();
const { ethers } = require("ethers");
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const provider = new ethers.JsonRpcProvider("https://bsc-dataseed1.binance.org/");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const sniperAbi = [
  "function sellTokens(address token, uint256 amountIn, uint256 amountOutMin, uint256 deadline) external",
  "function getTokenBalance(address token) external view returns (uint256)",
  "function withdrawToken(address token) external",
  "function emergencyWithdrawBNB() external"
];

const sniper = new ethers.Contract(process.env.SNIPER_CONTRACT, sniperAbi, wallet);

async function showMenu() {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`💼 MANUAL SELL CONTROL`);
  console.log(`${"=".repeat(50)}`);
  console.log(`1. Check token balance in contract`);
  console.log(`2. Sell specific token`);
  console.log(`3. Withdraw token to wallet`);
  console.log(`4. Withdraw all BNB`);
  console.log(`5. Exit`);
  console.log(`${"=".repeat(50)}\n`);
}

async function checkBalance() {
  rl.question('Enter token address: ', async (tokenAddress) => {
    try {
      const balance = await sniper.getTokenBalance(tokenAddress);
      console.log(`\n💰 Balance: ${ethers.formatEther(balance)} tokens\n`);
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
    main();
  });
}

async function sellToken() {
  rl.question('Enter token address: ', async (tokenAddress) => {
    try {
      const balance = await sniper.getTokenBalance(tokenAddress);
      console.log(`Current balance: ${ethers.formatEther(balance)}`);
      
      rl.question('Enter amount to sell (or "all"): ', async (amount) => {
        const sellAmount = amount.toLowerCase() === 'all' 
          ? balance 
          : ethers.parseEther(amount);
        
        const deadline = Math.floor(Date.now() / 1000) + 300;
        
        console.log(`\n⏳ Selling ${ethers.formatEther(sellAmount)} tokens...`);
        
        const tx = await sniper.sellTokens(tokenAddress, sellAmount, 0, deadline, { gasLimit: 800000 });
        console.log(`📤 TX: https://bscscan.com/tx/${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(receipt.status === 1 ? `✅ Sold successfully!\n` : `❌ Transaction failed\n`);
        
        main();
      });
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
      main();
    }
  });
}

async function withdrawToken() {
  rl.question('Enter token address: ', async (tokenAddress) => {
    try {
      console.log(`\n⏳ Withdrawing...`);
      const tx = await sniper.withdrawToken(tokenAddress, { gasLimit: 100000 });
      await tx.wait();
      console.log(`✅ Withdrawn to your wallet!\n`);
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
    main();
  });
}

async function withdrawBNB() {
  try {
    console.log(`\n⏳ Withdrawing BNB...`);
    const tx = await sniper.emergencyWithdrawBNB({ gasLimit: 100000 });
    await tx.wait();
    console.log(`✅ BNB withdrawn to your wallet!\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }
  main();
}

async function main() {
  await showMenu();
  
  rl.question('Choose option: ', async (choice) => {
    switch(choice) {
      case '1':
        await checkBalance();
        break;
      case '2':
        await sellToken();
        break;
      case '3':
        await withdrawToken();
        break;
      case '4':
        await withdrawBNB();
        break;
      case '5':
        console.log('Goodbye!\n');
        rl.close();
        process.exit(0);
      default:
        console.log('Invalid option\n');
        main();
    }
  });
}

console.log(`\n🔧 Connecting to BSC...\n`);
main();
