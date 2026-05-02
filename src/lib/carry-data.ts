import { PacificaClient } from '@/services/pacifica';
import * as math from './carry-math';

const MS_PER_DAY = 24 * 60 * 60 * 1_000;
const CANDLE_LOOKBACK_DAYS = 30;

// Fee assumptions for the breakeven calculation.
// 5 bps each side is a placeholder; verify against Pacifica's fee schedule
// before using these to size live trades.
const SPOT_FEE_RATE = 0.0005;
const PERP_FEE_RATE = 0.0005;

const DEFAULT_CAPITAL_USD = 10_000;
const ZSCORE_WINDOW_HOURS = 720; // 30 days at 1h funding cadence

export interface CarryAnalysis {
  symbol: string;

  // Raw data
  currentFundingRate: number;
  nextFundingRate: number;
  borrowRateApr: number;
  lendRateApr: number;
  utilization: number;
  spotPrice: number;
  perpPrice: number;
  ltvRatio: number;

  // Computed — Opportunity
  netCarryHourly: number;
  netCarryAnnualized: number;
  ctr: number;
  annualizedVol: number;
  basis: number;
  sharpe: { naive: number; adjusted: number; autocorrelation: number } | null;
  zScore: number | null;

  // Computed — Risk
  cvar95: number | null;
  skewness: number | null;
  utilizationToKink: number;
  utilizationToCutoff: number;

  // Computed — Duration
  ouResult: { halfLife: number; lambda: number; mu: number; standardError: number } | null;
  breakevenHours: number | null;
  breakevenVsHalfLife: 'favorable' | 'marginal' | 'unfavorable' | null;

  // Yield projection (at $10,000 default)
  yieldProjection: { hourly: number; daily: number; weekly: number; monthly: number; annualized: number };

  // Metadata
  fundingHistory: Array<{ rate: number; timestamp: number }>;
  dataPoints: number;
  oldestDataPoint: number;
}

export async function fetchCarryAnalysis(symbol: string = 'SOL'): Promise<CarryAnalysis> {
  const client = new PacificaClient({
    apiConfigKey: process.env.PF_API_KEY,
  });

  const startTime = Date.now() - CANDLE_LOOKBACK_DAYS * MS_PER_DAY;

  const [fundingHistory, loanPool, spotAssets, spotCandles, perpCandles] = await Promise.all([
    client.market.getAllHistoricalFunding(symbol),
    client.lending.getLoanPool(),
    client.lending.getSpotAssets(),
    client.market.getCandles({ symbol: `${symbol}-USDC`, interval: '1d', startTime }),
    client.market.getCandles({ symbol, interval: '1d', startTime }),
  ]);

  if (fundingHistory.length === 0) {
    throw new Error(`No funding history returned for ${symbol}`);
  }

  // Pacifica's funding history endpoint returns rows newest-first. Sort by
  // created_at ascending so downstream time-series math (OU, AR(1), Sharpe)
  // sees them in chronological order.
  fundingHistory.sort((a, b) => a.created_at - b.created_at);

  const latest = fundingHistory[fundingHistory.length - 1];
  const currentFundingRate = latest.funding_rate;
  const nextFundingRate = latest.next_funding_rate;
  const borrowRateApr = loanPool.borrow_rate_apr;
  const lendRateApr = loanPool.lend_rate_apr;
  const utilization = loanPool.utilization;

  const spotAsset = spotAssets.find((a) => a.symbol === symbol);
  const ltvRatio = spotAsset?.ltv_ratio ?? 0.80;

  // Pacifica's candle schema uses single-letter keys; `c` is close.
  const spotPrice = spotCandles.length > 0
    ? parseFloat(spotCandles[spotCandles.length - 1].c)
    : latest.oracle_price;
  const perpPrice = perpCandles.length > 0
    ? parseFloat(perpCandles[perpCandles.length - 1].c)
    : latest.oracle_price;

  const dailyReturns: number[] = [];
  for (let i = 1; i < perpCandles.length; i++) {
    const prev = parseFloat(perpCandles[i - 1].c);
    const curr = parseFloat(perpCandles[i].c);
    if (prev > 0) dailyReturns.push((curr - prev) / prev);
  }
  const annualizedVol = math.annualizedVolatility(dailyReturns);

  const fundingRates = fundingHistory.map((f) => f.funding_rate);
  const hourlyBorrowRate = borrowRateApr / 8760;
  const carryReturns = fundingRates.map((r) => r - hourlyBorrowRate);

  const netHourly = math.netCarryHourly(currentFundingRate, borrowRateApr);
  const netAnnual = math.netCarryAnnualized(currentFundingRate, borrowRateApr);
  const ctr = math.carryToRisk(currentFundingRate, borrowRateApr, annualizedVol);
  const basis = math.basisSpread(perpPrice, spotPrice);
  const sharpe = math.loAdjustedSharpe(carryReturns);
  const z = math.zScore(currentFundingRate, fundingRates.slice(-ZSCORE_WINDOW_HOURS));
  const cvar95 = math.cvar(carryReturns);
  const skewness = math.realizedSkewness(carryReturns);
  const ouResult = math.ouHalfLife(fundingRates);
  const breakeven = math.breakevenHours(SPOT_FEE_RATE, PERP_FEE_RATE, netHourly, DEFAULT_CAPITAL_USD);

  let breakevenVsHalfLife: 'favorable' | 'marginal' | 'unfavorable' | null = null;
  if (breakeven !== null && ouResult !== null) {
    if (breakeven < ouResult.halfLife * 0.5) breakevenVsHalfLife = 'favorable';
    else if (breakeven < ouResult.halfLife * 1.5) breakevenVsHalfLife = 'marginal';
    else breakevenVsHalfLife = 'unfavorable';
  }

  return {
    symbol,
    currentFundingRate,
    nextFundingRate,
    borrowRateApr,
    lendRateApr,
    utilization,
    spotPrice,
    perpPrice,
    ltvRatio,
    netCarryHourly: netHourly,
    netCarryAnnualized: netAnnual,
    ctr,
    annualizedVol,
    basis,
    sharpe,
    zScore: z,
    cvar95,
    skewness,
    utilizationToKink: 0.80 - utilization,
    utilizationToCutoff: 0.90 - utilization,
    ouResult,
    breakevenHours: breakeven,
    breakevenVsHalfLife,
    yieldProjection: math.yieldProjection(DEFAULT_CAPITAL_USD, netHourly),
    fundingHistory: fundingHistory.map((f) => ({ rate: f.funding_rate, timestamp: f.created_at })),
    dataPoints: fundingHistory.length,
    oldestDataPoint: fundingHistory[0]?.created_at ?? 0,
  };
}
