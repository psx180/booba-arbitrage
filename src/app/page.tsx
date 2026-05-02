'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CarryAnalysis } from '@/lib/carry-data';
import { MethodologyPopup } from '@/components/MethodologyPopup';
import { FundingChart } from '@/components/charts/FundingChart';

const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const SUPPORTED_SYMBOLS = ['SOL'];
const BIS_PAPER_URL = 'https://www.bis.org/publ/work1087.htm';

const fmtPct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
const fmtBps = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${(v * 10_000).toFixed(digits)} bps`;
const fmtUsd = (v: number) =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtUsdSigned = (v: number) => (v >= 0 ? '+' : '−') + fmtUsd(Math.abs(v)).replace('-', '');
const fmtNumber = (v: number, digits = 2) => v.toFixed(digits);

function ctrColor(ctr: number): string {
  if (ctr > 1) return 'var(--success)';
  if (ctr > 0.5) return 'var(--warning)';
  if (ctr > 0) return 'var(--orange)';
  return 'var(--danger)';
}

function utilColor(util: number): string {
  if (util > 0.85) return 'var(--danger)';
  if (util > 0.75) return 'var(--orange)';
  if (util > 0.5) return 'var(--warning)';
  return 'var(--success)';
}

function zScoreColor(z: number): string {
  if (z > 1.5) return 'var(--success)';
  if (z > 0.5) return 'var(--warning)';
  if (z > -0.5) return 'var(--muted)';
  return 'var(--danger)';
}

function ctrVerdict(ctr: number): string {
  if (ctr > 1) return 'Strong opportunity — carry significantly exceeds price risk';
  if (ctr > 0.5) return 'Moderate opportunity — carry exceeds price risk';
  if (ctr > 0) return 'Weak opportunity — carry barely covers price risk';
  return 'No opportunity — carry is negative after borrow costs';
}

function riskHeadline(ctr: number): string {
  if (ctr > 0.5) return 'Carry is favorable — monitor utilization and funding direction';
  if (ctr > 0) return 'Marginal carry — costs may exceed yield';
  return 'Carry is negative — no trade recommended at current rates';
}

function durationHeadline(s: CarryAnalysis['breakevenVsHalfLife']): string {
  if (s === 'favorable') return '✓ Carry likely to persist long enough to recoup entry costs';
  if (s === 'marginal') return '⚠ Breakeven and funding persistence are roughly equal — marginal trade';
  if (s === 'unfavorable') return '✗ Funding may decay before you break even';
  return 'Carry is negative — no breakeven analysis applicable';
}

function zInterpretation(z: number): string {
  if (z > 2) return 'Funding is very elevated — strong entry signal';
  if (z > 1) return 'Funding is above average — moderate signal';
  if (Math.abs(z) < 0.5) return 'Funding is near its historical average';
  if (z < -2) return 'Funding is very depressed — avoid carry';
  if (z < -1) return 'Funding is below average — poor carry conditions';
  return 'Funding is mildly off-average';
}

// Card chrome shared across the page.
function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-[#161b22] border border-[#30363d] rounded-lg p-5 ${className}`}
    >
      {title && (
        <div className="text-xs uppercase tracking-wide text-[#8b949e] mb-3">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function SectionHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold text-[#c9d1d9]">{title}</h2>
      <div className="text-sm text-[#8b949e] mt-1">{summary}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-8 animate-pulse">
        <div className="h-6 w-1/3 bg-[#21262d] rounded mb-4" />
        <div className="h-12 w-1/4 bg-[#21262d] rounded mb-3" />
        <div className="h-4 w-2/3 bg-[#21262d] rounded" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 h-32 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Card>
        <div className="text-[#f85149] font-medium mb-2">Unable to load analysis</div>
        <div className="text-sm text-[#8b949e] mb-4">{message}</div>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded text-sm transition-colors"
        >
          Retry
        </button>
      </Card>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<CarryAnalysis | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [symbol, setSymbol] = useState<string>('SOL');

  // Yield calculator local state. Decoupled from `data` so it can be edited
  // freely between refreshes.
  const [capital, setCapital] = useState<number>(10_000);
  const [spotFeeBps, setSpotFeeBps] = useState<number>(5);
  const [perpFeeBps, setPerpFeeBps] = useState<number>(5);
  const [feesExpanded, setFeesExpanded] = useState<boolean>(false);

  const fetchAnalysis = useCallback(async (sym: string, isInitial: boolean) => {
    if (isInitial) setLoading(true);
    try {
      const res = await fetch(`/api/carry?symbol=${encodeURIComponent(sym)}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed: ${res.status}`);
      }
      const json = (await res.json()) as CarryAnalysis;
      setData(json);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAnalysis(symbol, true);
    const id = setInterval(() => void fetchAnalysis(symbol, false), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [symbol, fetchAnalysis]);

  const yieldFigures = useMemo(() => {
    if (!data) return null;
    const hourly = capital * data.netCarryHourly;
    return {
      hourly,
      daily: hourly * 24,
      weekly: hourly * 24 * 7,
      monthly: hourly * 24 * 30,
      annualized: hourly * 8_760,
      annualizedPct: data.netCarryAnnualized,
      roundTripFee: capital * 2 * (spotFeeBps / 10_000 + perpFeeBps / 10_000),
    };
  }, [data, capital, spotFeeBps, perpFeeBps]);

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9]">
      <Header
        symbol={symbol}
        onSymbolChange={setSymbol}
        lastUpdated={lastUpdated}
        onRefresh={() => void fetchAnalysis(symbol, true)}
        refreshing={loading}
      />

      {loading && !data && <LoadingSkeleton />}
      {error && !data && (
        <ErrorState message={error} onRetry={() => void fetchAnalysis(symbol, true)} />
      )}

      {data && (
        <main className="max-w-6xl mx-auto px-4 py-8 space-y-12">
          {/* ─── Section 1: Opportunity ─── */}
          <section>
            <SectionHeader
              title="Opportunity"
              summary="Current carry and risk-adjusted return for the delta-neutral trade"
            />

            {/* Headline CTR card */}
            <Card>
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="md:w-1/3">
                  <div className="text-xs uppercase tracking-wide text-[#8b949e] mb-1">
                    Carry-to-Risk Ratio
                  </div>
                  <div
                    className="text-5xl font-semibold tabular-nums"
                    style={{ color: ctrColor(data.ctr) }}
                  >
                    {fmtNumber(data.ctr)}
                  </div>
                </div>
                <div className="md:flex-1 md:border-l md:border-[#30363d] md:pl-6">
                  <div className="text-base text-[#c9d1d9] leading-relaxed">
                    {ctrVerdict(data.ctr)}
                  </div>
                  <MethodologyPopup
                    whatItMeans="Net carry divided by SOL price volatility. Measures carry received per unit of price risk."
                    howComputed="(annualized funding − borrow APR) / annualized return volatility, where volatility comes from daily perp candle returns over the last 30 days."
                    source="Curcuru, Vega & Hoek (2010), Federal Reserve Board / BIS"
                  />
                </div>
              </div>
            </Card>

            {/* Metrics grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              {/* Net Carry */}
              <Card title="Net Carry">
                <div
                  className="text-3xl font-semibold tabular-nums"
                  style={{
                    color:
                      data.netCarryHourly >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {fmtPct(data.netCarryHourly, 4)}
                </div>
                <div className="text-sm text-[#8b949e] mt-1">
                  Hourly · {fmtPct(data.netCarryAnnualized, 2)} annualized
                </div>
                <div className="text-xs text-[#8b949e] mt-3">
                  Funding: {fmtPct(data.currentFundingRate, 4)}/hr · Borrow:{' '}
                  {fmtPct(data.borrowRateApr, 2)} APR
                </div>
                <MethodologyPopup
                  whatItMeans="Net cash flow per hour from holding the carry trade: funding rate received minus the hourly cost of borrowing."
                  howComputed="netCarryHourly = funding_rate − borrow_rate_apr / 8760. Funding from Pacifica's hourly settlement; borrow rate from the unified-margin loan pool."
                  source="Pacifica funding rate spec; standard perpetual-futures carry decomposition."
                />
              </Card>

              {/* Lo-Adjusted Sharpe */}
              <Card title="Lo-Adjusted Sharpe">
                {data.sharpe ? (
                  <>
                    <div className="text-3xl font-semibold tabular-nums text-[#c9d1d9]">
                      {fmtNumber(data.sharpe.adjusted)}
                    </div>
                    <div className="text-sm mt-1">
                      <span className="text-[#8b949e] line-through">
                        naive: {fmtNumber(data.sharpe.naive)}
                      </span>
                    </div>
                    <div className="text-xs text-[#8b949e] mt-3">
                      Autocorrelation: ρ = {fmtNumber(data.sharpe.autocorrelation, 2)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[#8b949e]">
                    Insufficient data (need ≥ 30 funding observations)
                  </div>
                )}
                <MethodologyPopup
                  whatItMeans="Sharpe ratio corrected for autocorrelation in funding rates. The naive √T annualization overstates Sharpe when returns are serially correlated, as funding rates strongly are."
                  howComputed="AR(1) coefficient ρ estimated on the hourly carry-return series; Lo's η(q) factor scales the naive Sharpe down by η(q)/√q."
                  source='Lo, A.W. (2002), "The Statistics of Sharpe Ratios," Financial Analysts Journal 58(4), 36–52.'
                />
              </Card>

              {/* Basis */}
              <Card title="Basis Spread">
                <div
                  className="text-3xl font-semibold tabular-nums"
                  style={{
                    color: data.basis >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {fmtBps(data.basis)}
                </div>
                <div className="text-sm text-[#8b949e] mt-1">
                  Perp premium over spot
                </div>
                <div className="text-xs text-[#8b949e] mt-3">
                  Perp: {fmtUsd(data.perpPrice)} · Spot: {fmtUsd(data.spotPrice)}
                </div>
                <MethodologyPopup
                  whatItMeans="Difference between perp and spot price as a percentage. Positive basis means perp trades above spot — favorable for the carry trade (short the perp, long spot)."
                  howComputed="(perpPrice − spotPrice) / spotPrice. Prices taken from the most recent daily candle close on Pacifica."
                  source="Standard cash-and-carry basis definition."
                />
              </Card>
            </div>

            {/* Yield Calculator */}
            <Card className="mt-6">
              <div className="text-xs uppercase tracking-wide text-[#8b949e] mb-4">
                Yield Calculator
              </div>
              <div className="flex flex-col md:flex-row md:items-end gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-[#8b949e]">Capital ($)</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={capital}
                    onChange={(e) =>
                      setCapital(Math.max(0, parseFloat(e.target.value) || 0))
                    }
                    className="bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-[#c9d1d9] tabular-nums w-40 focus:outline-none focus:border-[#58a6ff]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setFeesExpanded((v) => !v)}
                  className="text-xs text-[#58a6ff] hover:underline self-start md:self-end mb-2"
                >
                  {feesExpanded ? 'Hide advanced' : 'Advanced (fees)'}
                </button>
              </div>

              {feesExpanded && (
                <div className="flex flex-col md:flex-row gap-4 mt-4 pt-4 border-t border-[#30363d]">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-[#8b949e]">
                      Spot fee (bps)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={spotFeeBps}
                      onChange={(e) =>
                        setSpotFeeBps(Math.max(0, parseFloat(e.target.value) || 0))
                      }
                      className="bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-[#c9d1d9] tabular-nums w-32 focus:outline-none focus:border-[#58a6ff]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-[#8b949e]">
                      Perp fee (bps)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={perpFeeBps}
                      onChange={(e) =>
                        setPerpFeeBps(Math.max(0, parseFloat(e.target.value) || 0))
                      }
                      className="bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-[#c9d1d9] tabular-nums w-32 focus:outline-none focus:border-[#58a6ff]"
                    />
                  </label>
                  <div className="flex flex-col gap-1 md:ml-auto">
                    <span className="text-xs text-[#8b949e]">
                      Round-trip fee on capital
                    </span>
                    <span className="px-3 py-2 text-[#c9d1d9] tabular-nums">
                      {yieldFigures && fmtUsd(yieldFigures.roundTripFee)}
                    </span>
                  </div>
                </div>
              )}

              {yieldFigures && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                    {[
                      ['Hourly', yieldFigures.hourly],
                      ['Daily', yieldFigures.daily],
                      ['Weekly', yieldFigures.weekly],
                      ['Monthly', yieldFigures.monthly],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <div className="text-xs text-[#8b949e]">{label}</div>
                        <div
                          className="text-lg font-semibold tabular-nums mt-1"
                          style={{
                            color:
                              (value as number) >= 0
                                ? 'var(--success)'
                                : 'var(--danger)',
                          }}
                        >
                          {fmtUsdSigned(value as number)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-[#30363d] flex items-center justify-between">
                    <span className="text-xs text-[#8b949e]">Annualized yield</span>
                    <span
                      className="text-base font-semibold tabular-nums"
                      style={{
                        color:
                          yieldFigures.annualizedPct >= 0
                            ? 'var(--success)'
                            : 'var(--danger)',
                      }}
                    >
                      {fmtPct(yieldFigures.annualizedPct, 2)} ·{' '}
                      {fmtUsdSigned(yieldFigures.annualized)}/yr
                    </span>
                  </div>
                  {data.netCarryHourly < 0 && (
                    <div className="mt-3 text-xs text-[#f85149]">
                      Carry is currently negative — you would be paying, not earning.
                    </div>
                  )}
                </>
              )}
              <MethodologyPopup
                whatItMeans="Projected dollar yield at current rates. Holds rates constant — see the Duration section for how long they're expected to persist."
                howComputed="hourly = capital × netCarryHourly. Daily/weekly/monthly are linear scalings; annualized = capital × netCarryAnnualized."
                source="Linear yield projection. Future realized return depends on funding rate persistence (OU half-life)."
              />
            </Card>

            {/* Funding chart */}
            <Card className="mt-6">
              <div className="flex items-baseline justify-between mb-4">
                <div className="text-xs uppercase tracking-wide text-[#8b949e]">
                  Funding Rate History
                </div>
                <div className="text-xs text-[#8b949e]">
                  {data.dataPoints} observations · oldest{' '}
                  {new Date(data.oldestDataPoint).toLocaleDateString()}
                </div>
              </div>
              <FundingChart
                history={data.fundingHistory}
                breakeven={data.borrowRateApr / 8760}
              />
              <div className="text-xs text-[#8b949e] mt-2">
                Green: funding above borrow-adjusted breakeven (positive carry).
                Red: below. Dashed yellow line: breakeven threshold.
              </div>
            </Card>
          </section>

          {/* ─── Section 2: Risk ─── */}
          <section>
            <SectionHeader title="Risk Assessment" summary={riskHeadline(data.ctr)} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Utilization Risk */}
              <Card title="Utilization Risk">
                <div className="flex items-baseline justify-between">
                  <div
                    className="text-3xl font-semibold tabular-nums"
                    style={{ color: utilColor(data.utilization) }}
                  >
                    {fmtPct(data.utilization, 2)}
                  </div>
                  <div className="text-xs text-[#8b949e]">utilization</div>
                </div>
                {/* Progress bar with kink/cutoff markers */}
                <div className="relative mt-4 h-2 bg-[#21262d] rounded">
                  <div
                    className="absolute left-0 top-0 bottom-0 rounded"
                    style={{
                      width: `${Math.min(100, data.utilization * 100)}%`,
                      background: utilColor(data.utilization),
                    }}
                  />
                  <div
                    className="absolute top-[-4px] bottom-[-4px] w-px bg-[#d29922]"
                    style={{ left: '80%' }}
                    title="80% kink"
                  />
                  <div
                    className="absolute top-[-4px] bottom-[-4px] w-px bg-[#f85149]"
                    style={{ left: '90%' }}
                    title="90% cutoff"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                  <div>
                    <div className="text-[#8b949e]">To 80% kink</div>
                    <div className="tabular-nums">
                      {fmtPct(Math.max(0, data.utilizationToKink), 2)} pp
                    </div>
                  </div>
                  <div>
                    <div className="text-[#8b949e]">To 90% cutoff</div>
                    <div className="tabular-nums">
                      {fmtPct(Math.max(0, data.utilizationToCutoff), 2)} pp
                    </div>
                  </div>
                  <div>
                    <div className="text-[#8b949e]">Borrow APR (now)</div>
                    <div className="tabular-nums">{fmtPct(data.borrowRateApr, 2)}</div>
                  </div>
                  <div>
                    <div className="text-[#8b949e]">Lend APR</div>
                    <div className="tabular-nums">{fmtPct(data.lendRateApr, 2)}</div>
                  </div>
                </div>
                <MethodologyPopup
                  whatItMeans="Fraction of the loan pool currently borrowed. Pacifica's borrow rate accelerates above 80% utilization and new positions freeze at 90%."
                  howComputed="utilization = total_borrowed / total_borrowable, fetched from Pacifica's /loan_pool endpoint."
                  source="Pacifica unified-margin docs; based on Compound V3 / Aave V3 kinked rate model."
                />
              </Card>

              {/* Liquidation Distance */}
              <Card title="Liquidation Distance">
                <div className="text-3xl font-semibold tabular-nums text-[#3fb950]">
                  ~5–6×
                </div>
                <div className="text-sm text-[#8b949e] mt-1">
                  upward price move required
                </div>
                <div className="text-xs text-[#c9d1d9] mt-3 leading-relaxed">
                  Delta-neutral carry has very low liquidation risk. Spot collateral
                  on Pacifica is haircut to {fmtPct(data.ltvRatio, 0)} LTV; the ~20%
                  gap means it takes an extreme move to erode equity.
                </div>
                <MethodologyPopup
                  whatItMeans="How far the underlying price would need to move before maintenance margin is breached. For a balanced delta-neutral position, this is dominated by the spot LTV haircut, not the perp leg."
                  howComputed="Spot collateral counts at LTV × price; perp losses count at 100%. The ~20pp LTV gap implies a ~5–6× upward price move before equity is consumed."
                  source="Pacifica unified-margin / LTV model."
                />
              </Card>

              {/* Tail Risk */}
              <Card title="Tail Risk">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-[#8b949e]">CVaR (95%)</div>
                    <div
                      className="text-2xl font-semibold tabular-nums mt-1"
                      style={{ color: 'var(--danger)' }}
                    >
                      {data.cvar95 != null ? fmtPct(data.cvar95, 4) : '—'}
                    </div>
                    <div className="text-xs text-[#8b949e] mt-1">avg loss in worst 5%</div>
                  </div>
                  <div>
                    <div className="text-xs text-[#8b949e]">Realized skewness</div>
                    <div className="text-2xl font-semibold tabular-nums mt-1 text-[#c9d1d9]">
                      {data.skewness != null ? fmtNumber(data.skewness, 2) : '—'}
                    </div>
                  </div>
                </div>
                {data.skewness != null && data.skewness < -0.5 && (
                  <div className="mt-4 text-xs text-[#d29922] leading-relaxed">
                    ⚠ Negative skewness detected — high carry historically predicts
                    crash risk (Brunnermeier, Nagel & Pedersen, 2008).
                  </div>
                )}
                <MethodologyPopup
                  whatItMeans="Statistical measures of the worst-case behavior of the carry return series. CVaR is the average loss conditional on being in the worst 5% of hours; skewness measures asymmetry in the return distribution."
                  howComputed="CVaR: sort the hourly carry-return series, average the bottom 5%. Skewness: third central moment of the same series, divided by std³."
                  source="Acerbi & Tasche (2002); Brunnermeier, Nagel & Pedersen (2008), NBER WP 14473; Basel III FRTB."
                />
              </Card>

              {/* BIS Warning */}
              <Card title="BIS Research Note">
                <div className="text-sm text-[#c9d1d9] leading-relaxed">
                  BIS Working Paper 1087 finds that high carry predicts a 22%
                  increase in liquidations of short futures positions over the
                  following month.
                </div>
                <a
                  href={BIS_PAPER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-4 text-xs text-[#58a6ff] hover:underline"
                >
                  Read the paper →
                </a>
              </Card>
            </div>
          </section>

          {/* ─── Section 3: Duration ─── */}
          <section>
            <SectionHeader
              title="Duration & Breakeven"
              summary={durationHeadline(data.breakevenVsHalfLife)}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* OU Half-Life */}
              <Card title="OU Half-Life">
                {data.ouResult ? (
                  <>
                    <div className="text-3xl font-semibold tabular-nums text-[#c9d1d9]">
                      {fmtNumber(data.ouResult.halfLife, 1)} h
                    </div>
                    <div className="text-xs text-[#8b949e] mt-1">
                      {(() => {
                        const seLambda = data.ouResult.standardError;
                        const lo = data.ouResult.lambda + 2 * seLambda;
                        const hi = data.ouResult.lambda - 2 * seLambda;
                        const hlLo = lo < 0 ? -Math.log(2) / lo : null;
                        const hlHi = hi < 0 ? -Math.log(2) / hi : null;
                        if (hlLo == null || hlHi == null) return 'CI: — (λ confidence crosses 0)';
                        const lower = Math.min(hlLo, hlHi);
                        const upper = Math.max(hlLo, hlHi);
                        return `95% CI: ${fmtNumber(lower, 1)}–${fmtNumber(upper, 1)} h`;
                      })()}
                    </div>
                    <div className="text-xs text-[#8b949e] mt-3">
                      Long-run mean: {fmtPct(data.ouResult.mu, 4)}/hr
                    </div>
                    <div className="text-xs text-[#c9d1d9] mt-3 leading-relaxed">
                      Funding tends to revert halfway to its mean in{' '}
                      {fmtNumber(data.ouResult.halfLife, 1)} hours.
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[#8b949e]">
                    No mean-reversion detected (or insufficient data)
                  </div>
                )}
                <MethodologyPopup
                  whatItMeans="How quickly funding rates pull back toward their average. Half-life is the expected time for half of any deviation from the mean to decay."
                  howComputed="Fit AR(1): Δr_t = α + λ·r_{t-1} + ε. Half-life = −ln(2) / λ. CI from ±2 standard errors of λ."
                  source='Chan, E. (2013), "Algorithmic Trading"; standard mean-reversion test from pairs trading.'
                />
              </Card>

              {/* Z-Score */}
              <Card title="Z-Score (30-day)">
                {data.zScore != null ? (
                  <>
                    <div
                      className="text-3xl font-semibold tabular-nums"
                      style={{ color: zScoreColor(data.zScore) }}
                    >
                      {fmtNumber(data.zScore, 2)}
                    </div>
                    <div className="text-xs text-[#c9d1d9] mt-3 leading-relaxed">
                      {zInterpretation(data.zScore)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[#8b949e]">
                    Insufficient history (need ≥ 20 observations in window)
                  </div>
                )}
                <MethodologyPopup
                  whatItMeans="How many standard deviations the current funding rate is from its 30-day rolling mean. Positive means above-average funding (better entry); negative means depressed."
                  howComputed="(current − rolling_mean) / rolling_std over the last 720 hourly observations (30 days)."
                  source='Koijen, Moskowitz, Pedersen & Vrugt (2018), "Carry," Journal of Financial Economics.'
                />
              </Card>

              {/* Breakeven */}
              <Card title="Breakeven">
                {data.breakevenHours != null && data.ouResult ? (
                  <>
                    <div
                      className="text-3xl font-semibold tabular-nums"
                      style={{
                        color:
                          data.breakevenHours < data.ouResult.halfLife
                            ? 'var(--success)'
                            : 'var(--danger)',
                      }}
                    >
                      {fmtNumber(data.breakevenHours, 1)} h
                    </div>
                    <div className="text-xs text-[#8b949e] mt-1">
                      Half-life: {fmtNumber(data.ouResult.halfLife, 1)} h
                    </div>
                    {/* Comparison bar */}
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#8b949e] w-20">Breakeven</span>
                        <div className="flex-1 h-2 bg-[#21262d] rounded">
                          <div
                            className="h-2 rounded bg-[#58a6ff]"
                            style={{
                              width: `${Math.min(
                                100,
                                (data.breakevenHours /
                                  Math.max(data.breakevenHours, data.ouResult.halfLife)) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#8b949e] w-20">Half-life</span>
                        <div className="flex-1 h-2 bg-[#21262d] rounded">
                          <div
                            className="h-2 rounded bg-[#8b949e]"
                            style={{
                              width: `${Math.min(
                                100,
                                (data.ouResult.halfLife /
                                  Math.max(data.breakevenHours, data.ouResult.halfLife)) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[#8b949e]">
                    N/A — carry is non-positive
                  </div>
                )}
                <MethodologyPopup
                  whatItMeans="Minimum hours you'd need to hold the trade for net carry to recoup the round-trip entry/exit fees, at current rates."
                  howComputed="T_min = round_trip_cost_rate / hourly_net_carry. Round trip = 2× spot fee + 2× perp fee."
                  source='He, Manela, Ross & von Wachter (2022), "Fundamentals of Perpetual Futures."'
                />
              </Card>
            </div>

            {/* Basis chart placeholder — see footer note */}
            <Card className="mt-6">
              <div className="text-xs uppercase tracking-wide text-[#8b949e] mb-3">
                Basis History
              </div>
              <div className="text-sm text-[#8b949e] leading-relaxed">
                Basis history requires a historical perp/spot price series, which the
                current <code className="text-[#c9d1d9]">/api/carry</code> response
                doesn't expose. Current basis is shown above in the Opportunity
                section.
              </div>
            </Card>
          </section>

          {/* ─── Footer ─── */}
          <footer className="border-t border-[#30363d] pt-6 text-xs text-[#8b949e] space-y-2">
            <div>Built for Pacifica's unified margin.</div>
            <div className="leading-relaxed">
              Methodology based on: Curcuru/Vega/Hoek (2010), Lo (2002),
              Brunnermeier/Nagel/Pedersen (2008), He/Manela/Ross/von Wachter (2022),
              Christin/Routledge/Soska/Zetlin-Jones (2022).
            </div>
            <div>Data from Pacifica API — not financial advice.</div>
          </footer>
        </main>
      )}
    </div>
  );
}

function Header({
  symbol,
  onSymbolChange,
  lastUpdated,
  onRefresh,
  refreshing,
}: {
  symbol: string;
  onSymbolChange: (s: string) => void;
  lastUpdated: Date | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 bg-[#0d1117]/90 backdrop-blur border-b border-[#30363d]">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <div>
          <div className="text-base font-semibold text-[#c9d1d9]">BOOBArbitrage</div>
          <div className="text-xs text-[#8b949e]">
            Carry Trade Analytics for Pacifica
          </div>
        </div>
        <div className="flex-1" />
        <select
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value)}
          className="bg-[#161b22] border border-[#30363d] rounded px-2 py-1.5 text-sm text-[#c9d1d9] focus:outline-none focus:border-[#58a6ff]"
        >
          {SUPPORTED_SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="hidden md:block text-xs text-[#8b949e] tabular-nums">
          {lastUpdated
            ? `Updated ${lastUpdated.toLocaleTimeString()}`
            : 'Loading…'}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[#8b949e] hover:text-[#58a6ff] disabled:opacity-50 transition-colors"
          aria-label="Refresh"
          title="Refresh"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            className={refreshing ? 'animate-spin' : ''}
            aria-hidden="true"
          >
            <path d="M8 2.5a5.5 5.5 0 014.95 3.084.75.75 0 001.345-.668A7 7 0 001 8h-.5a.5.5 0 00-.354.854l1.5 1.5a.5.5 0 00.708 0l1.5-1.5A.5.5 0 003.5 8H2.5a5.5 5.5 0 015.5-5.5zM13.5 8h.5a.5.5 0 00.354-.854l-1.5-1.5a.5.5 0 00-.708 0l-1.5 1.5A.5.5 0 0011 8h1A4 4 0 018 12a4 4 0 01-3.6-2.252.75.75 0 10-1.345.668A5.5 5.5 0 0013.5 8z" />
          </svg>
        </button>
        <a
          href="https://github.com/anthropics"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:inline-block text-xs text-[#58a6ff] hover:underline"
        >
          BOOBAnalytics →
        </a>
      </div>
    </header>
  );
}
