export class PriceChecker {
  constructor(futuresAPI, spotAPI, maxDiffPercent) {
    this.futuresAPI = futuresAPI;
    this.spotAPI = spotAPI;
    this.maxDiffPercent = maxDiffPercent;
  }

  async getPrices(symbol) {
    try {
      const [futuresPrice, spotPrice] = await Promise.all([
        this.futuresAPI.getPrice(symbol),
        this.spotAPI.getPrice(symbol)
      ]);

      // Validate prices
      if (!futuresPrice || !spotPrice || futuresPrice <= 0 || spotPrice <= 0) {
        throw new Error(`Invalid prices - Futures: ${futuresPrice}, Spot: ${spotPrice}`);
      }

      return { futuresPrice, spotPrice };
    } catch (error) {
      throw new Error(`Failed to get prices: ${error.message}`);
    }
  }

  calculateDiffPercent(futuresPrice, spotPrice) {
    if (!spotPrice || spotPrice <= 0) {
      throw new Error(`Invalid spot price for calculation: ${spotPrice}`);
    }
    return Math.abs(((futuresPrice - spotPrice) / spotPrice) * 100);
  }

  async checkSpread(symbol) {
    try {
      const { futuresPrice, spotPrice } = await this.getPrices(symbol);
      const diffPercent = this.calculateDiffPercent(futuresPrice, spotPrice);

      return {
        futuresPrice,
        spotPrice,
        diffPercent,
        isWithinThreshold: diffPercent <= this.maxDiffPercent
      };
    } catch (error) {
      throw new Error(`Failed to check spread: ${error.message}`);
    }
  }

  async waitForGoodSpread(symbol, retryDelayMs = 5000) {
    let attempt = 0;

    while (true) {
      attempt++;

      try {
        const spreadInfo = await this.checkSpread(symbol);

        if (spreadInfo.isWithinThreshold) {
          return spreadInfo;
        }

        console.log(
          `Spread too high: ${spreadInfo.diffPercent.toFixed(4)}% ` +
          `(Futures: $${spreadInfo.futuresPrice.toFixed(6)}, Spot: $${spreadInfo.spotPrice.toFixed(6)}) - Attempt #${attempt}`
        );

        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      } catch (error) {
        console.error(`Error checking spread (attempt #${attempt}): ${error.message}`);

        // Wait and try again
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }
}
