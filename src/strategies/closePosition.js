export class ClosePositionStrategy {
  constructor(futuresAPI, spotAPI, priceChecker, retryDelayMs = 5000) {
    this.futuresAPI = futuresAPI;
    this.spotAPI = spotAPI;
    this.priceChecker = priceChecker;
    this.retryDelayMs = retryDelayMs;
  }

  async executeLot(symbol, futuresQty, spotQty, lotNumber, totalLots) {
    console.log(`\n📊 Lot ${lotNumber}/${totalLots} - Waiting for good spread...`);
    const spreadInfo = await this.priceChecker.waitForGoodSpread(
      symbol,
      this.retryDelayMs
    );

    console.log(
      `\n✅ Good spread found: ${spreadInfo.diffPercent.toFixed(4)}% ` +
      `(Futures: $${spreadInfo.futuresPrice.toFixed(6)}, Spot: $${spreadInfo.spotPrice.toFixed(6)})`
    );

    const futuresValueUSD = futuresQty * spreadInfo.futuresPrice;
    const spotValueUSD = spotQty * spreadInfo.spotPrice;

    console.log(`💰 Closing positions:`);
    console.log(`   Futures: ${futuresQty.toFixed(8)} (~$${futuresValueUSD.toFixed(2)} USD)`);
    console.log(`   Spot: ${spotQty.toFixed(8)} (~$${spotValueUSD.toFixed(2)} USD)`);

    const [futuresOrder, spotOrder] = await Promise.all([
      this.futuresAPI.closeShort(symbol, futuresQty),
      this.spotAPI.sell(symbol, spotQty)
    ]);

    return {
      futures: futuresOrder,
      spot: spotOrder,
      spreadInfo
    };
  }

  async closeRemainingPosition(symbol, futuresPosition, spotBalance) {
    console.log(`\n⚠️  EMERGENCY CLOSE: One side is depleted, closing remaining position`);

    const results = [];

    if (futuresPosition && Math.abs(futuresPosition.positionAmt) > 0) {
      console.log(`Closing remaining futures position: ${Math.abs(futuresPosition.positionAmt)}`);
      const futuresOrder = await this.futuresAPI.closeShort(
        symbol,
        Math.abs(futuresPosition.positionAmt),
        true // Use reduceOnly for emergency close
      );
      results.push({ type: 'futures', order: futuresOrder });
      console.log(`✓ Futures position closed: ${futuresOrder.executedQty} @ ${futuresOrder.price}`);
    }

    if (spotBalance && spotBalance.free > 0) {
      console.log(`Selling remaining spot balance: ${spotBalance.free}`);
      const spotOrder = await this.spotAPI.sell(symbol, spotBalance.free);
      results.push({ type: 'spot', order: spotOrder });
      console.log(`✓ Spot sold: ${spotOrder.executedQty} @ ${spotOrder.price}`);
    }

    return results;
  }

  async getPositionsWithRetry(symbol, baseAsset, maxRetries = 10) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const [futuresPosition, spotBalance] = await Promise.all([
          this.futuresAPI.getPosition(symbol),
          this.spotAPI.getBalance(baseAsset)
        ]);
        return [futuresPosition, spotBalance];
      } catch (error) {
        console.error(`\n⚠️  Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        if (attempt < maxRetries) {
          const waitTime = this.retryDelayMs * attempt;
          console.log(`   Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw error;
        }
      }
    }
  }

  async execute(symbol, closePercentage, lotSizePercent) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔴 CLOSING FUNDING RATE ARBITRAGE POSITION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Close Percentage: ${closePercentage.toFixed(2)}%`);
    console.log(`Lot Size: ${lotSizePercent.toFixed(2)}% per lot`);
    console.log(`Max Price Spread: ${this.priceChecker.maxDiffPercent.toFixed(2)}%`);
    console.log(`${'='.repeat(60)}\n`);

    // Extract base asset from symbol (e.g., "BTCUSDT" -> "BTC")
    const baseAsset = symbol.replace('USDT', '').replace('BUSD', '');

    // Get initial positions
    console.log(`📊 Fetching current positions...`);
    const [initialFuturesPosition, initialSpotBalance] = await this.getPositionsWithRetry(symbol, baseAsset);

    const initialFuturesQty = initialFuturesPosition ? Math.abs(initialFuturesPosition.positionAmt) : 0;
    const initialSpotQty = initialSpotBalance ? initialSpotBalance.free : 0;

    if (initialFuturesQty === 0 && initialSpotQty === 0) {
      throw new Error('No positions found to close');
    }

    const currentPrice = await this.futuresAPI.getPrice(symbol);
    const initialFuturesNotional = initialFuturesQty * currentPrice;
    const initialSpotValue = initialSpotQty * currentPrice;

    console.log(`\n📈 Initial Positions:`);
    console.log(`   Futures SHORT: ${initialFuturesQty.toFixed(8)} (notional: $${initialFuturesNotional.toFixed(2)})`);
    console.log(`   Spot LONG: ${initialSpotQty.toFixed(8)} (value: $${initialSpotValue.toFixed(2)})`);
    console.log(`   Position Imbalance: ${Math.abs(initialFuturesQty - initialSpotQty).toFixed(8)} coins\n`);

    // Calculate target quantities to close
    const targetFuturesQty = initialFuturesQty * (closePercentage / 100);
    const targetSpotQty = initialSpotQty * (closePercentage / 100);

    console.log(`🎯 Target to close (${closePercentage}%):`);
    console.log(`   Futures: ${targetFuturesQty.toFixed(8)}`);
    console.log(`   Spot: ${targetSpotQty.toFixed(8)}\n`);

    const results = [];
    let totalFuturesQty = 0;
    let totalSpotQty = 0;
    let totalFuturesValue = 0;
    let totalSpotValue = 0;

    // Calculate total lots needed
    const totalLots = Math.ceil(closePercentage / lotSizePercent);
    let currentLot = 0;

    while (currentLot < totalLots) {
      currentLot++;

      // Fetch current positions and price for this lot
      const [currentFuturesPosition, currentSpotBalance] = await this.getPositionsWithRetry(symbol, baseAsset);

      const remainingFuturesQty = currentFuturesPosition ? Math.abs(currentFuturesPosition.positionAmt) : 0;
      const remainingSpotQty = currentSpotBalance ? currentSpotBalance.free : 0;

      // Break if no more position to close
      if (remainingFuturesQty < 0.00000001 && remainingSpotQty < 0.00000001) {
        console.log(`\n✅ All positions closed`);
        break;
      }

      const currentPrice = await this.futuresAPI.getPrice(symbol);

      // Calculate lot size as percentage of REMAINING position
      const lotPercentOfRemaining = lotSizePercent / (100 - (currentLot - 1) * lotSizePercent);
      let lotFuturesQty = remainingFuturesQty * lotPercentOfRemaining;
      let lotSpotQty = remainingSpotQty * lotPercentOfRemaining;

      // If this is not the last lot, check if next lot will be too small
      const nextRemainingFuturesQty = remainingFuturesQty - lotFuturesQty;
      const nextRemainingSpotQty = remainingSpotQty - lotSpotQty;
      const nextRemainingUSD = Math.min(
        nextRemainingFuturesQty * currentPrice,
        nextRemainingSpotQty * currentPrice
      );

      // If next lot will be below $5, close all remaining in this lot
      if (nextRemainingUSD > 0.01 && nextRemainingUSD < 5) {
        console.log(`\n💡 Next lot would be ~$${nextRemainingUSD.toFixed(2)} (below $5 minimum)`);
        console.log(`   Closing all remaining positions in this lot`);
        lotFuturesQty = remainingFuturesQty;
        lotSpotQty = remainingSpotQty;
      } else {
        // Adjust to not exceed remaining
        lotFuturesQty = Math.min(lotFuturesQty, remainingFuturesQty);
        lotSpotQty = Math.min(lotSpotQty, remainingSpotQty);
      }

      // Check if lot size is below minimum ($5 USD)
      const lotFuturesValueUSD = lotFuturesQty * currentPrice;
      const lotSpotValueUSD = lotSpotQty * currentPrice;

      if (lotFuturesValueUSD < 5 || lotSpotValueUSD < 5) {
        console.log(`\n⚠️  Lot size below minimum order size ($5 USD)`);
        console.log(`   Futures: $${lotFuturesValueUSD.toFixed(2)} | Spot: $${lotSpotValueUSD.toFixed(2)}`);

        // If this is the first lot and both are below $5, suggest increasing lot size
        if (currentLot === 1 && lotFuturesValueUSD < 5 && lotSpotValueUSD < 5) {
          const suggestedLotPercent = Math.ceil((5 / Math.min(initialFuturesNotional, initialSpotValue)) * 100 * (100 / closePercentage));

          throw new Error(
            `Lot size too small. Each lot must be at least $5 USD on each side.\n` +
            `  Current lot: Futures $${lotFuturesValueUSD.toFixed(2)}, Spot $${lotSpotValueUSD.toFixed(2)}\n` +
            `  Try increasing lotSizePercent to at least ${suggestedLotPercent}%\n` +
            `  Example: node src/index.js close ${symbol} ${closePercentage} ${suggestedLotPercent}`
          );
        }

        // For subsequent lots, try to close remaining
        console.log(`💡 Trying to close remaining positions...`);

        // Try to close futures with reduceOnly
        if (lotFuturesQty > 0) {
          try {
            console.log(`   Closing remaining futures: ${lotFuturesQty.toFixed(8)}`);
            const futuresOrder = await this.futuresAPI.closeShort(symbol, lotFuturesQty, true);
            totalFuturesQty += futuresOrder.executedQty;
            totalFuturesValue += futuresOrder.executedQty * futuresOrder.price;
            console.log(`   ✓ Futures CLOSED: ${futuresOrder.executedQty.toFixed(8)} @ $${futuresOrder.price.toFixed(6)}`);
          } catch (error) {
            console.log(`   ⚠️  Could not close futures: ${error.message}`);
          }
        }

        // Spot cannot bypass minimum, show warning
        if (lotSpotQty > 0) {
          const spotValueUSD = lotSpotQty * currentPrice;
          console.log(`   ⚠️  Spot remaining: ${lotSpotQty.toFixed(8)} ${baseAsset} (~$${spotValueUSD.toFixed(2)} USD)`);
          console.log(`   💡 Below minimum order size. Close manually in AsterDEX.`);
        }

        break;
      }

      try {
        const result = await this.executeLot(symbol, lotFuturesQty, lotSpotQty, currentLot, totalLots);

        // Calculate actual USD value executed
        const futuresValueExecuted = result.futures.executedQty * result.futures.price;
        const spotValueExecuted = result.spot.executedQty * result.spot.price;

        // Check if order was actually executed
        if (result.futures.executedQty === 0 || result.spot.executedQty === 0) {
          console.error(`❌ Order not executed (Futures: ${result.futures.executedQty}, Spot: ${result.spot.executedQty})`);
          console.error(`Order status - Futures: ${result.futures.status}, Spot: ${result.spot.status}`);
          throw new Error('Order was not executed. Check balance, API permissions, and order details.');
        }

        results.push(result);

        totalFuturesQty += result.futures.executedQty;
        totalSpotQty += result.spot.executedQty;
        totalFuturesValue += futuresValueExecuted;
        totalSpotValue += spotValueExecuted;

        console.log(`✓ Futures CLOSE SHORT: ${result.futures.executedQty.toFixed(8)} @ $${result.futures.price.toFixed(6)} = $${futuresValueExecuted.toFixed(2)}`);
        console.log(`✓ Spot SELL: ${result.spot.executedQty.toFixed(8)} @ $${result.spot.price.toFixed(6)} = $${spotValueExecuted.toFixed(2)}`);

        if (currentLot < totalLots) {
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
    console.log(`🔴 POSITION CLOSED SUCCESSFULLY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total Lots Executed: ${results.length}`);
    console.log(`Total Futures CLOSED: ${totalFuturesQty.toFixed(8)} @ avg $${avgFuturesPrice.toFixed(6)}`);
    console.log(`Total Spot SOLD: ${totalSpotQty.toFixed(8)} @ avg $${avgSpotPrice.toFixed(6)}`);
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
        avgSpreadPercent: avgFuturesPrice > 0 && avgSpotPrice > 0
          ? ((avgFuturesPrice - avgSpotPrice) / avgSpotPrice * 100)
          : 0
      }
    };
  }
}
