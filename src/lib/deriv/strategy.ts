import type { Tick } from "./types";

/** Extract the last decimal digit from a Volatility 100 quote (2-decimal precision). */
export function lastDigitOf(quote: number): number {
  // R_100 quotes are typically 2-decimal. Multiply, round, mod 10.
  return Math.round(quote * 100) % 10;
}

/**
 * Returns true when the last `repetitions` ticks all end in `digit`.
 * The bot then fires a DIGITDIFF batch predicting the next tick will NOT be `digit`.
 */
export function digitRepeatTrigger(
  ticks: Tick[],
  digit: number,
  repetitions: number,
): boolean {
  if (repetitions <= 0) return false;
  if (ticks.length < repetitions) return false;
  const tail = ticks.slice(-repetitions);
  return tail.every((t) => t.lastDigit === digit);
}
