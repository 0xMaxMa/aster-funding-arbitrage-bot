import axios from 'axios';
import crypto from 'crypto';
import { DEBUG_MODE } from '../index.js';

export class FuturesAPI {
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
      const response = await axios.get(`${this.apiUrl}/fapi/v1/ticker/price`, {
        params: { symbol }
      });
      return parseFloat(response.data.price);
    } catch (error) {
      const errorMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(`Failed to get futures price for ${symbol}: ${errorMsg}`);
    }
  }

  async getMarkPrice(symbol) {
    try {
      const response = await axios.get(`${this.apiUrl}/fapi/v1/premiumIndex`, {
        params: { symbol }
      });
      return parseFloat(response.data.markPrice);
    } catch (error) {
      throw new Error(`Failed to get mark price: ${error.message}`);
    }
  }

  async getBalance(asset) {
    try {
      const timestamp = Date.now();
      const params = { timestamp, recvWindow: 5000 };
      const queryString = this.buildQueryString(params);
      const signature = this.createSignature(queryString);

      const response = await axios.get(`${this.apiUrl}/fapi/v1/account`, {
        params: { ...params, signature },
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });

      const balance = response.data.assets.find(b => b.asset === asset);
      return balance ? {
        asset: balance.asset,
        free: parseFloat(balance.availableBalance),
        locked: parseFloat(balance.initialMargin)
      } : null;
    } catch (error) {
      throw new Error(`Failed to get futures balance: ${error.message}`);
    }
  }

  async getPosition(symbol) {
    try {
      const timestamp = Date.now();
      const params = { timestamp, recvWindow: 5000 };

      // Add symbol if provided
      if (symbol) {
        params.symbol = symbol;
      }

      const queryString = this.buildQueryString(params);
      const signature = this.createSignature(queryString);

      const response = await axios.get(`${this.apiUrl}/fapi/v1/positionRisk`, {
        params: { ...params, signature },
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });

      if (response.data && response.data.length > 0) {
        // If symbol is provided, find that specific position
        const position = symbol
          ? response.data.find(p => p.symbol === symbol)
          : response.data[0];

        if (!position) {
          return null;
        }

        const positionAmt = parseFloat(position.positionAmt);
        const entryPrice = parseFloat(position.entryPrice);
        const markPrice = parseFloat(position.markPrice);
        const notionalValue = parseFloat(position.notional || 0);

        // Binance returns positionAmt differently based on contract type:
        // - For some pairs: positionAmt = notional value in USDT
        // - For others: positionAmt = quantity in base asset
        // We detect by checking if notional field exists and differs from positionAmt
        let quantity;
        if (notionalValue !== 0 && Math.abs(notionalValue) !== Math.abs(positionAmt)) {
          // Use notional value and convert to quantity
          quantity = Math.abs(notionalValue / markPrice);
        } else if (Math.abs(positionAmt * markPrice) > Math.abs(positionAmt) * 10) {
          // positionAmt seems to be notional (much larger than expected quantity)
          quantity = Math.abs(positionAmt / markPrice);
        } else {
          // positionAmt is already quantity
          quantity = Math.abs(positionAmt);
        }

        return {
          symbol: position.symbol,
          positionAmt: positionAmt < 0 ? -quantity : quantity,
          entryPrice: entryPrice,
          markPrice: markPrice,
          unRealizedProfit: parseFloat(position.unRealizedProfit)
        };
      }
      return null;
    } catch (error) {
      throw new Error(`Failed to get position: ${error.message}`);
    }
  }

  async getSymbolInfo(symbol) {
    try {
      const response = await axios.get(`${this.apiUrl}/fapi/v1/exchangeInfo`);
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

  async placeMarketOrder(symbol, side, quantity, reduceOnly = false) {
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

      // Add reduceOnly if specified (used for closing positions below minimum size)
      if (reduceOnly) {
        params.reduceOnly = true;
      }

      const queryString = this.buildQueryString(params);
      const signature = this.createSignature(queryString);

      if (DEBUG_MODE) {
        console.log(`[DEBUG] Futures Order Request:`, {
          url: `${this.apiUrl}/fapi/v1/order`,
          params,
          signature: signature.substring(0, 10) + '...'
        });
      }

      const response = await axios.post(
        `${this.apiUrl}/fapi/v1/order`,
        null,
        {
          params: { ...params, signature },
          headers: { 'X-MBX-APIKEY': this.apiKey }
        }
      );

      if (DEBUG_MODE) {
        console.log(`[DEBUG] Futures Order Response:`, JSON.stringify(response.data, null, 2));
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

        const checkResponse = await axios.get(`${this.apiUrl}/fapi/v1/order`, {
          params: { ...checkParams, signature: checkSignature },
          headers: { 'X-MBX-APIKEY': this.apiKey }
        });

        orderData = checkResponse.data;
        if (DEBUG_MODE) {
          console.log(`[DEBUG] Updated Futures Order Status:`, JSON.stringify(orderData, null, 2));
        }
      }

      return {
        orderId: orderData.orderId,
        symbol: orderData.symbol,
        side: orderData.side,
        price: parseFloat(orderData.avgPrice || orderData.price || 0),
        executedQty: parseFloat(orderData.executedQty || orderData.origQty || 0),
        status: orderData.status
      };
    } catch (error) {
      const errorMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      throw new Error(`Failed to place futures market order (${side} ${roundedQuantity || quantity} ${symbol}): ${errorMsg}`);
    }
  }

  async openShort(symbol, quantity) {
    return this.placeMarketOrder(symbol, 'SELL', quantity, false);
  }

  async closeShort(symbol, quantity, reduceOnly = false) {
    return this.placeMarketOrder(symbol, 'BUY', quantity, reduceOnly);
  }
}
