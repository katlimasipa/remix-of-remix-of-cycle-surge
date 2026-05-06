import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DerivClient } from "./client";
import { digitRepeatTrigger, lastDigitOf } from "./strategy";
import { stakeForProfit } from "./stake";
import { SYMBOL, type BotConfig, type BotStatus, type Tick, type TradeRecord } from "./types";

function errMessage(e: unknown): string {
  if (!e || typeof e !== "object") return String(e ?? "Unknown error");
  const obj = e as Record<string, unknown>;
  if (typeof obj.message === "string") return obj.message;
  return String(e ?? "Unknown error");
}

function errCode(e: unknown): string {
  if (!e || typeof e !== "object") return "";
  const obj = e as Record<string, unknown>;
  if (typeof obj.code === "string") return obj.code;
  return "";
}

interface EquityPoint {
  t: number;
  pnl: number;
}

interface UseDerivBotState {
  status: BotStatus;
  wsStatus: "connecting" | "open" | "closed" | "error" | "idle";
  ticks: Tick[];
  trades: TradeRecord[];
  cycle: number;
  totalProfit: number;
  currentStake: number;
  wins: number;
  losses: number;
  equity: EquityPoint[];
  balance: number | null;
  lastError: string | null;
  authorized: boolean;
  triggerStreak: number; // current run-length of the configured digit
  log: { t: number; msg: string }[];
}

const DEFAULT_CONFIG: BotConfig = {
  digit: 0,
  repetitions: 3,
  ticks: 1,
  batchSize: 1,
  takeProfit: null,
  stopLoss: null,
  maxCycles: null,
};

export function useDerivBot() {
  const [token, setToken] = useState<string>(
    () => (typeof window !== "undefined" && localStorage.getItem("deriv_token")) || "",
  );
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const [state, setState] = useState<UseDerivBotState>({
    status: "idle",
    wsStatus: "idle",
    ticks: [],
    trades: [],
    cycle: 0,
    totalProfit: 0,
    currentStake: 1,
    wins: 0,
    losses: 0,
    equity: [{ t: Date.now(), pnl: 0 }],
    balance: null,
    lastError: null,
    authorized: false,
    triggerStreak: 0,
    log: [],
  });

  const clientRef = useRef<DerivClient | null>(null);
  const ticksRef = useRef<Tick[]>([]);
  const subscribedRef = useRef(false);
  const runningRef = useRef(false);
  const inFlightRef = useRef(false);
  const totalProfitRef = useRef(0);
  const cycleRef = useRef(0);
  const consecutiveLossesRef = useRef(0);
  // Adaptive buy pacing: Deriv enforces a per-account buy rate limit, but it can vary.
  // We keep a global "next allowed buy time" and increase the gap on RateLimit responses.
  const nextAllowedBuyAtRef = useRef(0);
  const adaptiveBuyGapMsRef = useRef(1200); // starts ~1.2s, expands on rate limit, decays on success
  const balanceRefreshInFlightRef = useRef(false);
  const lastBalanceRefreshAtRef = useRef(0);
  const balanceRefreshTimerRef = useRef<number | null>(null);

  const pushLog = useCallback((msg: string) => {
    setState((s) => ({
      ...s,
      log: [{ t: Date.now(), msg }, ...s.log].slice(0, 300),
    }));
  }, []);

  const saveToken = useCallback((t: string) => {
    setToken(t);
    if (typeof window !== "undefined") localStorage.setItem("deriv_token", t);
  }, []);

  const ensureClient = useCallback(() => {
    if (clientRef.current) return clientRef.current;
    const c = new DerivClient({
      onStatus: (s) => setState((st) => ({ ...st, wsStatus: s })),
    });
    clientRef.current = c;
    c.connect();
    return c;
  }, []);

  const subscribeTicks = useCallback(async () => {
    const c = clientRef.current;
    if (!c || subscribedRef.current) return;
    subscribedRef.current = true;
    try {
      await c.ticks(SYMBOL.code, (msg) => {
        if (msg.tick && msg.tick.symbol === SYMBOL.code) {
          const quote = Number(msg.tick.quote);
          const t: Tick = {
            epoch: msg.tick.epoch,
            quote,
            lastDigit: lastDigitOf(quote),
          };
          const prev = ticksRef.current;
          const next = [...prev.slice(-200), t];
          ticksRef.current = next;
        }
      });
      pushLog(`Subscribed to ${SYMBOL.label} ticks.`);
    } catch (e: unknown) {
      subscribedRef.current = false;
      pushLog(`Failed to subscribe: ${errMessage(e)}`);
    }
  }, [pushLog]);

  const connect = useCallback(async () => {
    if (!token) {
      setState((s) => ({ ...s, lastError: "Missing API token" }));
      return false;
    }
    const c = ensureClient();
    setState((s) => ({ ...s, status: "connecting", lastError: null }));
    try {
      await c.authorize(token);
      const bal = await c.balance();
      setState((s) => ({
        ...s,
        authorized: true,
        balance: bal.balance?.balance ?? null,
        status: "idle",
      }));
      pushLog("Authorized.");
      await subscribeTicks();
      return true;
    } catch (e: unknown) {
      const msg = errMessage(e) || "Auth failed";
      setState((s) => ({ ...s, status: "error", lastError: msg, authorized: false }));
      pushLog(`Error: ${msg}`);
      return false;
    }
  }, [token, ensureClient, pushLog, subscribeTicks]);

  const refreshBalanceThrottled = useCallback(
    (reason: string) => {
      const c = clientRef.current;
      if (!c) return;

      // Balance calls are relatively expensive; also don't spam while trades settle.
      const MIN_GAP_MS = 1500;
      const now = Date.now();
      const dueIn = Math.max(0, lastBalanceRefreshAtRef.current + MIN_GAP_MS - now);

      const schedule = (ms: number) => {
        if (balanceRefreshTimerRef.current != null) return;
        balanceRefreshTimerRef.current = window.setTimeout(async () => {
          balanceRefreshTimerRef.current = null;
          if (balanceRefreshInFlightRef.current) return;
          balanceRefreshInFlightRef.current = true;
          try {
            const bal = await c.balance();
            lastBalanceRefreshAtRef.current = Date.now();
            const nextBalance = bal.balance?.balance ?? null;
            setState((s) => ({ ...s, balance: nextBalance }));
          } catch (e: unknown) {
            pushLog(`Balance refresh failed (${reason}): ${errMessage(e)}`);
          } finally {
            balanceRefreshInFlightRef.current = false;
          }
        }, ms);
      };

      schedule(dueIn);
    },
    [pushLog],
  );

  const updateProfit = useCallback((delta: number) => {
    totalProfitRef.current += delta;
    setState((s) => {
      const newPnl = s.totalProfit + delta;
      return {
        ...s,
        totalProfit: newPnl,
        currentStake: stakeForProfit(newPnl),
        equity: [...s.equity, { t: Date.now(), pnl: newPnl }].slice(-500),
      };
    });
  }, []);

  const buyWithRetry = useCallback(
    async (barrier: number, stake: number, duration: number, attempt = 0) => {
      const c = clientRef.current!;
      try {
        const res = await c.buyDigitDiff({ symbol: SYMBOL.code, barrier, stake, duration });
        return { res };
      } catch (err: unknown) {
        const code = errCode(err);
        const msg = errMessage(err);
        const isRate = code === "RateLimit" || /rate.?limit/i.test(msg) || /too many/i.test(msg);
        const maxAttempts = isRate ? 6 : 2;
        if (attempt < maxAttempts) {
          // Rate limit → exponential backoff; other errors get a short retry.
          const delay = isRate
            ? 900 * Math.pow(1.7, attempt) + Math.random() * 350
            : 300 * (attempt + 1);
          await new Promise((r) => setTimeout(r, delay));
          return buyWithRetry(barrier, stake, duration, attempt + 1);
        }
        return { err };
      }
    },
    [],
  );

  const runBatch = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    if (inFlightRef.current) return;

    const cfg = configRef.current;
    const ticks = ticksRef.current;
    if (!digitRepeatTrigger(ticks, cfg.digit, cfg.repetitions)) return;

    const effectiveBatchSize = cfg.ticks <= 1 ? 1 : cfg.batchSize;

    inFlightRef.current = true;
    cycleRef.current += 1;
    const cycle = cycleRef.current;
    const stake = stakeForProfit(totalProfitRef.current);
    const duration = Math.max(1, cfg.ticks);
    const barrier = cfg.digit;

    setState((s) => ({ ...s, status: "running", cycle }));
    pushLog(
      `Cycle #${cycle}: digit ${barrier} repeated ${cfg.repetitions}× → ${effectiveBatchSize}× DIGITDIFF≠${barrier} @ $${stake} (${duration}t)`,
    );

    const placeholders: TradeRecord[] = Array.from({ length: effectiveBatchSize }, (_, i) => ({
      id: `${cycle}-${i}-${Date.now()}`,
      cycle,
      predictedDigit: barrier,
      stake,
      duration,
      status: "pending",
      openedAt: Date.now(),
    }));

    setState((s) => ({ ...s, trades: [...placeholders, ...s.trades].slice(0, 200) }));

    // Deriv enforces a per-account buy rate limit. We pace buys globally and adapt
    // if the API returns RateLimit, rather than assuming a fixed 1 buy/sec.
    // CRITICAL: subscribe to each contract's settlement immediately after its buy
    // so we don't miss the is_sold event while later buys are still being placed.
    const settlePromises: Promise<void>[] = [];

    const handleSettlement = (p: TradeRecord, poc: unknown) => {
      const pocObj = (poc ?? {}) as Record<string, unknown>;
      const profit = Number(pocObj.profit ?? 0);
      const won = profit >= 0;
      const exitSpot = Number(pocObj.exit_spot);
      const exitDigit = isFinite(exitSpot) ? lastDigitOf(exitSpot) : undefined;
      let didApply = false;
      setState((s) => {
        const existing = s.trades.find((t) => t.id === p.id);
        if (!existing || existing.status === "won" || existing.status === "lost") {
          return s; // already settled — ignore duplicate
        }
        didApply = true;
        return {
          ...s,
          trades: s.trades.map((t) =>
            t.id === p.id
              ? {
                  ...t,
                  status: won ? "won" : "lost",
                  profit,
                  payout: pocObj.payout,
                  entrySpot: pocObj.entry_spot,
                  exitSpot,
                  exitDigit,
                  closedAt: Date.now(),
                }
              : t,
          ),
          wins: won ? s.wins + 1 : s.wins,
          losses: won ? s.losses : s.losses + 1,
        };
      });
      if (didApply) updateProfit(profit);
      if (didApply) refreshBalanceThrottled("settlement");
      return didApply;
    };

    for (let i = 0; i < placeholders.length; i++) {
      const p = placeholders[i];

      // Global pacing gate (across retries too): wait until we're allowed to buy again.
      const now = Date.now();
      const waitMs = Math.max(0, nextAllowedBuyAtRef.current - now);
      if (waitMs > 0) {
        await new Promise((res) => setTimeout(res, waitMs));
      }

      const r = await buyWithRetry(barrier, stake, duration);

      if (r.err || !r.res?.buy) {
        const message = errMessage(r.err) || "Buy failed";
        const code = errCode(r.err);
        const isRate =
          code === "RateLimit" ||
          /rate.?limit/i.test(String(message)) ||
          /too many/i.test(String(message));

        if (isRate) {
          // Increase the gap aggressively on rate limit and cool down globally.
          adaptiveBuyGapMsRef.current = Math.min(
            6000,
            Math.max(1400, Math.floor(adaptiveBuyGapMsRef.current * 1.6)),
          );
          const coolDown = adaptiveBuyGapMsRef.current + 800;
          nextAllowedBuyAtRef.current = Date.now() + coolDown;
          pushLog(`Rate limited by Deriv — cooling down for ${Math.round(coolDown / 100) / 10}s…`);
        } else {
          // Non-rate errors: keep pacing but don't expand the gap.
          nextAllowedBuyAtRef.current = Date.now() + adaptiveBuyGapMsRef.current;
        }

        setState((s) => ({
          ...s,
          trades: s.trades.map((t) =>
            t.id === p.id ? { ...t, status: "error", error: message, closedAt: Date.now() } : t,
          ),
        }));
        pushLog(`Trade failed: ${message}`);
      } else {
        const contractId = r.res.buy.contract_id as number;
        // Successful buy: schedule next allowed buy and slowly decay gap back toward baseline.
        nextAllowedBuyAtRef.current = Date.now() + adaptiveBuyGapMsRef.current;
        adaptiveBuyGapMsRef.current = Math.max(
          1100,
          Math.floor(adaptiveBuyGapMsRef.current * 0.95),
        );
        setState((s) => ({
          ...s,
          trades: s.trades.map((t) => (t.id === p.id ? { ...t, status: "open", contractId } : t)),
        }));

        settlePromises.push(
          new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearInterval(pollId);
              resolve();
            };

            // Primary: subscribe to live updates
            c.openContractStream(contractId, (msg) => {
              const poc = msg.proposal_open_contract;
              if (!poc || !poc.is_sold) return;
              handleSettlement(p, poc);
              finish();
            }).catch(() => {});

            // Fallback: poll every 2s in case the stream missed the sold event
            const pollId = setInterval(async () => {
              try {
                const res = await c.send({
                  proposal_open_contract: 1,
                  contract_id: contractId,
                });
                const poc = res.proposal_open_contract;
                if (poc?.is_sold) {
                  handleSettlement(p, poc);
                  finish();
                }
              } catch {
                /* ignore — will retry */
              }
            }, 2000);

            // Hard timeout safety net: 60s
            setTimeout(() => {
              if (!settled) {
                pushLog(`Trade ${contractId} timeout — marking as error.`);
                setState((s) => ({
                  ...s,
                  trades: s.trades.map((t) =>
                    t.id === p.id && t.status === "open"
                      ? { ...t, status: "error", error: "settlement timeout", closedAt: Date.now() }
                      : t,
                  ),
                }));
                finish();
              }
            }, 60000);
          }),
        );
      }
    }

    pushLog(`Waiting for ${settlePromises.length} trades to settle...`);
    const profitBefore = totalProfitRef.current;
    await Promise.all(settlePromises);
    inFlightRef.current = false;

    const cyclePnl = totalProfitRef.current - profitBefore;

    if (cyclePnl < 0) {
      consecutiveLossesRef.current += 1;
      pushLog(
        `Cycle #${cycle} LOSS $${cyclePnl.toFixed(2)} • streak ${consecutiveLossesRef.current}`,
      );
      if (consecutiveLossesRef.current >= 3) {
        pushLog("Max loss streak reached (3). Stopping bot for safety.");
        runningRef.current = false;
        setState((s) => ({ ...s, status: "stopped" }));
      }
    } else {
      consecutiveLossesRef.current = 0;
      pushLog(
        `Cycle #${cycle} WIN +$${cyclePnl.toFixed(2)} • Total $${totalProfitRef.current.toFixed(2)}`,
      );
    }

    if (cfg.takeProfit != null && totalProfitRef.current >= cfg.takeProfit) {
      pushLog(`Take profit reached. Stopping.`);
      runningRef.current = false;
    }
    if (cfg.stopLoss != null && totalProfitRef.current <= -Math.abs(cfg.stopLoss)) {
      pushLog(`Stop loss reached. Stopping.`);
      runningRef.current = false;
    }
    if (cfg.maxCycles != null && cycle >= cfg.maxCycles) {
      pushLog(`Max cycles reached. Stopping.`);
      runningRef.current = false;
    }
  }, [buyWithRetry, pushLog, updateProfit]);

  // UI/loop driver
  useEffect(() => {
    const id = setInterval(() => {
      const ticks = ticksRef.current.slice(-50);
      const cfg = configRef.current;
      // compute current run-length of cfg.digit at the tail
      let streak = 0;
      for (let i = ticks.length - 1; i >= 0; i--) {
        if (ticks[i].lastDigit === cfg.digit) streak++;
        else break;
      }
      setState((s) => ({ ...s, ticks, triggerStreak: streak }));

      if (!runningRef.current || inFlightRef.current) return;
      runBatch();
    }, 300);
    return () => clearInterval(id);
  }, [runBatch]);

  const start = useCallback(async () => {
    if (!state.authorized) {
      const ok = await connect();
      if (!ok) return;
    }
    runningRef.current = true;
    setState((s) => ({ ...s, status: "running" }));
    pushLog("Bot started.");
  }, [state.authorized, connect, pushLog]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setState((s) => ({ ...s, status: "stopped" }));
    pushLog("Bot stopped.");
  }, [pushLog]);

  const reset = useCallback(() => {
    runningRef.current = false;
    inFlightRef.current = false;
    totalProfitRef.current = 0;
    cycleRef.current = 0;
    consecutiveLossesRef.current = 0;
    setState((s) => ({
      ...s,
      status: "idle",
      trades: [],
      cycle: 0,
      totalProfit: 0,
      currentStake: 1,
      wins: 0,
      losses: 0,
      equity: [{ t: Date.now(), pnl: 0 }],
      log: [{ t: Date.now(), msg: "Session reset." }, ...s.log].slice(0, 300),
    }));
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  const winRate = useMemo(() => {
    const total = state.wins + state.losses;
    return total === 0 ? 0 : (state.wins / total) * 100;
  }, [state.wins, state.losses]);

  return {
    token,
    saveToken,
    config,
    setConfig,
    ...state,
    winRate,
    connect,
    start,
    stop,
    reset,
  };
}
