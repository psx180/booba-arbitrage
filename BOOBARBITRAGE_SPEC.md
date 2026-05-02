# BOOBArbitrage — Product Specification

## Overview

A carry trade analytics tool for Pacifica's unified margin system. Single-page dashboard that scores carry trade opportunities using established institutional methodology, provides risk assessment, and estimates opportunity duration.

**Not a bot.** Analytics and intelligence only — no execution.

**First mover:** No existing tool analyzes carry trades on Pacifica's unified margin. Existing tools (Sharpe.ai, Loris, CoinGlass) are cross-exchange rate comparison tables with no risk metrics, duration estimation, or cost modeling.

## Target User

Crypto traders who are carry trading (or considering it) on Pacifica's unified margin. Primary motivation: points farming at net-positive or net-zero cost via delta-neutral carry.

## Core Strategy Analyzed

1. Buy SOL spot on Pacifica
2. Short SOL perp on Pacifica (spot collateralizes the short via unified margin, 80% LTV)
3. Collect hourly funding rate payments (when positive)
4. Net exposure: approximately zero (delta-neutral)
5. Costs: entry/exit fees + borrow rate on any USDC shortfall from the money market

## Data Sources (Pacifica API)

| Data | Endpoint | Notes |
|---|---|---|
| Historical funding rates | `GET /api/v1/funding_rate/history?symbol=SOL` | Paginated, up to 4000/page, includes oracle_price, funding_rate, next_funding_rate |
| Current borrow/lend rate | `GET /api/v1/loan_pool` | Returns utilization, borrow_rate_apr, lend_rate_apr |
| Spot price (candles) | `GET /api/v1/kline?symbol=SOL-USDC` | Same kline endpoint, spot symbol |
| Perp price (candles) | `GET /api/v1/kline?symbol=SOL` | Existing SDK |
| Spot asset parameters | `GET /api/v1/spot_assets` | LTV ratio, collateral_enabled |
| SOL volatility | Computed from kline candles | Existing candle source interface |

## Architecture

- **Separate Next.js app** (not part of BOOBAnalytics)
- **Shared Pacifica client** (copy or import from BOOBAnalytics — sets up future SDK extraction)
- **No database initially** — all data fetched live from Pacifica API, computations done server-side
- **Deploy on Railway** as a separate service

## Page Layout — Single Page, Three Sections

### Section 1: Opportunity Score (top)

**Headline metric: Carry-to-Risk Ratio (CTR)**

Formula (Curcuru, Vega & Hoek, 2010, Federal Reserve Board):
```
CTR = (annualized_net_carry) / σ_SOL_price

where:
  annualized_net_carry = (hourly_funding_rate × 8760) - borrow_rate_apr
  σ_SOL_price = annualized volatility of SOL from daily candle returns
```

Display:
- CTR value with color coding (green > 1.0, yellow 0.5-1.0, red < 0.5)
- Net carry rate (funding - borrow), both hourly and annualized
- Current funding rate (hourly) with the Pacifica-provided `next_funding_rate` prediction
- Current borrow rate APR (from loan_pool endpoint)
- Current pool utilization with distance to 80% kink and 90% cutoff
- Lo-adjusted annualized Sharpe of historical carry returns

**Lo-adjusted Sharpe (Lo, 2002, Financial Analysts Journal):**
```
SR_adjusted = SR_naive × η(ρ)

where SR_naive = mean(hourly_returns) / std(hourly_returns) × √8760
and η(q) = q / √(q + 2·Σ_{k=1}^{q-1} (q-k)·ρ^k)
and ρ = AR(1) autocorrelation of hourly funding rates
```

**Carry yield calculator:**
- User inputs capital amount (default $10,000)
- Shows: projected daily/weekly/monthly yield at current rates
- Shows: projected yield AFTER borrow cost at current utilization
- Shows: fee drag from entry (spot buy + perp short)

### Section 2: Risk Assessment (middle)

**Liquidation distance:**
```
For a delta-neutral carry (long spot + short perp on unified margin):

spot_collateral_value = SOL_amount × SOL_price × LTV_ratio
maintenance_margin = notional × maintenance_margin_rate

liquidation_buffer = (spot_collateral_value - maintenance_margin) / notional
```

Display as: "SOL would need to move X% for liquidation" with color coding.

**Basis spread:**
```
basis = (perp_price - spot_price) / spot_price × 100
```

Display current basis with historical chart (30 days).

**Utilization risk:**
- Current utilization vs 80% kink (borrow rate accelerates above this)
- Distance to 90% cutoff (new positions blocked for borrowers)
- Borrow rate at current utilization vs rate at 80% vs rate at 90%

**Tail risk (Brunnermeier, Nagel & Pedersen, 2008, NBER):**
- Realized skewness of carry returns (rolling 30-day window)
- CVaR at 95% — average loss in worst 5% of historical periods
- Warning text when skewness is significantly negative: "High carry historically predicts negative skewness (Brunnermeier et al., 2008)"

**BIS finding display:**
- Note: "BIS Working Paper 1087 finds that high carry predicts a 22% increase in liquidations of short futures positions"

### Section 3: Duration & Breakeven (bottom)

**OU half-life (Chan, 2013):**
```
Fit AR(1): Δr_t = α + λ·r_{t-1} + ε_t
half_life = -ln(2) / λ (in hours)
```

Display: "SOL funding rate mean-reverts with a half-life of ~X hours"
Include 95% confidence interval on the half-life estimate.

**Time-series z-score (Koijen et al., 2018 / AQR methodology):**
```
z = (current_funding - rolling_mean) / rolling_std
```

Rolling window: 30 days (720 hourly observations).

Display: "Current funding rate is X standard deviations above/below its 30-day mean"
Color: green if z > 1.5 (elevated opportunity), yellow if 0.5-1.5, gray if near zero.

**Breakeven hold time (He, Manela, Ross & von Wachter, 2022):**
```
T_min = round_trip_cost / hourly_net_carry

where:
  round_trip_cost = spot_buy_fee + perp_short_fee + spot_sell_fee + perp_close_fee
  hourly_net_carry = funding_rate_hourly - (borrow_rate_apr / 8760)
```

Display: "You need to hold for at least X hours to recoup entry fees"

**Breakeven vs half-life comparison:**
- If T_min < half_life: "✓ Carry likely to persist long enough to recoup costs"
- If T_min > half_life: "⚠ Funding may decay before you break even"
- If T_min ≈ half_life: "Marginal — funding persistence and fee recoup are roughly equal"

### Charts

1. **Funding rate history (30 days)** — line chart, hourly data points
2. **Basis spread history (30 days)** — line chart
3. **Utilization history** — if historical data available, otherwise just current gauge
4. **Carry P&L simulation** — given user's capital, show projected cumulative yield over time at current rates with a ±1σ band

### Methodology Popups

Every metric gets a "How is this computed?" expandable with three levels:
1. **What this means** — one sentence, plain English
2. **How we computed it** — one paragraph with the formula
3. **Source** — paper citation

Example for CTR:
1. "Risk-adjusted attractiveness of the carry trade at current rates"
2. "Net carry (annualized funding rate minus borrow rate) divided by SOL's annualized price volatility. Measures how much carry you receive per unit of price risk."
3. "Curcuru, S., Vega, C., & Hoek, J. (2010). 'Measuring Carry Trade Activity.' Federal Reserve Board / Bank for International Settlements."

## Methodology Citations (all metrics)

| Metric | Citation |
|---|---|
| Carry-to-Risk Ratio | Curcuru, Vega & Hoek (2010), Federal Reserve Board |
| Lo-adjusted Sharpe | Lo, A.W. (2002), "The Statistics of Sharpe Ratios," Financial Analysts Journal |
| Return decomposition | Christin, Routledge, Soska & Zetlin-Jones (2022), Carnegie Mellon |
| No-arbitrage bounds | He, Manela, Ross & von Wachter (2022), "Fundamentals of Perpetual Futures" |
| Crash risk / skewness | Brunnermeier, Nagel & Pedersen (2008), NBER Working Paper 14473 |
| CVaR / Expected Shortfall | Acerbi & Tasche (2002); Basel III FRTB standard |
| OU half-life | Chan, E. (2013), "Algorithmic Trading"; standard AR(1) regression |
| Carry ranking z-score | Koijen, Moskowitz, Pedersen & Vrugt (2018), "Carry," Journal of Financial Economics |
| Breakeven hold time | He, Manela, Ross & von Wachter (2022), random-maturity arbitrage framework |
| Borrow rate curve | Compound V3 / Aave V3 kinked utilization model (Pacifica uses identical structure) |
| Carry trade Sharpe evidence | BIS Working Paper 1087 (Schmeling, Schrimpf & Todorov, 2023) |
| Funding rate autocorrelation | BIS Working Paper 1087; Bayazit et al. (2024), Mathematics 14(2):346 |

## Tech Stack

- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- Recharts (charts)
- Deployed on Railway

## Non-goals (V1)

- No execution / trading
- No wallet connection (V1 is public, read-only)
- No multi-exchange comparison
- No alerts / notifications
- No database (live data only)
- No multi-asset (SOL only until Pacifica adds more spot assets)

## Future (V2+)

- Multi-asset comparison when Pacifica adds more spot assets
- Wallet connection to show user's actual carry position P&L
- Alerts when opportunity score exceeds threshold
- Historical backtest: "if you had run this carry trade for the last N days"
- Markov-switching regime detection on funding rate (Hamilton 1989; Colavecchio 2009)
- Cross-asset rotation optimization
- SDK extraction (shared Pacifica client between BOOBAnalytics and BOOBArbitrage)
