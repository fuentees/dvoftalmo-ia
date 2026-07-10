"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { EndemicChannelPoint } from "@/services/cevesp-endemic";
import { pickCurrentChannelPoint } from "@/lib/epi-week";

type Props = { gve?: string; municipio?: string };

export function EpidemicZoneBanner({ gve, municipio }: Props) {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<EndemicChannelPoint[]>({
    queryKey: ["canal-endemico-banner", gve, municipio],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (gve)      p.set("gve", gve);
      if (municipio) p.set("municipality", municipio);
      const qs = p.toString();
      const res = await fetch(`/api/cevesp/canal-endemico${qs ? `?${qs}` : ""}`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  if (dismissed || !data?.length) return null;

  const pt = pickCurrentChannelPoint(data);
  if (!pt || pt.currentYear === null) return null;
  const lastSE = pt.se;

  const cur         = pt.currentYear;
  const isEpidemia  = cur > pt.q3;
  const isAlerta    = !isEpidemia && cur > pt.q1;
  if (!isEpidemia && !isAlerta) return null;

  const bg  = isEpidemia ? "bg-red-50 border-red-200"   : "bg-amber-50 border-amber-200";
  const txt = isEpidemia ? "text-red-800"                : "text-amber-800";
  const ico = isEpidemia ? "text-red-500"                : "text-amber-500";
  const zona = isEpidemia ? "epidêmica" : "de alerta";
  const threshold = isEpidemia
    ? `acima do Q3 histórico (${pt.q3.toLocaleString("pt-BR")} casos)`
    : `entre Q1=${pt.q1.toLocaleString("pt-BR")} e Q3=${pt.q3.toLocaleString("pt-BR")}`;

  return (
    <div className={`flex items-start gap-3 border-b px-6 py-3 text-sm ${bg} ${txt}`}>
      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${ico}`} />
      <span className="flex-1 leading-snug">
        <strong>SE {lastSE} — zona {zona}:</strong>{" "}
        {cur.toLocaleString("pt-BR")} casos registrados, {threshold}.{" "}
        <a href="?tab=situacao" className="underline underline-offset-2 hover:opacity-80">
          Ver canal endêmico →
        </a>
      </span>
      <button
        aria-label="Fechar alerta"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 hover:bg-black/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
