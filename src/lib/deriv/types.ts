export interface Tick {
  epoch: number;
  quote: number;
  lastDigit: number;
}

export const SYMBOL = { code: "R_100", label: "Volatility 100 Index" };

export interface TradeRecord {
  id: string;
  contractId?: number;
  cycle: number;
  predictedDigit: number; // the digit we expect price to DIFFER from
  stake: number;
  duration: number;
  payout?: number;
  profit?: number;
  exitDigit?: number;
  status: "pending" | "open" | "won" | "lost" | "error";
  openedAt: number;
  closedAt?: number;
  entrySpot?: number;
  exitSpot?: number;
  error?: string;
}

export interface BotConfig {
  digit: number;          // 0-9 — digit that must repeat to trigger
  repetitions: number;    // consecutive appearances required
  ticks: number;          // contract duration in ticks
  batchSize: number;      // simultaneous contracts per cycle
  takeProfit: number | null;
  stopLoss: number | null;
  maxCycles: number | null;
}

export type BotStatus = "idle" | "connecting" | "running" | "waiting" | "stopped" | "error";
