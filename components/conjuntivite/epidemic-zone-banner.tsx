"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EndemicChannelPoint } from "@/services/cevesp-endemic";
import { classifyChannelPoint } from "@/lib/cevesp-channel";
import { currentCalendarYear, pickCurrentChannelPoint, pickCurrentPoint } from "@/lib/epi-week";
import { currentQueryData, fetchJson } from "@/lib/query-result";

type Props = { gve?: string; municipio?: string; year?: number };

export function EpidemicZoneBanner({ gve, municipio, year }: Props) {
  const scope = `${gve ?? ""}|${municipio ?? ""}|${year ?? ""}`;
  const [dismissedScope, setDismissedScope] = useState<string | null>(null);

  const channelQuery = useQuery<EndemicChannelPoint[]>({
    queryKey: ["canal-endemico-banner", gve, municipio, year],
    queryFn: async ({ signal }) => {
      const p = new URLSearchParams();
      if (year) p.set("year", String(year));
      if (gve)      p.set("gve", gve);
      if (municipio) p.set("municipality", municipio);
      const qs = p.toString();
      const points = await fetchJson<EndemicChannelPoint[]>(
        `/api/cevesp/canal-endemico${qs ? `?${qs}` : ""}`,
        "Não foi possível verificar a faixa histórica.",
        { signal },
      );
      if (!Array.isArray(points)) throw new Error("A resposta do canal histórico está incompleta.");
      return points;
    },
    staleTime: 10 * 60 * 1000,
  });

  if (channelQuery.isPending) return (
    <div role="status" className="flex items-center gap-2 border-b bg-muted/40 px-6 py-3 text-xs text-muted-foreground">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      Verificando a faixa histórica deste recorte...
    </div>
  );

  if (channelQuery.isError) return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 leading-snug">
        <strong>Avaliação da faixa histórica indisponível.</strong>{" "}
        Não foi possível verificar o sinal epidemiológico deste recorte.
      </span>
      <Button size="sm" variant="outline" disabled={channelQuery.isFetching} onClick={() => void channelQuery.refetch()}>
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${channelQuery.isFetching ? "animate-spin" : ""}`} />
        {channelQuery.isFetching ? "Verificando..." : "Tentar novamente"}
      </Button>
    </div>
  );

  const data = currentQueryData(channelQuery);
  if (dismissedScope === scope || !data?.length) return null;

  const pt = year && year < currentCalendarYear() ? pickCurrentPoint(data, 53) : pickCurrentChannelPoint(data);
  if (!pt || pt.currentYear === null) return null;
  const lastSE = pt.se;

  const cur         = pt.currentYear;
  const incidence   = pt.currentIncidence;
  if (incidence === null) return null;
  if (classifyChannelPoint(pt) !== "acima") return null;
  const bg = "bg-amber-50 border-amber-200", txt = "text-amber-800", ico = "text-amber-500";
  const threshold = `acima da faixa histórica (${pt.q3.toLocaleString("pt-BR")} por 100 mil hab.). O sinal requer avaliação epidemiológica`;

  return (
    <div className={`flex items-start gap-3 border-b px-6 py-3 text-sm ${bg} ${txt}`}>
      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${ico}`} />
      <span className="flex-1 leading-snug">
        <strong>SE {lastSE}/{year ?? currentCalendarYear()} — acima da faixa histórica:</strong>{" "}
        {cur.toLocaleString("pt-BR")} casos registrados; incidência de {incidence.toLocaleString("pt-BR")} por 100 mil hab., {threshold}.{" "}

      </span>
      <button
        aria-label="Fechar alerta"
        onClick={() => setDismissedScope(scope)}
        className="shrink-0 rounded p-0.5 hover:bg-black/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
