import type { TradeRecord } from "@/lib/deriv/types";
import { cn } from "@/lib/utils";

interface Props {
  trades: TradeRecord[];
}

const statusStyle: Record<TradeRecord["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  open: "bg-primary/20 text-primary border border-primary/40 animate-pulse",
  won: "bg-success/15 text-success border border-success/40",
  lost: "bg-destructive/15 text-destructive border border-destructive/40",
  error: "bg-warning/15 text-warning border border-warning/40",
};

export function TradeGrid({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="glass rounded-xl p-10 text-center text-muted-foreground">
        No trades yet. Hit <span className="text-foreground font-medium">Start</span> to begin.
      </div>
    );
  }

  const byCycle = new Map<number, TradeRecord[]>();
  trades.forEach((t) => {
    if (!byCycle.has(t.cycle)) byCycle.set(t.cycle, []);
    byCycle.get(t.cycle)!.push(t);
  });
  const cycles = Array.from(byCycle.entries()).sort((a, b) => b[0] - a[0]);

  return (
    <div className="flex flex-col gap-4 max-h-[520px] overflow-y-auto pr-1">
      {cycles.map(([cycle, items]) => {
        const head = items[0];
        const cyclePnl = items.reduce((s, t) => s + (t.profit ?? 0), 0);
        const allClosed = items.every(
          (t) => t.status === "won" || t.status === "lost" || t.status === "error",
        );
        return (
          <div key={cycle} className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-display font-semibold">Cycle #{cycle}</span>
                <span className="text-xs px-2 py-0.5 rounded-full border border-primary/50 text-primary bg-primary/10">
                  {head?.direction} · {head?.symbol}
                </span>
                <span className="text-xs text-muted-foreground">
                  stake ${head?.stake} · {head?.duration}
                  {head?.durationUnit}
                </span>
              </div>
              {allClosed && (
                <span
                  className={cn(
                    "tabular text-sm font-medium",
                    cyclePnl >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {cyclePnl >= 0 ? "+" : ""}${cyclePnl.toFixed(2)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {items.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-lg px-2 py-3 text-center text-xs font-mono",
                    statusStyle[t.status],
                  )}
                  title={t.error || `${t.status} • ${t.profit ?? "-"}`}
                >
                  <div className="uppercase tracking-wide opacity-70 text-[10px]">{t.status}</div>
                  <div className="tabular mt-1 text-sm">{t.direction === "RISE" ? "↑" : "↓"}</div>
                  <div className="tabular text-[11px] mt-0.5">
                    {t.profit != null ? (t.profit >= 0 ? "+" : "") + t.profit.toFixed(2) : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
