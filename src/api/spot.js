import axios from 'axios';
import crypto from 'crypto';
import { DEBUG_MODE } from '../index.js';

export class SpotAPI {
  constructor(apiUrl, apiKey, apiSecret) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  createSignature(queryString) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  buildQueryString(params) {
    return Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
  }

  async getPrice(symbol) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/v1/ticker/price`, {
        params: { symbol }
      });
      return parseFloat(response.data.price);
    } catch (error) {
      const errorMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(`Failed to get spot price for ${symbol}: ${errorMsg}`);
    }
  }

  async getBalance(asset) {
    try {
      const timestamp = Date.now();
      const params = { timestamp, recvWindow: 5000 };
      const queryString = this.buildQueryString(params);
      const signature = this.createSignature(queryString);

      const response = await axios.get(`${this.apiUrl}/api/v1/account`, {
        params: { ...params, signature },
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });

      const balance = response.data.balances.find(b => b.asset === asset);
      return balance ? {
        asset: balance.asset,
        free: parseFloat(balance.free),
        locked: parseFloat(balance.locked)
      } : null;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  async getSymbolInfo(symbol) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/v1/exchangeInfo`);
      const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);

      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found in exchange info`);
      }

      // Find LOT_SIZE filter
      const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');

      if (!lotSizeFilter) {
        console.warn(`LOT_SIZE filter not found for ${symbol}, using default precision`);
        return { stepSize: '0.01', minQty: '0.01', maxQty: '1000000' };
      }

      return {
        stepSize: lotSizeFilter.stepSize,
        minQty: lotSizeFilter.minQty,
        maxQty: lotSizeFilter.maxQty
      };
    } catch (error) {
      console.warn(`Failed to get symbol info for ${symbol}: ${error.message}, using default`);
      return { stepSize: '0.01', minQty: '0.01', maxQty: '1000000' };
    }
  }

  roundToStepSize(quantity, stepSize) {
    const stepSizeFloat = parseFloat(stepSize);
    const rounded = Math.floor(quantity / stepSizeFloat) * stepSizeFloat;
    // Fix floating point precision by rounding to stepSize decimal places
    const decimals = (stepSize.split('.')[1] || '').length;
    return parseFloat(rounded.toFixed(decimals));
  }

  roundQuantity(quantity, precision = 2) {
    const factor = Math.pow(10, precision);
    return Math.floor(quantity * factor) / factor;
  }

  async placeMarketOrder(symbol, side, quantity) {
    let roundedQuantity;

    try {
      const timestamp = Date.now();

      // Get symbol info and round quantity according to stepSize
      const symbolInfo = await this.getSymbolInfo(symbol);
      roundedQuantity = this.roundToStepSize(quantity, symbolInfo.stepSize);

      if (DEBUG_MODE) {
        console.log(`[DEBUG] Quantity rounding: ${quantity} -> ${roundedQuantity} (stepSize: ${symbolInfo.stepSize})`);
      }

      const params = {
        symbol,
        side,
        type: 'MARKET',
        quantity: roundedQuantity.toString(),
        timestamp,
        recvWindow: 5000
      };

      const queryString = this.buildQueryString(params);
      const signature = this.createSignature(queryString);

      if (DEBUG_MODE) {
        console.log(`[DEBUG] Spot Order Request:`, {
          url: `${this.apiUrl}/api/v1/order`,
          params,
          signature: signature.substring(0, 10) + '...'
        });
      }

      const response = await axios.post(
        `${this.apiUrl}/api/v1/order`,
        null,
        {
          params: { ...params, signature },
          headers: { 'X-MBX-APIKEY': this.apiKey }
        }
      );

      if (DEBUG_MODE) {
        console.log(`[DEBUG] Spot Order Response:`, JSON.stringify(response.data, null, 2));
      }

      // If order is not immediately filled, wait and check status
      let orderData = response.data;
      if (orderData.status === 'NEW' && parseFloat(orderData.executedQty) === 0) {
        if (DEBUG_MODE) {
          console.log(`[DEBUG] Order still NEW, waiting 2s to check status...`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check order status
        const checkParams = {
          symbol,
          orderId: orderData.orderId,
          timestamp: Date.now(),
          recvWindow: 5000
        };
        const checkQueryString = this.buildQueryString(checkParams);
        const checkSignature = this.createSignature(checkQueryString);

        const checkResponse = await axios.get(`${this.apiUrl}/api/v1/order`, {
          params: { ...checkParams, signature: checkSignature },
          headers: { 'X-MBX-APIKEY': this.apiKey }
        });

        orderData = checkResponse.data;
        if (DEBUG_MODE) {
          console.log(`[DEBUG] Updated Spot Order Status:`, JSON.stringify(orderData, null, 2));
        }
      }

      return {
        orderId: orderData.orderId,
        symbol: orderData.symbol,
        side: orderData.side,
        price: parseFloat(orderData.fills?.[0]?.price || orderData.avgPrice || 0),
        executedQty: parseFloat(orderData.executedQty || orderData.origQty || 0),
        status: orderData.status
      };
    } catch (error) {
      const errorMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(`Failed to place spot market order (${side} ${roundedQuantity || quantity} ${symbol}): ${errorMsg}`);
    }
  }

  async buy(symbol, quantity) {
    return this.placeMarketOrder(symbol, 'BUY', quantity);
  }

  async sell(symbol, quantity) {
    return this.placeMarketOrder(symbol, 'SELL', quantity);
  }
}
