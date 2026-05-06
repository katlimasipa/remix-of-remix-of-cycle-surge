/**
 * Deriv WebSocket client.
 * - Auto-reconnect with backoff
 * - Promise-based request/response via req_id
 * - Subscription callbacks
 * Docs: https://api.deriv.com/
 */

export type DerivError = {
  code?: string;
  message?: string;
  [k: string]: unknown;
};

export type DerivMsg = {
  req_id?: number;
  subscription?: { id?: string; [k: string]: unknown };
  error?: DerivError;
  [k: string]: unknown;
};

type Listener = (msg: DerivMsg) => void;

export interface DerivClientOptions {
  appId?: string;
  endpoint?: string;
  onStatus?: (s: "connecting" | "open" | "closed" | "error") => void;
  onMessage?: (msg: AnyMsg) => void;
}

export class DerivClient {
  private ws: WebSocket | null = null;
  private appId: string;
  private endpoint: string;
  private reqId = 1;
  private pending = new Map<
    number,
    { resolve: (v: DerivMsg) => void; reject: (e: unknown) => void }
  >();
  private subs = new Map<string, Listener>(); // by subscription id
  private reqSubs = new Map<number, Listener>(); // by req_id (until id known)
  private opts: DerivClientOptions;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private openWaiters: Array<() => void> = [];
  private token: string | null = null;

  constructor(opts: DerivClientOptions = {}) {
    this.opts = opts;
    this.appId = opts.appId ?? "1089"; // default public app id
    this.endpoint = opts.endpoint ?? "wss://ws.derivws.com/websockets/v3";
  }

  connect() {
    this.shouldReconnect = true;
    this.opts.onStatus?.("connecting");
    const url = `${this.endpoint}?app_id=${this.appId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.opts.onStatus?.("open");
      this.openWaiters.forEach((w) => w());
      this.openWaiters = [];
      // Re-authorize after reconnect
      if (this.token) this.send({ authorize: this.token }).catch(() => {});
    };

    this.ws.onmessage = (ev) => {
      let msg: DerivMsg;
      try {
        msg = JSON.parse(ev.data) as DerivMsg;
      } catch {
        return;
      }
      this.opts.onMessage?.(msg);

      const reqId: number | undefined = msg.req_id;
      const subId: string | undefined = msg.subscription?.id;

      // Bind sub id to req_id listener
      if (reqId && subId && this.reqSubs.has(reqId) && !this.subs.has(subId)) {
        this.subs.set(subId, this.reqSubs.get(reqId)!);
      }

      // Dispatch to subscription listeners
      if (subId && this.subs.has(subId)) {
        try {
          this.subs.get(subId)!(msg);
        } catch (e) {
          console.error("sub listener err", e);
        }
      }

      // Resolve one-shot requests (skip resolution for streaming subs unless error)
      if (reqId && this.pending.has(reqId)) {
        const p = this.pending.get(reqId)!;
        if (msg.error) {
          this.pending.delete(reqId);
          p.reject(msg.error);
        } else if (!subId || !this.reqSubs.has(reqId)) {
          // Non-streaming response
          this.pending.delete(reqId);
          p.resolve(msg);
        } else {
          // First streaming response → resolve once with initial payload
          this.pending.delete(reqId);
          p.resolve(msg);
        }
      }
    };

    this.ws.onerror = () => {
      this.opts.onStatus?.("error");
    };

    this.ws.onclose = () => {
      this.opts.onStatus?.("closed");
      // Reject all pending
      this.pending.forEach((p) => p.reject(new Error("connection closed")));
      this.pending.clear();
      if (this.shouldReconnect) {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
      }
    };
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  private waitOpen(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((res) => this.openWaiters.push(res));
  }

  async send(payload: Record<string, unknown>, onSubMessage?: Listener): Promise<DerivMsg> {
    await this.waitOpen();
    const req_id = this.reqId++;
    const full = { ...payload, req_id };
    if (onSubMessage) this.reqSubs.set(req_id, onSubMessage);
    return new Promise((resolve, reject) => {
      this.pending.set(req_id, { resolve, reject });
      try {
        this.ws!.send(JSON.stringify(full));
      } catch (e) {
        this.pending.delete(req_id);
        reject(e);
      }
    });
  }

  /** Send without waiting for response — used to fire 5 buys in parallel via Promise.all but uses send. */
  async authorize(token: string) {
    this.token = token;
    return this.send({ authorize: token });
  }

  async balance() {
    return this.send({ balance: 1 });
  }

  async ticks(symbol: string, onTick: Listener) {
    return this.send({ ticks: symbol, subscribe: 1 }, onTick);
  }

  async forgetAll(type: "ticks" | "proposal_open_contract" | "balance") {
    return this.send({ forget_all: type });
  }

  /** Buy a Digit Differs contract — wins if last digit ≠ barrier. */
  async buyDigitDiff(opts: {
    symbol: string;
    barrier: number; // the digit price must DIFFER from
    stake: number;
    duration?: number;
    currency?: string;
  }) {
    const parameters = {
      amount: opts.stake,
      basis: "stake",
      contract_type: "DIGITDIFF",
      currency: opts.currency ?? "USD",
      duration: opts.duration ?? 1,
      duration_unit: "t",
      symbol: opts.symbol,
      barrier: String(opts.barrier),
    };
    return this.send({
      buy: 1,
      price: opts.stake,
      parameters,
    });
  }

  /** Subscribe to a contract's status updates. */
  async openContractStream(contractId: number, onUpdate: Listener) {
    return this.send(
      { proposal_open_contract: 1, contract_id: contractId, subscribe: 1 },
      onUpdate,
    );
  }

  /** Fetch candles history. granularity in seconds (900 = 15m, 3600 = 1h). */
  async candles(symbol: string, granularity: number, count = 60) {
    return this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: "latest",
      granularity,
      style: "candles",
    });
  }
}
