"use client";

import { currentEpiWeek } from "@/lib/epi-week";
import { cn } from "@/lib/utils";

/** Selo compacto com a semana epidemiológica atual, fixo em qualquer página do app. */
export function EpiWeekBadge({ className }: { className?: string }) {
  const { se, year } = currentEpiWeek();
  return (
    <span
      title={`Semana epidemiológica atual: SE ${se} de ${year}`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary",
        className
      )}
    >
      SE {se}/{year}
    </span>
  );
}
