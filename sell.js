require("dotenv").config();
const { ethers } = require("ethers");

const BSC_RPC = "https://bsc-dataseed1.binance.org/";
const ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

const privateKey = process.env.PRIVATE_KEY;
const contractAddr = process.env.SNIPER_CONTRACT;

const provider = new ethers.JsonRpcProvider(BSC_RPC);
const wallet = new ethers.Wallet(privateKey, provider);

const abi = [
  "function sellTokens(address token, uint256 amountIn, uint256 amountOutMin, uint256 deadline)",
  "function getTokenBalance(address token) view returns (uint256)"
];

const sniper = new ethers.Contract(contractAddr, abi, wallet);

async function sell(tokenAddress) {
  console.log("🔍 Checking balance...\n");
  
  const balance = await sniper.getTokenBalance(tokenAddress);
  console.log("Balance:", ethers.formatEther(balance), "tokens\n");
  
  if (balance === 0n) {
    console.log("❌ No tokens to sell!");
    return;
  }
  
  console.log("💰 Selling all tokens...\n");
  
  const deadline = Math.floor(Date.now() / 1000) + 300;
  
  const tx = await sniper.sellTokens(
    tokenAddress,
    balance,
    0, // Accept any amount (risky but necessary)
    deadline,
    { gasLimit: 500000 }
  );
  
  console.log("📤 TX:", `https://bscscan.com/tx/${tx.hash}`);
  console.log("⏳ Waiting...\n");
  
  const receipt = await tx.wait();
  
  if (receipt.status === 1) {
    console.log("✅ SOLD! Check your contract for BNB.\n");
  } else {
    console.log("❌ FAILED: Transaction reverted\n");
  }
}

// Usage: node sell.js
const tokenToSell = "0xTOKEN_ADDRESS_HERE";
sell(tokenToSell);