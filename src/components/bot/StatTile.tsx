import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "positive" | "negative" | "primary";
  className?: string;
}

const toneClass: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "text-foreground",
  positive: "text-success",
  negative: "text-destructive",
  primary: "text-primary",
};

export function StatTile({ label, value, hint, tone = "neutral", className }: Props) {
  return (
    <div className={cn("glass rounded-xl p-5 flex flex-col gap-1", className)}>
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span
        className={cn("font-display text-3xl font-semibold tabular leading-tight", toneClass[tone])}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
