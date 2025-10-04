#!/usr/bin/env node

import dotenv from 'dotenv';
import { FuturesAPI } from './api/futures.js';
import { SpotAPI } from './api/spot.js';
import { PriceChecker } from './utils/priceChecker.js';
import { OpenPositionStrategy } from './strategies/openPosition.js';
import { ClosePositionStrategy } from './strategies/closePosition.js';

dotenv.config();

// Check if --debug flag is present
export const DEBUG_MODE = process.argv.includes('--debug');

function getEnvVar(name, required = true) {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const mode = args[0]; // 'open' or 'close'

    if (!mode || !['open', 'close'].includes(mode)) {
      console.error('Usage: node src/index.js <open|close> <symbol> <totalSizeUSD> <lotSizeUSD>');
      console.error('Example (open): node src/index.js open BTCUSDT 1000 100');
      console.error('  Opens $1000 USD position, $100 USD per lot');
      console.error('Example (close): node src/index.js close BTCUSDT 1000 100');
      console.error('  Closes $1000 USD position, $100 USD per lot');
      process.exit(1);
    }

    const symbol = args[1];

    // For open mode: <symbol> <totalSizeUSD> <lotSizeUSD>
    // For close mode: <symbol> <closePercent> <lotSizePercent>
    const param2 = parseFloat(args[2]);
    const param3 = parseFloat(args[3]);

    if (!symbol || isNaN(param2) || isNaN(param3)) {
      console.error('Invalid arguments.');
      console.error('For OPEN: node src/index.js open <symbol> <totalSizeUSD> <lotSizeUSD>');
      console.error('  Example: node src/index.js open BTCUSDT 1000 100');
      console.error('For CLOSE: node src/index.js close <symbol> <closePercent> <lotSizePercent>');
      console.error('  Example: node src/index.js close BTCUSDT 100 20 (close 100% in 20% lots)');
      process.exit(1);
    }

    if (mode === 'open') {
      const totalSizeUSD = param2;
      const lotSizeUSD = param3;

      if (totalSizeUSD <= 0 || lotSizeUSD <= 0) {
        console.error('Error: totalSizeUSD and lotSizeUSD must be greater than 0');
        process.exit(1);
      }

      if (lotSizeUSD > totalSizeUSD) {
        console.error('Error: lotSizeUSD cannot be greater than totalSizeUSD');
        process.exit(1);
      }
    } else if (mode === 'close') {
      const closePercent = param2;
      const lotSizePercent = param3;

      if (closePercent <= 0 || closePercent > 100) {
        console.error('Error: closePercent must be between 0 and 100');
        process.exit(1);
      }

      if (lotSizePercent <= 0 || lotSizePercent > closePercent) {
        console.error('Error: lotSizePercent must be between 0 and closePercent');
        process.exit(1);
      }
    }

    // Initialize APIs
    const apiKey = getEnvVar('ASTERDEX_API_KEY');
    const apiSecret = getEnvVar('ASTERDEX_API_SECRET');

    const futuresAPI = new FuturesAPI(
      getEnvVar('FUTURES_API_URL'),
      apiKey,
      apiSecret
    );

    const spotAPI = new SpotAPI(
      getEnvVar('SPOT_API_URL'),
      apiKey,
      apiSecret
    );

    const maxDiffPercent = parseFloat(getEnvVar('MAX_PRICE_DIFF_PERCENT', false) || '0.1');
    const retryDelayMs = parseInt(getEnvVar('RETRY_DELAY_MS', false) || '5000');

    const priceChecker = new PriceChecker(futuresAPI, spotAPI, maxDiffPercent);

    // Execute strategy
    if (mode === 'open') {
      const totalSizeUSD = param2;
      const lotSizeUSD = param3;

      const strategy = new OpenPositionStrategy(
        futuresAPI,
        spotAPI,
        priceChecker,
        retryDelayMs
      );
      await strategy.execute(symbol, totalSizeUSD, lotSizeUSD);
    } else if (mode === 'close') {
      const closePercent = param2;
      const lotSizePercent = param3;

      const strategy = new ClosePositionStrategy(
        futuresAPI,
        spotAPI,
        priceChecker,
        retryDelayMs
      );
      await strategy.execute(symbol, closePercent, lotSizePercent);
    }

    console.log('✅ Operation completed successfully!');
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
