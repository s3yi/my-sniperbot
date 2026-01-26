// SniperBSC_MAINNET.js


require("dotenv").config(); 
const { ethers } = require("ethers");

// ============== VERIFIED WORKING ENDPOINTS ============== 
const BSC_ENDPOINTS = {
  // HTTP RPC endpoints (always work)
  httpRpc: [
    "https://bsc-dataseed1.binance.org/",
    "https://bsc-dataseed2.binance.org/",
    "https://bsc-dataseed3.binance.org/",
    "https://bsc-dataseed4.binance.org/",
    "https://rpc.ankr.com/bsc",
    "https://bsc.publicnode.com",
  ],
  
  // WebSocket endpoints 
  wss: [
    "wss://bsc-mainnet.nodereal.io/ws/v1/64a9df0874fb4a93b9d0a3849de012d3", // NodeReal free
    "wss://bsc.publicnode.com",
  ],
  
  factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
  router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  chainId: 56
};

const SAFETY_CONFIG = {
  maxBnbPerSnipe: "0.05",
  maxTaxPercent: 10,
  minLiquidityBnb: "0.5",
  maxGasPrice: "15",
  deadlineSeconds: 300,
};

// ============== VALIDATION ============== 
const privateKey = process.env.PRIVATE_KEY?.trim(); 
const SNIPER_CONTRACT = process.env.SNIPER_CONTRACT?.trim();

if (!privateKey || !SNIPER_CONTRACT) { 
  console.error("❌ ERROR: Missing PRIVATE_KEY or SNIPER_CONTRACT in .env file!"); 
  process.exit(1); 
}

if (!/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("❌ ERROR: Invalid private key format!");
  process.exit(1);
}

if (!/^0x[0-9a-fA-F]{40}$/.test(SNIPER_CONTRACT)) {
  console.error("❌ ERROR: Invalid contract address format!");
  process.exit(1);
}

// ============== ROBUST PROVIDER CONNECTION ============== 
let provider;
let wallet;
let connectionType = "Unknown";
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function createProvider() {
  console.log("\n🔌 Connecting to BSC Mainnet...\n");
  
  // Try WebSocket first (fastest for event listening)
  for (const wssUrl of BSC_ENDPOINTS.wss) {
    try {
      console.log(`Trying WebSocket: ${wssUrl.substring(0, 50)}...`);
      
      const wsProvider = new ethers.WebSocketProvider(wssUrl, {
        name: "BSC Mainnet",
        chainId: 56
      });
      
      // Add error handlers BEFORE testing connection
      wsProvider._websocket.on('error', (err) => {
        console.error(`WebSocket error: ${err.message}`);
        handleDisconnection();
      });
      
      wsProvider._websocket.on('close', () => {
        console.log('WebSocket closed. Attempting reconnection...');
        handleDisconnection();
      });
      
      // Test connection with timeout
      const testPromise = wsProvider.getBlockNumber();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );
      
      await Promise.race([testPromise, timeoutPromise]);
      
      console.log(`✅ Connected via WebSocket!\n`);
      connectionType = "WebSocket (Fast)";
      return wsProvider;
      
    } catch (err) {
      console.log(`❌ Failed: ${err.message}\n`);
      continue;
    }
  }
  
  // Fallback to HTTP (slower but more stable)
  console.log("⚠️  All WebSockets failed. Using HTTP fallback (polling mode)...\n");
  
  for (const rpcUrl of BSC_ENDPOINTS.httpRpc) {
    try {
      console.log(`Trying HTTP: ${rpcUrl}...`);
      
      const httpProvider = new ethers.JsonRpcProvider(rpcUrl, {
        name: "BSC Mainnet",
        chainId: 56
      });
      
      // Test connection
      await httpProvider.getBlockNumber();
      
      console.log(`✅ Connected via HTTP!\n`);
      connectionType = "HTTP Polling (Stable)";
      return httpProvider;
      
    } catch (err) {
      console.log(`❌ Failed: ${err.message}\n`);
      continue;
    }
  }
  
  throw new Error("❌ Could not connect to ANY BSC endpoint!");
}

async function handleDisconnection() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`❌ Max reconnection attempts reached. Exiting...`);
    process.exit(1);
  }
  
  reconnectAttempts++;
  console.log(`\n🔄 Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  
  try {
    provider = await createProvider();
    wallet = new ethers.Wallet(privateKey, provider);
    reconnectAttempts = 0; // Reset on successful reconnection
    console.log("✅ Reconnected successfully!\n");
    
    // Re-setup listeners
    setupEventListeners();
  } catch (err) {
    console.error(`❌ Reconnection failed: ${err.message}`);
    setTimeout(handleDisconnection, 5000); // Retry after 5 seconds
  }
}

// ============== MAIN BOT ============== 
let sniper;
let factory;
let router;
let snipeCount = 0;
const snipedTokens = new Map();

function setupEventListeners() {
  const factoryAbi = ["event PairCreated(address indexed token0, address indexed token1, address pair, uint)"];
  factory = new ethers.Contract(BSC_ENDPOINTS.factory, factoryAbi, provider);
  
  // Remove old listeners before adding new ones
  factory.removeAllListeners("PairCreated");
  
  factory.on("PairCreated", async (token0, token1, pair, event) => {
    try {
      let token = null;
      const wbnb = BSC_ENDPOINTS.wbnb.toLowerCase();
      
      if (token0.toLowerCase() === wbnb) token = token1;
      else if (token1.toLowerCase() === wbnb) token = token0;
      else return;
      
      console.log(`\n${"=".repeat(60)}`);
      console.log(`🎯 NEW TOKEN DETECTED!`);
      console.log(`${"=".repeat(60)}`);
      console.log(`🪙 Token: ${token}`);
      console.log(`💱 Pair: ${pair}`);
      console.log(`🔗 Tx: https://bscscan.com/tx/${event.log.transactionHash}`);
      console.log(`⏰ ${new Date().toLocaleString()}\n`);
      
      // Check liquidity
      const pairAbi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
      const pairContract = new ethers.Contract(pair, pairAbi, provider);
      const reserves = await pairContract.getReserves();
      
      const bnbReserve = token0.toLowerCase() === wbnb ? reserves.reserve0 : reserves.reserve1;
      const liquidityBnb = ethers.formatEther(bnbReserve);
      
      console.log(`💧 Liquidity: ${parseFloat(liquidityBnb).toFixed(4)} BNB`);
      
      if (parseFloat(liquidityBnb) < parseFloat(SAFETY_CONFIG.minLiquidityBnb)) {
        console.log(`❌ SKIPPED: Liquidity too low (min: ${SAFETY_CONFIG.minLiquidityBnb} BNB)\n`);
        return;
      }
      
      // Get gas price
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasPriceGwei = ethers.formatUnits(gasPrice, "gwei");
      
      console.log(`⛽ Gas: ${parseFloat(gasPriceGwei).toFixed(2)} Gwei`);
      
      if (parseFloat(gasPriceGwei) > parseFloat(SAFETY_CONFIG.maxGasPrice)) {
        console.log(`❌ SKIPPED: Gas too high (max: ${SAFETY_CONFIG.maxGasPrice} Gwei)\n`);
        return;
      }
      
      // Execute snipe
      const amountBnb = ethers.parseEther(SAFETY_CONFIG.maxBnbPerSnipe);
      const deadline = Math.floor(Date.now() / 1000) + SAFETY_CONFIG.deadlineSeconds;
      const snipeGasPrice = gasPrice * 120n / 100n; // 20% higher for speed
      
      console.log(`\n⚡ SNIPING: ${SAFETY_CONFIG.maxBnbPerSnipe} BNB | Max Tax: ${SAFETY_CONFIG.maxTaxPercent}%\n`);
      
      const tx = await sniper.snipeWithTaxCheck(
        token, 
        0, 
        SAFETY_CONFIG.maxTaxPercent, 
        deadline,
        { 
          value: amountBnb, 
          gasLimit: 800000, 
          gasPrice: snipeGasPrice 
        }
      );
      
      console.log(`📤 TX: https://bscscan.com/tx/${tx.hash}`);
      console.log(`⏳ Waiting for confirmation...\n`);
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        snipeCount++;
        console.log(`✅ SUCCESS! Block: ${receipt.blockNumber} | Total Snipes: ${snipeCount}\n`);
        snipedTokens.set(token.toLowerCase(), { pair, time: Date.now(), tx: tx.hash });
      } else {
        console.log(`❌ FAILED: Transaction reverted\n`);
      }
      
    } catch (err) {
      console.log(`❌ Snipe Error: ${err.message}\n`);
      
      if (err.message?.includes("insufficient funds")) {
        console.log(`💡 Tip: Add more BNB to wallet or contract\n`);
      } else if (err.message?.includes("execution reverted")) {
        console.log(`💡 Tip: Token might be honeypot or tax too high\n`);
      }
    }
  });
  
  console.log("✅ Event listeners active!\n");
}

// ============== STARTUP ============== 
(async () => {
  try {
    // Connect to provider
    provider = await createProvider();
    wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`🚀 ═══════════════════════════════════════════════════`);
    console.log(`🔴 SNIPER BOT - BSC MAINNET (REAL MONEY!) 🔴`);
    console.log(`═══════════════════════════════════════════════════\n`);
    console.log(`💼 Wallet: ${wallet.address}`);
    console.log(`📜 Contract: ${SNIPER_CONTRACT}`);
    console.log(`🔌 Connection: ${connectionType}`);
    console.log(`💰 Max/Snipe: ${SAFETY_CONFIG.maxBnbPerSnipe} BNB`);
    console.log(`🛡️  Max Tax: ${SAFETY_CONFIG.maxTaxPercent}%`);
    console.log(`⛽ Max Gas: ${SAFETY_CONFIG.maxGasPrice} Gwei\n`);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    const bnbBalance = ethers.formatEther(balance);
    console.log(`💵 Balance: ${parseFloat(bnbBalance).toFixed(4)} BNB\n`);
    
    if (parseFloat(bnbBalance) < parseFloat(SAFETY_CONFIG.maxBnbPerSnipe)) {
      console.warn(`⚠️  WARNING: Balance too low!\n`);
    }
    
    // Connect to sniper contract
    const sniperAbi = [
      "function snipeWithTaxCheck(address token, uint256 amountOutMin, uint256 maxTaxPercent, uint256 deadline) external payable",
      "function emergencyWithdrawBNB() external"
    ];
    sniper = new ethers.Contract(SNIPER_CONTRACT, sniperAbi, wallet);
    
    // Setup listeners
    setupEventListeners();
    
    console.log(`👀 Listening for new tokens on PancakeSwap...\n`);
    
    // Heartbeat
    setInterval(() => {
      console.log(`💓 ${new Date().toLocaleTimeString()} | Connection: ${connectionType} | Snipes: ${snipeCount}`);
    }, 5 * 60 * 1000);
    
  } catch (err) {
    console.error(`\n❌ FATAL ERROR: ${err.message}`);
    console.error(`\nStack trace:`, err.stack);
    process.exit(1);
  }
})();

// ============== GRACEFUL SHUTDOWN ============== 
process.on('SIGINT', async () => {
  console.log(`\n\n🛑 Shutting down gracefully...\n`);
  console.log(`📊 Total snipes: ${snipeCount}`);
  
  try {
    console.log(`🔄 Withdrawing BNB from contract...`);
    const tx = await sniper.emergencyWithdrawBNB({ gasLimit: 100000 });
    await tx.wait();
    console.log(`✅ Withdrawal complete!`);
  } catch (err) {
    console.log(`❌ Withdrawal failed: ${err.message}`);
  }
  
  if (snipedTokens.size > 0) {
    console.log(`\n📋 Sniped tokens still in contract:`);
    for (const [token, info] of snipedTokens) {
      console.log(`   ${token} - ${info.tx}`);
    }
  }
  
  console.log(`\n👋 Goodbye!\n`);
  process.exit(0);
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error(`\n❌ UNCAUGHT EXCEPTION: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`\n❌ UNHANDLED REJECTION:`, reason);
});


console.log(`\n⏳ Starting bot...\n`);
