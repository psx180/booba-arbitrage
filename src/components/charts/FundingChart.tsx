'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface FundingChartProps {
  /** Funding rate observations, sorted ascending by timestamp. */
  history: Array<{ rate: number; timestamp: number }>;
  /** Borrow-adjusted hourly breakeven (borrowRateApr / 8760). */
  breakeven: number;
}

interface ChartPoint {
  timestamp: number;
  /** rate when >= breakeven; null otherwise. The two-key split is how recharts
   *  draws color-coded segments without per-segment stroke support. */
  rateAbove: number | null;
  rateBelow: number | null;
}

const formatTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  });

const formatPct = (rate: number) => `${(rate * 100).toFixed(4)}%`;

export function FundingChart({ history, breakeven }: FundingChartProps) {
  const data: ChartPoint[] = history.map((p) => ({
    timestamp: p.timestamp,
    rateAbove: p.rate >= breakeven ? p.rate : null,
    rateBelow: p.rate < breakeven ? p.rate : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#21262d" strokeDasharray="3 3" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTime}
          stroke="#8b949e"
          fontSize={11}
          minTickGap={50}
        />
        <YAxis
          stroke="#8b949e"
          fontSize={11}
          tickFormatter={(v) => `${(v * 100).toFixed(3)}%`}
          width={70}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 4,
            fontSize: 12,
            color: '#c9d1d9',
          }}
          labelStyle={{ color: '#8b949e' }}
          labelFormatter={(label) => formatTime(label as number)}
          formatter={(value) => {
            if (typeof value !== 'number') return ['—', 'rate'];
            const positive = value >= breakeven;
            return [
              `${formatPct(value)} ${positive ? '(positive carry)' : '(negative carry)'}`,
              'Funding rate',
            ];
          }}
        />
        <ReferenceLine y={0} stroke="#8b949e" strokeDasharray="2 2" />
        <ReferenceLine
          y={breakeven}
          stroke="#d29922"
          strokeDasharray="4 4"
          label={{
            value: 'Borrow breakeven',
            fill: '#d29922',
            fontSize: 10,
            position: 'insideTopRight',
          }}
        />
        <Line
          type="monotone"
          dataKey="rateAbove"
          stroke="#3fb950"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
          name="Above breakeven"
        />
        <Line
          type="monotone"
          dataKey="rateBelow"
          stroke="#f85149"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
          name="Below breakeven"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
