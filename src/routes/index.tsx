import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Architeq SmartTrader — Rise/Fall bot for Volatility 75/100" },
      {
        name: "description",
        content:
          "Automated Rise/Fall trading on Deriv's Volatility 75 and 100 indices. Strict EMA/RSI signal with batch entry. Built by Architeq Web Agency.",
      },
      { property: "og:title", content: "Architeq SmartTrader — Deriv Rise/Fall Bot" },
      {
        property: "og:description",
        content:
          "Strict EMA trend + RSI confirmation. Fires Rise/Fall batches on Volatility 75 or 100.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [loading, user, navigate]);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" />
      <header className="relative z-10 max-w-[1200px] mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center font-display font-bold text-primary">
            Æ
          </div>
          <span className="font-display font-semibold tracking-tight">
            Architeq <span className="text-muted-foreground font-normal">Differs</span>
          </span>
        </div>
        <div className="flex gap-2">
          <Link to="/auth">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/auth">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="relative z-10 max-w-[1200px] mx-auto px-6 pt-16 pb-24">
        <div className="max-w-3xl">
          <span className="inline-block text-[11px] uppercase tracking-[0.25em] text-primary border border-primary/40 bg-primary/10 px-3 py-1 rounded-full mb-6">
            Volatility 75/100 · Rise/Fall · Strict signals
          </span>
          <h1 className="font-display text-5xl md:text-7xl font-semibold leading-[1.02] tracking-tight">
            When the signal confirms, <span className="text-primary">strike.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
            A strict Rise/Fall engine for Deriv's synthetic indices. Choose Volatility 75 or 100,
            then enter a batch when EMA trend and RSI momentum align.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/auth">
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                Launch Dashboard →
              </Button>
            </Link>
            <a href="https://architeq.co.za" target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline">
                Visit Architeq
              </Button>
            </a>
          </div>

          {/* Live signal demo strip */}
          <div className="mt-12 glass rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
              Example signal · EMA(9)&gt;EMA(21) and RSI(14)&gt;=55
            </div>
            <div className="flex flex-wrap gap-2 font-mono text-xs items-center">
              <div className="h-9 px-3 rounded-md flex items-center justify-center border border-border/40 text-muted-foreground">
                Trend: EMA fast above slow
              </div>
              <div className="h-9 px-3 rounded-md flex items-center justify-center border border-border/40 text-muted-foreground">
                Momentum: RSI confirm zone
              </div>
              <div className="h-9 px-3 rounded-md flex items-center justify-center text-xs border border-success/50 bg-success/15 text-success ml-1">
                FIRE 5× RISE
              </div>
            </div>
          </div>
        </div>

        <div className="mt-20 grid md:grid-cols-3 gap-5">
          {[
            {
              t: "Volatility 75 or 100",
              d: "Choose your market and keep the signal rules consistent.",
            },
            {
              t: "Strict signal rules",
              d: "EMA trend + RSI momentum confirmation. No guesswork entries.",
            },
            {
              t: "Candle-based analysis",
              d: "Uses 1-minute candles for consistent indicator calculations.",
            },
            {
              t: "Configurable duration",
              d: "Run 1–60 minute contracts so entries and exits align with the analysis.",
            },
            {
              t: "Simultaneous batch",
              d: "Enter multiple Rise/Fall contracts on the same signal (batch entry).",
            },
            {
              t: "Profit-tier stakes",
              d: "$1 → $100 ladder driven strictly by realised session profit. No martingale.",
            },
          ].map((f) => (
            <div key={f.t} className="glass rounded-2xl p-6">
              <div className="font-display text-lg font-semibold">{f.t}</div>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 glass rounded-2xl p-8 md:p-10">
          <h2 className="font-display text-3xl font-semibold mb-6">How it works</h2>
          <ol className="grid md:grid-cols-4 gap-5 text-sm">
            {[
              {
                n: "01",
                t: "Connect",
                d: "Paste your Deriv API token (stored only in your browser).",
              },
              {
                n: "02",
                t: "Configure",
                d: "Choose market, duration, batch size, and signal thresholds.",
              },
              { n: "03", t: "Watch", d: "The bot streams ticks and monitors the candle signal." },
              {
                n: "04",
                t: "Strike",
                d: "On signal, fires N parallel Rise/Fall contracts and settles the cycle.",
              },
            ].map((s) => (
              <li key={s.n} className="border-l-2 border-primary/40 pl-4">
                <div className="font-mono text-xs text-primary">{s.n}</div>
                <div className="font-display font-semibold mt-1">{s.t}</div>
                <p className="text-muted-foreground mt-1 leading-relaxed">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-16 text-center">
          <Link to="/auth">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              Start trading →
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-4">Test on a Deriv demo account first.</p>
        </div>
      </main>

      <footer className="relative z-10 border-t border-border/40">
        <div className="max-w-[1200px] mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <div>
            Built by{" "}
            <a
              href="https://architeq.co.za"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-medium"
            >
              Architeq Web Agency
            </a>
          </div>
          <div className="text-xs">Trading involves risk. Use a demo account first.</div>
        </div>
      </footer>
    </div>
  );
}
