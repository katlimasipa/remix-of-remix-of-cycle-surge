export interface Tick {
  epoch: number;
  quote: number;
  lastDigit: number;
}

export type DerivSymbolCode = "R_100" | "R_75";

export const SYMBOLS: Array<{ code: DerivSymbolCode; label: string }> = [
  { code: "R_100", label: "Volatility 100 Index" },
  { code: "R_75", label: "Volatility 75 Index" },
];

export type TradeDirection = "RISE" | "FALL";
export type DurationUnit = "t" | "m";

export interface TradeRecord {
  id: string;
  contractId?: number;
  cycle: number;
  symbol: DerivSymbolCode;
  direction: TradeDirection;
  stake: number;
  duration: number;
  durationUnit: DurationUnit;
  payout?: number;
  profit?: number;
  status: "pending" | "open" | "won" | "lost" | "error";
  openedAt: number;
  closedAt?: number;
  entrySpot?: number;
  exitSpot?: number;
  error?: string;
}

export interface BotConfig {
  symbol: DerivSymbolCode;
  duration: number;
  durationUnit: DurationUnit;
  batchSize: number; // contracts per signal
  granularitySec: number; // candles granularity used for analysis
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiRiseMin: number;
  rsiFallMax: number;
  takeProfit: number | null;
  stopLoss: number | null;
  maxCycles: number | null;
}

export type BotStatus = "idle" | "connecting" | "running" | "waiting" | "stopped" | "error";
