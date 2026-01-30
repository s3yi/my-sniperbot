// AutoSell.js - Automatic Token Selling Module
const { ethers } = require("ethers");

class AutoSeller {
  constructor(provider, wallet, sniperContract, config = {}) {
    this.provider = provider;
    this.wallet = wallet;
    this.sniperContract = sniperContract;
    
    // Default sell strategies
    this.config = {
      // Price-based selling
      takeProfitPercent: config.takeProfitPercent || 100,      // Sell at 2x (100% profit)
      stopLossPercent: config.stopLossPercent || -50,          // Sell at -50% loss
      
      // Time-based selling
      maxHoldTimeMinutes: config.maxHoldTimeMinutes || 60,     // Sell after 1 hour
      
      // Tax protection
      maxSellTaxPercent: config.maxSellTaxPercent || 15,       // Don't sell if tax > 15%
      
      // Liquidity check
      minLiquidityForSell: config.minLiquidityForSell || 0.5,  // Min 0.5 BNB liquidity
      
      // Monitoring
      checkIntervalSeconds: config.checkIntervalSeconds || 30,  // Check every 30 seconds
      
      // Partial selling
      enablePartialSells: config.enablePartialSells || true,   // Sell in chunks
      partialSellPercent: config.partialSellPercent || 50,     // Sell 50% at take profit
      
      ...config
    };
    
    // Track held tokens
    this.heldTokens = new Map();
    this.sellHistory = [];
    
    // Monitoring interval
    this.monitoringInterval = null;
  }
  
  /**
   * Add token to auto-sell watchlist
   */
  addToken(tokenAddress, purchaseData) {
    const tokenInfo = {
      address: tokenAddress.toLowerCase(),
      buyPrice: purchaseData.buyPrice,
      buyAmount: purchaseData.buyAmount,
      bnbSpent: purchaseData.bnbSpent,
      buyTime: Date.now(),
      buyTxHash: purchaseData.txHash,
      pair: purchaseData.pair,
      
      // Tracking
      highestPrice: purchaseData.buyPrice,
      lowestPrice: purchaseData.buyPrice,
      lastCheckedPrice: purchaseData.buyPrice,
      
      // Status
      sold: false,
      partialSold: false,
      remainingAmount: purchaseData.buyAmount
    };
    
    this.heldTokens.set(tokenAddress.toLowerCase(), tokenInfo);
    
    console.log(`\n📊 Added to auto-sell tracker:`);
    console.log(`   Token: ${tokenAddress}`);
    console.log(`   Buy Price: ${purchaseData.buyPrice.toFixed(10)} BNB`);
    console.log(`   Amount: ${purchaseData.buyAmount}`);
    console.log(`   Target Profit: ${this.config.takeProfitPercent}%`);
    console.log(`   Stop Loss: ${this.config.stopLossPercent}%\n`);
  }
  
  /**
   * Get current token price from PancakeSwap pair
   */
  async getTokenPrice(tokenAddress, pairAddress) {
    try {
      const pairAbi = [
        "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
        "function token0() external view returns (address)",
        "function token1() external view returns (address)"
      ];
      
      const pairContract = new ethers.Contract(pairAddress, pairAbi, this.provider);
      
      const [reserve0, reserve1] = await pairContract.getReserves();
      const token0 = await pairContract.token0();
      const token1 = await pairContract.token1();
      
      const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
      
      let bnbReserve, tokenReserve;
      
      if (token0.toLowerCase() === WBNB.toLowerCase()) {
        bnbReserve = reserve0;
        tokenReserve = reserve1;
      } else {
        bnbReserve = reserve1;
        tokenReserve = reserve0;
      }
      
      // Price = BNB Reserve / Token Reserve
      const price = parseFloat(ethers.formatEther(bnbReserve)) / 
                   parseFloat(ethers.formatEther(tokenReserve));
      
      return {
        price,
        bnbReserve: parseFloat(ethers.formatEther(bnbReserve)),
        tokenReserve: parseFloat(ethers.formatEther(tokenReserve))
      };
      
    } catch (error) {
      console.error(`Error getting price for ${tokenAddress}:`, error.message);
      return null;
    }
  }
  
  /**
   * Calculate profit percentage
   */
  calculateProfit(buyPrice, currentPrice) {
    return ((currentPrice - buyPrice) / buyPrice) * 100;
  }
  
  /**
   * Check if token should be sold
   */
  async shouldSellToken(tokenInfo) {
    const priceData = await this.getTokenPrice(tokenInfo.address, tokenInfo.pair);
    
    if (!priceData) {
      console.log(`⚠️  Could not get price for ${tokenInfo.address}`);
      return { shouldSell: false, reason: 'price_check_failed' };
    }
    
    const currentPrice = priceData.price;
    const profitPercent = this.calculateProfit(tokenInfo.buyPrice, currentPrice);
    const holdTimeMinutes = (Date.now() - tokenInfo.buyTime) / (1000 * 60);
    
    // Update tracking
    tokenInfo.lastCheckedPrice = currentPrice;
    if (currentPrice > tokenInfo.highestPrice) tokenInfo.highestPrice = currentPrice;
    if (currentPrice < tokenInfo.lowestPrice) tokenInfo.lowestPrice = currentPrice;
    
    // Check liquidity
    if (priceData.bnbReserve < this.config.minLiquidityForSell) {
      console.log(`⚠️  ${tokenInfo.address} - Low liquidity (${priceData.bnbReserve.toFixed(2)} BNB)`);
      return { shouldSell: false, reason: 'low_liquidity' };
    }
    
    // Take Profit
    if (profitPercent >= this.config.takeProfitPercent) {
      return {
        shouldSell: true,
        reason: 'take_profit',
        profitPercent,
        currentPrice,
        sellPercent: this.config.enablePartialSells && !tokenInfo.partialSold 
                     ? this.config.partialSellPercent 
                     : 100
      };
    }
    
    // Stop Loss
    if (profitPercent <= this.config.stopLossPercent) {
      return {
        shouldSell: true,
        reason: 'stop_loss',
        profitPercent,
        currentPrice,
        sellPercent: 100
      };
    }
    
    // Time-based exit
    if (holdTimeMinutes >= this.config.maxHoldTimeMinutes) {
      return {
        shouldSell: true,
        reason: 'max_hold_time',
        profitPercent,
        currentPrice,
        sellPercent: 100
      };
    }
    
    // Trailing stop (optional - sell if price drops 30% from highest)
    const dropFromHigh = ((tokenInfo.highestPrice - currentPrice) / tokenInfo.highestPrice) * 100;
    if (dropFromHigh >= 30 && profitPercent > 0) {
      return {
        shouldSell: true,
        reason: 'trailing_stop',
        profitPercent,
        currentPrice,
        sellPercent: 100
      };
    }
    
    return { shouldSell: false, profitPercent, currentPrice };
  }
  
  /**
   * Execute token sell
   */
  async sellToken(tokenInfo, sellDecision) {
    try {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`💰 SELLING TOKEN`);
      console.log(`${"=".repeat(60)}`);
      console.log(`🪙 Token: ${tokenInfo.address}`);
      console.log(`📊 Reason: ${sellDecision.reason.toUpperCase()}`);
      console.log(`💵 Buy Price: ${tokenInfo.buyPrice.toFixed(10)} BNB`);
      console.log(`💵 Current Price: ${sellDecision.currentPrice.toFixed(10)} BNB`);
      console.log(`📈 Profit: ${sellDecision.profitPercent.toFixed(2)}%`);
      console.log(`📦 Selling: ${sellDecision.sellPercent}%\n`);
      
      // Calculate amount to sell
      const sellAmount = (tokenInfo.remainingAmount * BigInt(sellDecision.sellPercent)) / 100n;
      
      // Get token balance in contract
      const tokenAbi = ["function balanceOf(address) view returns (uint256)"];
      const tokenContract = new ethers.Contract(tokenInfo.address, tokenAbi, this.provider);
      const contractBalance = await tokenContract.balanceOf(this.sniperContract.target);
      
      console.log(`📊 Contract Balance: ${ethers.formatEther(contractBalance)}`);
      console.log(`📊 Attempting to sell: ${ethers.formatEther(sellAmount)}\n`);
      
      // Execute sell through sniper contract
      const deadline = Math.floor(Date.now() / 1000) + 300;
      
      const tx = await this.sniperContract.sellTokens(
        tokenInfo.address,
        sellAmount,
        0, // amountOutMin (no slippage protection for emergency sells)
        deadline,
        { gasLimit: 800000 }
      );
      
      console.log(`📤 Sell TX: https://bscscan.com/tx/${tx.hash}`);
      console.log(`⏳ Waiting for confirmation...\n`);
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        // Parse Sold event to get actual BNB received
        const soldEvent = receipt.logs.find(log => {
          try {
            const parsed = this.sniperContract.interface.parseLog(log);
            return parsed.name === 'Sold';
          } catch {
            return false;
          }
        });
        
        let bnbReceived = 0;
        if (soldEvent) {
          const parsed = this.sniperContract.interface.parseLog(soldEvent);
          bnbReceived = parseFloat(ethers.formatEther(parsed.args.bnbOut));
        }
        
        const profitBnb = bnbReceived - (tokenInfo.bnbSpent * sellDecision.sellPercent / 100);
        
        console.log(`✅ SELL SUCCESS!`);
        console.log(`💰 BNB Received: ${bnbReceived.toFixed(4)} BNB`);
        console.log(`📊 Profit/Loss: ${profitBnb >= 0 ? '+' : ''}${profitBnb.toFixed(4)} BNB (${sellDecision.profitPercent.toFixed(2)}%)`);
        console.log(`🔗 Block: ${receipt.blockNumber}\n`);
        
        // Update token info
        if (sellDecision.sellPercent === 100) {
          tokenInfo.sold = true;
          this.heldTokens.delete(tokenInfo.address);
        } else {
          tokenInfo.partialSold = true;
          tokenInfo.remainingAmount = tokenInfo.remainingAmount - sellAmount;
        }
        
        // Record in history
        this.sellHistory.push({
          token: tokenInfo.address,
          reason: sellDecision.reason,
          buyPrice: tokenInfo.buyPrice,
          sellPrice: sellDecision.currentPrice,
          profitPercent: sellDecision.profitPercent,
          profitBnb,
          bnbReceived,
          sellPercent: sellDecision.sellPercent,
          txHash: tx.hash,
          timestamp: Date.now()
        });
        
        return { success: true, profitBnb, bnbReceived };
        
      } else {
        console.log(`❌ SELL FAILED: Transaction reverted\n`);
        return { success: false, error: 'transaction_reverted' };
      }
      
    } catch (error) {
      console.log(`❌ Sell Error: ${error.message}\n`);
      
      if (error.message?.includes("execution reverted")) {
        console.log(`💡 Possible honeypot - cannot sell this token\n`);
        tokenInfo.sold = true; // Mark as sold to stop trying
        this.heldTokens.delete(tokenInfo.address);
      }
      
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Monitor all held tokens
   */
  async monitorTokens() {
    if (this.heldTokens.size === 0) {
      return;
    }
    
    console.log(`\n🔍 Monitoring ${this.heldTokens.size} token(s)...`);
    
    for (const [address, tokenInfo] of this.heldTokens) {
      if (tokenInfo.sold) continue;
      
      try {
        const sellDecision = await this.shouldSellToken(tokenInfo);
        
        if (sellDecision.shouldSell) {
          await this.sellToken(tokenInfo, sellDecision);
        } else {
          // Just log status
          const holdTimeMin = ((Date.now() - tokenInfo.buyTime) / (1000 * 60)).toFixed(1);
          console.log(`   ${address.substring(0, 10)}... | Profit: ${sellDecision.profitPercent?.toFixed(2) || '?'}% | Hold: ${holdTimeMin}m`);
        }
        
      } catch (error) {
        console.error(`   Error monitoring ${address}: ${error.message}`);
      }
    }
  }
  
  /**
   * Start auto-monitoring
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      console.log(`⚠️  Monitoring already active`);
      return;
    }
    
    console.log(`\n🤖 Auto-Seller Started!`);
    console.log(`📊 Take Profit: ${this.config.takeProfitPercent}%`);
    console.log(`📊 Stop Loss: ${this.config.stopLossPercent}%`);
    console.log(`⏱️  Max Hold Time: ${this.config.maxHoldTimeMinutes} minutes`);
    console.log(`🔄 Check Interval: ${this.config.checkIntervalSeconds} seconds\n`);
    
    this.monitoringInterval = setInterval(
      () => this.monitorTokens(),
      this.config.checkIntervalSeconds * 1000
    );
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log(`\n🛑 Auto-Seller Stopped\n`);
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const totalSells = this.sellHistory.length;
    const profitableSells = this.sellHistory.filter(s => s.profitBnb > 0).length;
    const totalProfitBnb = this.sellHistory.reduce((sum, s) => sum + s.profitBnb, 0);
    
    return {
      totalSells,
      profitableSells,
      lossSells: totalSells - profitableSells,
      winRate: totalSells > 0 ? (profitableSells / totalSells * 100).toFixed(2) : 0,
      totalProfitBnb: totalProfitBnb.toFixed(4),
      heldTokensCount: this.heldTokens.size,
      sellHistory: this.sellHistory
    };
  }
  
  /**
   * Force sell token (manual override)
   */
  async forceSell(tokenAddress) {
    const tokenInfo = this.heldTokens.get(tokenAddress.toLowerCase());
    
    if (!tokenInfo) {
      console.log(`❌ Token not found in watchlist: ${tokenAddress}`);
      return { success: false };
    }
    
    const priceData = await this.getTokenPrice(tokenInfo.address, tokenInfo.pair);
    
    if (!priceData) {
      console.log(`❌ Could not get price for ${tokenAddress}`);
      return { success: false };
    }
    
    const profitPercent = this.calculateProfit(tokenInfo.buyPrice, priceData.price);
    
    const sellDecision = {
      shouldSell: true,
      reason: 'manual_override',
      profitPercent,
      currentPrice: priceData.price,
      sellPercent: 100
    };
    
    return await this.sellToken(tokenInfo, sellDecision);
  }
}

module.exports = AutoSeller;
