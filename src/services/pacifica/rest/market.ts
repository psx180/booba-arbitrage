import { z } from 'zod';
import { PacificaBaseClient } from '../client';
import { apiResponse, paginatedResponse } from '../types/common';
import {
  CandleInterval,
  CandleSchema,
  FundingRateHistorySchema,
  MarketInfoSchema,
  MarketTradeSchema,
  OrderbookSchema,
  PriceSchema,
} from '../types/market';

export class MarketAPI {
  constructor(private client: PacificaBaseClient) {}

  /** All markets with tick size, lot size, leverage limits, and funding rates */
  async getMarketInfo() {
    return this.client.get(
      '/info',
      {},
      apiResponse(z.array(MarketInfoSchema)),
    ).then((r) => r.data);
  }

  /** Current mark price, oracle, funding rate, OI for all symbols */
  async getPrices() {
    return this.client.get(
      '/info/prices',
      {},
      apiResponse(z.array(PriceSchema)),
    ).then((r) => r.data);
  }

  /** Current orderbook bids/asks for a symbol */
  async getOrderbook(symbol: string, aggLevel?: number) {
    return this.client.get(
      '/book',
      { symbol, ...(aggLevel !== undefined && { agg_level: aggLevel }) },
      apiResponse(OrderbookSchema),
    ).then((r) => r.data);
  }

  /** OHLCV candles — used for regime detection (ADX, ATR) */
  async getCandles(params: {
    symbol: string;
    interval: CandleInterval;
    startTime: number;
    endTime?: number;
  }) {
    return this.client.get(
      '/kline',
      {
        symbol: params.symbol,
        interval: params.interval,
        start_time: params.startTime,
        ...(params.endTime !== undefined && { end_time: params.endTime }),
      },
      apiResponse(z.array(CandleSchema)),
    ).then((r) => r.data);
  }

  /** Mark price candles */
  async getMarkPriceCandles(params: {
    symbol: string;
    interval: CandleInterval;
    startTime: number;
    endTime?: number;
  }) {
    return this.client.get(
      '/mark_price_kline',
      {
        symbol: params.symbol,
        interval: params.interval,
        start_time: params.startTime,
        ...(params.endTime !== undefined && { end_time: params.endTime }),
      },
      apiResponse(z.array(CandleSchema)),
    ).then((r) => r.data);
  }

  /** Recent market-wide trades for a symbol */
  async getRecentTrades(symbol: string) {
    return this.client.get(
      '/trades',
      { symbol },
      apiResponse(z.array(MarketTradeSchema)),
    ).then((r) => r.data);
  }

  /** Historical funding rates for a symbol — single page */
  async getHistoricalFundingRates(params: {
    symbol: string;
    limit?: number;
    cursor?: string;
  }) {
    return this.client.get(
      '/funding_rate/history',
      {
        symbol: params.symbol,
        ...(params.limit !== undefined && { limit: params.limit }),
        ...(params.cursor !== undefined && { cursor: params.cursor }),
      },
      paginatedResponse(FundingRateHistorySchema),
    );
  }

  /** Walks the funding rate history cursor and returns every page parsed. */
  async getAllHistoricalFunding(symbol: string): Promise<Array<{
    funding_rate: number;
    next_funding_rate: number;
    oracle_price: number;
    created_at: number;
  }>> {
    const all: Array<{
      funding_rate: number;
      next_funding_rate: number;
      oracle_price: number;
      created_at: number;
    }> = [];
    let cursor: string | undefined;
    while (true) {
      const page = await this.getHistoricalFundingRates({ symbol, limit: 4000, cursor });
      for (const d of page.data) {
        all.push({
          funding_rate: parseFloat(d.funding_rate),
          next_funding_rate: parseFloat(d.next_funding_rate),
          oracle_price: parseFloat(d.oracle_price),
          created_at: d.created_at,
        });
      }
      if (!page.has_more || !page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return all;
  }
}