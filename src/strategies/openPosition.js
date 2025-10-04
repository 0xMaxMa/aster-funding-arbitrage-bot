export class OpenPositionStrategy {
  constructor(futuresAPI, spotAPI, priceChecker, retryDelayMs = 5000) {
    this.futuresAPI = futuresAPI;
    this.spotAPI = spotAPI;
    this.priceChecker = priceChecker;
    this.retryDelayMs = retryDelayMs;
  }

  async executeLot(symbol, lotSizeUSD, lotNumber, totalLots) {
    console.log(`\n📊 Lot ${lotNumber}/${totalLots} - Waiting for good spread...`);
    const spreadInfo = await this.priceChecker.waitForGoodSpread(
      symbol,
      this.retryDelayMs
    );

    console.log(
      `\n✅ Good spread found: ${spreadInfo.diffPercent.toFixed(4)}% ` +
      `(Futures: $${spreadInfo.futuresPrice.toFixed(6)}, Spot: $${spreadInfo.spotPrice.toFixed(6)})`
    );

    // Validate prices before calculation
    if (!spreadInfo.futuresPrice || !spreadInfo.spotPrice ||
        spreadInfo.futuresPrice <= 0 || spreadInfo.spotPrice <= 0) {
      throw new Error(`Invalid prices received - Futures: ${spreadInfo.futuresPrice}, Spot: ${spreadInfo.spotPrice}`);
    }

    // Convert USD to quantity using the current prices
    const futuresQty = lotSizeUSD / spreadInfo.futuresPrice;
    const spotQty = lotSizeUSD / spreadInfo.spotPrice;

    // Validate calculated quantities
    if (!isFinite(futuresQty) || !isFinite(spotQty) || futuresQty <= 0 || spotQty <= 0) {
      throw new Error(`Invalid quantity calculated - Futures: ${futuresQty}, Spot: ${spotQty}`);
    }

    console.log(`💰 Opening positions for lot size: $${lotSizeUSD.toFixed(2)} USD`);
    console.log(`📈 Futures quantity: ${futuresQty.toFixed(8)} | Spot quantity: ${spotQty.toFixed(8)}`);

    const [futuresOrder, spotOrder] = await Promise.all([
      this.futuresAPI.openShort(symbol, futuresQty),
      this.spotAPI.buy(symbol, spotQty)
    ]);

    return {
      futures: futuresOrder,
      spot: spotOrder,
      spreadInfo
    };
  }

  async execute(symbol, totalSizeUSD, lotSizeUSD) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🟢 OPENING FUNDING RATE ARBITRAGE POSITION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Total Size: $${totalSizeUSD.toFixed(2)} USD`);
    console.log(`Lot Size: $${lotSizeUSD.toFixed(2)} USD`);
    console.log(`Max Price Spread: ${this.priceChecker.maxDiffPercent.toFixed(2)}%`);
    console.log(`${'='.repeat(60)}\n`);

    const results = [];
    let remainingSizeUSD = totalSizeUSD;
    let totalFuturesQty = 0;
    let totalSpotQty = 0;
    let totalFuturesValue = 0;
    let totalSpotValue = 0;

    // Calculate total lots needed
    const totalLots = Math.ceil(totalSizeUSD / lotSizeUSD);
    let currentLot = 0;

    while (remainingSizeUSD > 0.01) { // Stop when remaining is less than $0.01
      currentLot++;
      let currentLotSizeUSD = Math.min(lotSizeUSD, remainingSizeUSD);

      // Check if next lot will be too small, if so, add it to current lot
      const nextRemainingUSD = remainingSizeUSD - currentLotSizeUSD;
      if (nextRemainingUSD > 0.01 && nextRemainingUSD < 5) {
        console.log(`\n💡 Next lot would be $${nextRemainingUSD.toFixed(2)} (below $5 minimum)`);
        console.log(`   Combining with current lot: $${currentLotSizeUSD.toFixed(2)} + $${nextRemainingUSD.toFixed(2)} = $${(currentLotSizeUSD + nextRemainingUSD).toFixed(2)}`);
        currentLotSizeUSD += nextRemainingUSD;
      }

      // Check if lot size is below minimum ($5 USD)
      if (currentLotSizeUSD < 5) {
        console.log(`\n⚠️  Remaining size $${currentLotSizeUSD.toFixed(2)} USD is below minimum order size ($5 USD)`);
        console.log(`💡 Skipping remaining amount to avoid order rejection`);
        break;
      }

      // Check if we have enough balance for this lot
      try {
        const [usdtBalance, futuresBalance] = await Promise.all([
          this.spotAPI.getBalance('USDT'),
          this.futuresAPI.getBalance('USDT')
        ]);

        const requiredPerSide = currentLotSizeUSD / 2;
        const availableSpotUSDT = usdtBalance ? usdtBalance.free : 0;
        const availableFuturesUSDT = futuresBalance ? futuresBalance.free : 0;

        if (availableSpotUSDT < requiredPerSide || availableFuturesUSDT < requiredPerSide) {
          console.log(`\n⚠️  Insufficient balance for next lot ($${currentLotSizeUSD.toFixed(2)} USD)`);
          if (availableSpotUSDT < requiredPerSide) {
            console.log(`   Spot: need $${requiredPerSide.toFixed(2)} but have $${availableSpotUSDT.toFixed(2)}`);
          }
          if (availableFuturesUSDT < requiredPerSide) {
            console.log(`   Futures: need $${requiredPerSide.toFixed(2)} but have $${availableFuturesUSDT.toFixed(2)}`);
          }
          console.log(`💡 Stopping here and showing summary`);
          break;
        }
      } catch (balanceError) {
        console.log(`\n⚠️  Could not check balance: ${balanceError.message}`);
        console.log(`💡 Continuing anyway (will fail if insufficient)`);
      }

      try {
        const result = await this.executeLot(symbol, currentLotSizeUSD, currentLot, totalLots);

        // Calculate actual USD value executed
        const futuresValueExecuted = result.futures.executedQty * result.futures.price;
        const spotValueExecuted = result.spot.executedQty * result.spot.price;
        const avgValueExecuted = (futuresValueExecuted + spotValueExecuted) / 2;

        // Check if order was actually executed
        if (result.futures.executedQty === 0 || result.spot.executedQty === 0) {
          console.error(`❌ Order not executed (Futures: ${result.futures.executedQty}, Spot: ${result.spot.executedQty})`);
          console.error(`Order status - Futures: ${result.futures.status}, Spot: ${result.spot.status}`);
          throw new Error('Order was not executed. Check balance, API permissions, and order details.');
        }

        results.push(result);

        remainingSizeUSD -= avgValueExecuted;

        totalFuturesQty += result.futures.executedQty;
        totalSpotQty += result.spot.executedQty;
        totalFuturesValue += futuresValueExecuted;
        totalSpotValue += spotValueExecuted;

        console.log(`✓ Futures SHORT: ${result.futures.executedQty.toFixed(8)} @ $${result.futures.price.toFixed(6)} = $${futuresValueExecuted.toFixed(2)}`);
        console.log(`✓ Spot BUY: ${result.spot.executedQty.toFixed(8)} @ $${result.spot.price.toFixed(6)} = $${spotValueExecuted.toFixed(2)}`);
        console.log(`Remaining: $${Math.max(0, remainingSizeUSD).toFixed(2)} USD`);

        if (remainingSizeUSD > 0.01) {
          console.log(`\nWaiting ${this.retryDelayMs}ms before next lot...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
        }
      } catch (error) {
        console.error(`\n❌ Error executing lot: ${error.message}`);
        throw error;
      }
    }

    const avgFuturesPrice = totalFuturesQty > 0 ? totalFuturesValue / totalFuturesQty : 0;
    const avgSpotPrice = totalSpotQty > 0 ? totalSpotValue / totalSpotQty : 0;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🟢 POSITION OPENED SUCCESSFULLY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total Lots Executed: ${results.length}`);
    console.log(`Total Futures SHORT: ${totalFuturesQty.toFixed(8)} @ avg $${avgFuturesPrice.toFixed(6)}`);
    console.log(`Total Spot BUY: ${totalSpotQty.toFixed(8)} @ avg $${avgSpotPrice.toFixed(6)}`);
    console.log(`Total Futures Value: $${totalFuturesValue.toFixed(2)} USD`);
    console.log(`Total Spot Value: $${totalSpotValue.toFixed(2)} USD`);
    console.log(`Total Combined Value: $${(totalFuturesValue + totalSpotValue).toFixed(2)} USD`);
    if (avgFuturesPrice > 0 && avgSpotPrice > 0) {
      console.log(`Average Spread: ${((avgFuturesPrice - avgSpotPrice) / avgSpotPrice * 100).toFixed(4)}%`);
    }
    console.log(`${'='.repeat(60)}\n`);

    return {
      results,
      summary: {
        totalLots: results.length,
        totalFuturesQty,
        totalSpotQty,
        avgFuturesPrice,
        avgSpotPrice,
        totalFuturesValue,
        totalSpotValue,
        totalCombinedValue: totalFuturesValue + totalSpotValue,
        avgSpreadPercent: ((avgFuturesPrice - avgSpotPrice) / avgSpotPrice * 100)
      }
    };
  }
}
