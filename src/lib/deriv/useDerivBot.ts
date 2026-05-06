import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DerivClient } from "./client";
import { digitRepeatTrigger, lastDigitOf } from "./strategy";
import { stakeForProfit } from "./stake";
import { SYMBOL, type BotConfig, type BotStatus, type Tick, type TradeRecord } from "./types";

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
  batchSize: 5,
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
    } catch (e: any) {
      subscribedRef.current = false;
      pushLog(`Failed to subscribe: ${e?.message ?? e}`);
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
    } catch (e: any) {
      const msg = e?.message || "Auth failed";
      setState((s) => ({ ...s, status: "error", lastError: msg, authorized: false }));
      pushLog(`Error: ${msg}`);
      return false;
    }
  }, [token, ensureClient, pushLog, subscribeTicks]);

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
    async (barrier: number, stake: number, duration: number, attempt = 0): Promise<any> => {
      const c = clientRef.current!;
      try {
        const res = await c.buyDigitDiff({ symbol: SYMBOL.code, barrier, stake, duration });
        return { res };
      } catch (err: any) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
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

    inFlightRef.current = true;
    cycleRef.current += 1;
    const cycle = cycleRef.current;
    const stake = stakeForProfit(totalProfitRef.current);
    const duration = Math.max(1, cfg.ticks);
    const barrier = cfg.digit;

    setState((s) => ({ ...s, status: "running", cycle }));
    pushLog(
      `Cycle #${cycle}: digit ${barrier} repeated ${cfg.repetitions}× → ${cfg.batchSize}× DIGITDIFF≠${barrier} @ $${stake} (${duration}t)`,
    );

    const placeholders: TradeRecord[] = Array.from({ length: cfg.batchSize }, (_, i) => ({
      id: `${cycle}-${i}-${Date.now()}`,
      cycle,
      predictedDigit: barrier,
      stake,
      duration,
      status: "pending",
      openedAt: Date.now(),
    }));

    setState((s) => ({ ...s, trades: [...placeholders, ...s.trades].slice(0, 200) }));

    const buyResults = await Promise.all(
      placeholders.map((p) =>
        buyWithRetry(barrier, stake, duration).then((r) => ({ p, ...r })),
      ),
    );

    const settlePromises: Promise<void>[] = [];

    buyResults.forEach(({ p, res, err }: any) => {
      if (err || !res?.buy) {
        const message = err?.message || "Buy failed";
        setState((s) => ({
          ...s,
          trades: s.trades.map((t) =>
            t.id === p.id ? { ...t, status: "error", error: message, closedAt: Date.now() } : t,
          ),
        }));
        pushLog(`Trade failed: ${message}`);
        return;
      }
      const contractId = res.buy.contract_id as number;
      setState((s) => ({
        ...s,
        trades: s.trades.map((t) => (t.id === p.id ? { ...t, status: "open", contractId } : t)),
      }));

      settlePromises.push(
        new Promise<void>((resolve) => {
          c.openContractStream(contractId, (msg) => {
            const poc = msg.proposal_open_contract;
            if (!poc) return;
            if (poc.is_sold) {
              const profit = Number(poc.profit ?? 0);
              const won = profit >= 0;
              const exitSpot = Number(poc.exit_spot);
              const exitDigit = isFinite(exitSpot) ? lastDigitOf(exitSpot) : undefined;
              setState((s) => ({
                ...s,
                trades: s.trades.map((t) =>
                  t.id === p.id
                    ? {
                        ...t,
                        status: won ? "won" : "lost",
                        profit,
                        payout: poc.payout,
                        entrySpot: poc.entry_spot,
                        exitSpot,
                        exitDigit,
                        closedAt: Date.now(),
                      }
                    : t,
                ),
                wins: won ? s.wins + 1 : s.wins,
                losses: won ? s.losses : s.losses + 1,
              }));
              updateProfit(profit);
              resolve();
            }
          }).catch(() => resolve());
        }),
      );
    });

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
