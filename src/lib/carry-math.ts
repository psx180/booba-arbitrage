/**
 * Carry trade analytics — core computations.
 *
 * All formulas are from published institutional/academic sources.
 * Each function documents its citation.
 */

// ─── Carry-to-Risk Ratio ─────────────────────────────────────────────
// Source: Curcuru, Vega & Hoek (2010), Federal Reserve Board / BIS
// CTR = (annualized net carry) / (annualized price volatility)

export function carryToRisk(
  hourlyFundingRate: number,
  borrowRateApr: number,
  annualizedVolatility: number,
): number {
  const annualizedCarry = hourlyFundingRate * 8760 - borrowRateApr;
  if (annualizedVolatility <= 0) return 0;
  return annualizedCarry / annualizedVolatility;
}

// ─── Net Carry ────────────────────────────────────────────────────────

export function netCarryHourly(
  hourlyFundingRate: number,
  borrowRateApr: number,
): number {
  return hourlyFundingRate - borrowRateApr / 8760;
}

export function netCarryAnnualized(
  hourlyFundingRate: number,
  borrowRateApr: number,
): number {
  return hourlyFundingRate * 8760 - borrowRateApr;
}

// ─── Lo-adjusted Sharpe Ratio ─────────────────────────────────────────
// Source: Lo, A.W. (2002), "The Statistics of Sharpe Ratios,"
//         Financial Analysts Journal 58(4), 36-52.
// Corrects for autocorrelation in the return series.

export function loAdjustedSharpe(
  returns: number[],
  periodsPerYear: number = 8760, // hourly
): { naive: number; adjusted: number; autocorrelation: number } | null {
  if (returns.length < 30) return null;

  const n = returns.length;
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  if (std <= 0) return null;

  // AR(1) autocorrelation
  let sumProduct = 0;
  let sumSq = 0;
  for (let i = 1; i < n; i++) {
    sumProduct += (returns[i] - mean) * (returns[i - 1] - mean);
    sumSq += (returns[i - 1] - mean) ** 2;
  }
  const rho = sumSq > 0 ? sumProduct / sumSq : 0;

  const naiveSharpe = (mean / std) * Math.sqrt(periodsPerYear);

  // Lo adjustment factor: η(q) = q / sqrt(q + 2·Σ_{k=1}^{q-1} (q-k)·ρ^k)
  // Cap at 100 lags — ρ^k decays geometrically so further terms are negligible
  // and the full sum to q=8760 is wasted CPU.
  const q = periodsPerYear;
  let sumCorrection = 0;
  for (let k = 1; k < Math.min(q, 100); k++) {
    sumCorrection += (q - k) * Math.pow(rho, k);
  }
  const denominator = Math.sqrt(q + 2 * sumCorrection);
  const eta = denominator > 0 ? q / denominator : 1;
  const adjustmentRatio = eta / Math.sqrt(q);
  const adjustedSharpe = naiveSharpe * adjustmentRatio;

  return {
    naive: naiveSharpe,
    adjusted: adjustedSharpe,
    autocorrelation: rho,
  };
}

// ─── OU Half-Life ─────────────────────────────────────────────────────
// Source: Chan, E. (2013), "Algorithmic Trading"
// Fit AR(1): Δr_t = α + λ·r_{t-1} + ε_t
// half_life = -ln(2) / λ

export function ouHalfLife(
  series: number[],
): { halfLife: number; lambda: number; mu: number; standardError: number } | null {
  if (series.length < 30) return null;

  const n = series.length - 1;
  const deltaY: number[] = [];
  const yLag: number[] = [];

  for (let i = 1; i < series.length; i++) {
    deltaY.push(series[i] - series[i - 1]);
    yLag.push(series[i - 1]);
  }

  const meanDelta = deltaY.reduce((s, v) => s + v, 0) / n;
  const meanLag = yLag.reduce((s, v) => s + v, 0) / n;

  let ssXY = 0;
  let ssXX = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (yLag[i] - meanLag) * (deltaY[i] - meanDelta);
    ssXX += (yLag[i] - meanLag) ** 2;
  }

  if (ssXX === 0) return null;

  const lambda = ssXY / ssXX;
  const alpha = meanDelta - lambda * meanLag;

  // λ must be negative for mean-reversion; otherwise the series is divergent
  // and a half-life is meaningless.
  if (lambda >= 0) return null;

  const halfLife = -Math.log(2) / lambda;
  const mu = -alpha / lambda;

  const residuals = deltaY.map((dy, i) => dy - alpha - lambda * yLag[i]);
  const residualVariance = residuals.reduce((s, r) => s + r * r, 0) / (n - 2);
  const standardError = Math.sqrt(residualVariance / ssXX);

  return { halfLife, lambda, mu, standardError };
}

// ─── Z-Score ──────────────────────────────────────────────────────────
// Source: Koijen, Moskowitz, Pedersen & Vrugt (2018), "Carry," JFE
// Time-series z-score of current rate vs rolling window

export function zScore(
  currentValue: number,
  series: number[],
): number | null {
  if (series.length < 20) return null;
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  const std = Math.sqrt(
    series.reduce((s, v) => s + (v - mean) ** 2, 0) / (series.length - 1),
  );
  if (std <= 0) return null;
  return (currentValue - mean) / std;
}

// ─── Breakeven Hold Time ──────────────────────────────────────────────
// Source: He, Manela, Ross & von Wachter (2022),
//         "Fundamentals of Perpetual Futures"
// T_min = round_trip_cost / hourly_net_carry

export function breakevenHours(
  spotFeeRate: number,
  perpFeeRate: number,
  hourlyNetCarry: number,
  capitalUsd: number,
): number | null {
  if (hourlyNetCarry <= 0) return null;

  const roundTripCostRate = 2 * spotFeeRate + 2 * perpFeeRate;
  const roundTripCostUsd = roundTripCostRate * capitalUsd;
  const hourlyYieldUsd = hourlyNetCarry * capitalUsd;

  return roundTripCostUsd / hourlyYieldUsd;
}

// ─── Basis ────────────────────────────────────────────────────────────

export function basisSpread(
  perpPrice: number,
  spotPrice: number,
): number {
  if (spotPrice <= 0) return 0;
  return (perpPrice - spotPrice) / spotPrice;
}

// ─── Liquidation Distance ─────────────────────────────────────────────
// For delta-neutral carry on unified margin: how much can price move
// before maintenance margin is breached.

export function liquidationDistance(
  spotAmount: number,
  spotPrice: number,
  ltvRatio: number,
  perpNotional: number,
  maintenanceMarginRate: number,
): number {
  const collateralValue = spotAmount * spotPrice * ltvRatio;
  const requiredMaintenance = perpNotional * maintenanceMarginRate;
  const buffer = collateralValue - requiredMaintenance;

  if (perpNotional <= 0) return 0;
  return buffer / perpNotional;
}

// ─── CVaR (Conditional Value at Risk) ─────────────────────────────────
// Source: Acerbi & Tasche (2002); Basel III FRTB standard
// CVaR_α = average loss in the worst α% of observations

export function cvar(
  returns: number[],
  alpha: number = 0.05,
): number | null {
  if (returns.length < 20) return null;

  const sorted = [...returns].sort((a, b) => a - b);
  const cutoffIndex = Math.max(1, Math.floor(sorted.length * alpha));
  const tailReturns = sorted.slice(0, cutoffIndex);

  return tailReturns.reduce((s, r) => s + r, 0) / tailReturns.length;
}

// ─── Realized Skewness ───────────────────────────────────────────────
// Source: Brunnermeier, Nagel & Pedersen (2008), NBER WP 14473
// High carry predicts negative skewness

export function realizedSkewness(returns: number[]): number | null {
  if (returns.length < 30) return null;

  const n = returns.length;
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const m2 = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const m3 = returns.reduce((s, r) => s + (r - mean) ** 3, 0) / n;
  const std = Math.sqrt(m2);

  if (std <= 0) return null;
  return ((n * m3) / ((n - 1) * (n - 2) * std ** 3)) * n;
}

// ─── Annualized Volatility from Candles ───────────────────────────────

export function annualizedVolatility(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365); // crypto trades 365 days
}

// ─── Yield Projection ─────────────────────────────────────────────────

export function yieldProjection(
  capitalUsd: number,
  hourlyNetCarry: number,
): { hourly: number; daily: number; weekly: number; monthly: number; annualized: number } {
  return {
    hourly: capitalUsd * hourlyNetCarry,
    daily: capitalUsd * hourlyNetCarry * 24,
    weekly: capitalUsd * hourlyNetCarry * 24 * 7,
    monthly: capitalUsd * hourlyNetCarry * 24 * 30,
    annualized: capitalUsd * hourlyNetCarry * 8760,
  };
}
