export type RiseFallSignal =
  | { direction: "RISE" | "FALL"; reason: string; emaFast: number; emaSlow: number; rsi: number }
  | { direction: null; reason: string; emaFast: number; emaSlow: number; rsi: number };

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const p = Math.max(1, Math.floor(period));
  const k = 2 / (p + 1);
  const start = Math.max(0, values.length - p * 5); // avoid long warmups on huge arrays
  let e = mean(values.slice(start, start + p));
  for (let i = start + p; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

export function rsi(values: number[], period: number): number {
  const p = Math.max(1, Math.floor(period));
  if (values.length < p + 1) return 50;
  const start = values.length - (p + 1);
  let gains = 0;
  let losses = 0;
  for (let i = start + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses += -d;
  }
  const avgGain = gains / p;
  const avgLoss = losses / p;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function evaluateRiseFallSignal(input: {
  closes: number[];
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiRiseMin: number; // e.g. 55
  rsiFallMax: number; // e.g. 45
}): RiseFallSignal {
  const { closes } = input;
  const fast = ema(closes, input.emaFast);
  const slow = ema(closes, input.emaSlow);
  const r = rsi(closes, input.rsiPeriod);

  // Strict but simple trend + momentum filter.
  // - Trend: EMA fast above/below slow
  // - Momentum: RSI in confirming zone
  const upTrend = fast > slow;
  const downTrend = fast < slow;

  if (upTrend && r >= input.rsiRiseMin && r < 80) {
    return {
      direction: "RISE",
      reason: `EMA(${input.emaFast})>EMA(${input.emaSlow}) and RSI(${input.rsiPeriod})=${r.toFixed(1)}>=${input.rsiRiseMin}`,
      emaFast: fast,
      emaSlow: slow,
      rsi: r,
    };
  }

  if (downTrend && r <= input.rsiFallMax && r > 20) {
    return {
      direction: "FALL",
      reason: `EMA(${input.emaFast})<EMA(${input.emaSlow}) and RSI(${input.rsiPeriod})=${r.toFixed(1)}<=${input.rsiFallMax}`,
      emaFast: fast,
      emaSlow: slow,
      rsi: r,
    };
  }

  return {
    direction: null,
    reason: `No signal (EMAfast=${fast.toFixed(2)}, EMAslow=${slow.toFixed(2)}, RSI=${r.toFixed(1)})`,
    emaFast: fast,
    emaSlow: slow,
    rsi: r,
  };
}
