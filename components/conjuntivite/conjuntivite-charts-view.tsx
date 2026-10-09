"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportChartSvg } from "@/lib/chart-export";
import type { CevespHistorico } from "@/lib/external/supabase-cevesp";
import { CHART } from "@/lib/chart-palette";

function num(v: unknown) { return Number(v ?? 0).toLocaleString("pt-BR"); }

type Props = {
  filters?: { gve?: string; municipio?: string; yearStart?: string; yearEnd?: string };
};

export function ConjuntiviteChartsView({ filters }: Props) {
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.gve) p.set("gve", filters.gve);
    if (filters?.municipio) p.set("municipio", filters.municipio);
    if (filters?.yearStart) p.set("yearStart", filters.yearStart);
    if (filters?.yearEnd) p.set("yearEnd", filters.yearEnd);
    return p.toString();
  }, [filters]);

  const { data, isLoading, isError, error } = useQuery<CevespHistorico>({
    queryKey: ["cevesp-historico", qs],
    queryFn: async () => {
      const res = await fetch(`/api/cevesp/historico${qs ? `?${qs}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar histórico CEVESP");
      return json as CevespHistorico;
    },
    staleTime: 5 * 60 * 1000,
  });

  const refAnual = useRef<HTMLDivElement>(null);
  const [excludedYears, setExcludedYears] = useState<Set<string>>(new Set());
  useEffect(() => { setExcludedYears(new Set()); }, [qs]);
  const [metricAnual, setMetricAnual] = useState<"casos" | "municipios">("casos");

  function toggleYear(year: string) {
    setExcludedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Carregando série histórica CEVESP...
    </div>
  );

  if (isError) return (
    <Card className="border-destructive m-6">
      <CardHeader>
        <CardTitle className="text-sm text-destructive">Erro ao carregar dados</CardTitle>
        <CardDescription>{(error as Error).message}</CardDescription>
      </CardHeader>
    </Card>
  );

  if (!data || data.byYear.length === 0) return (
    <Card className="m-6">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Nenhum dado no cache CEVESP para os filtros selecionados. Use Sincronização para importar.
      </CardContent>
    </Card>
  );

  // ── Série anual ───────────────────────────────────────────────────────────
  const hasMunicipios = data.byYear.some((r) => r.municipiosNotificadores > 0);
  const anualData = data.byYear.map((r) => ({
    ano: String(r.ano),
    Casos: r.casos,
    "Municípios notificantes": r.municipiosNotificadores,
    "Incidência/100k": r.incidencia100k,
    populationYear: r.populationYear,
    populationFallback: r.populationFallback,
  }));
  const filteredAnual = anualData.filter((r) => !excludedYears.has(r.ano));
  const hasIncidencia = data.byYear.some((r) => r.incidencia100k != null);
  const activeKey = metricAnual === "municipios" ? "Municípios notificantes" : "Casos";
  const activeColor = metricAnual === "municipios" ? CHART.accent : CHART.primary;
  const fmt = (v: unknown) => num(v);

  return (
    <div className="space-y-6 p-6">
      {/* ── Chart 1: Casos / municípios por ano ─────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Série histórica anual — Conjuntivites CEVESP</CardTitle>
              <CardDescription className="text-xs">
                Clique em um ano para ocultá-lo da análise. Linha vermelha = coef. de incidência/100 mil hab.
                (eixo direito). Taxas usam a população IBGE do território; anos substitutos aparecem no tooltip.
              </CardDescription>
              {/* eixo único só quando a página já está filtrada por um município específico */}
            </div>
            <div className="flex items-center gap-2">
              {hasMunicipios && (
                <div className="flex rounded border text-xs overflow-hidden">
                  <button
                    onClick={() => setMetricAnual("casos")}
                    className={`px-2 py-1 transition-colors ${metricAnual === "casos" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    Casos
                  </button>
                  <button
                    onClick={() => setMetricAnual("municipios")}
                    className={`px-2 py-1 transition-colors ${metricAnual === "municipios" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    Municípios
                  </button>
                </div>
              )}
              <button onClick={() => exportChartSvg(refAnual.current, "cevesp-anual")} className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted">
                <Download className="h-3 w-3" /> PNG
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredAnual.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Todos os anos estão ocultos. Restaure um ano abaixo para visualizar a série.</p>}
          <div ref={refAnual} className={hasIncidencia ? "h-[28rem]" : "h-96"}>
            <ResponsiveContainer width="100%" height="100%">
              {hasIncidencia ? (
                <ComposedChart
                  key="chart-dual-axis"
                  data={filteredAnual}
                  onClick={(d) => { if (d?.activeLabel) toggleYear(String(d.activeLabel)); }}
                  style={{ cursor: "pointer" }}
                  margin={{ top: 4, right: 48, left: 4, bottom: 4 }}
                >
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={60} tickFormatter={fmt} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={44} tickFormatter={(v) => `${Number(v).toFixed(1)}`} domain={[0, "auto"]} />
                  <Tooltip formatter={(v, name) => name === "Incidência/100k" ? `${Number(v).toFixed(1)} /100k` : fmt(v)} labelFormatter={(label, payload) => { const row = payload[0]?.payload; return `Ano ${label}${row?.populationYear ? ` · População IBGE ${row.populationYear}${row.populationFallback ? " (substituta)" : ""}` : " · população indisponível"}`; }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey={activeKey} fill={activeColor} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="Incidência/100k" stroke={CHART.alert} strokeWidth={2} dot={filteredAnual.length <= 15} />
                </ComposedChart>
              ) : (
                <BarChart
                  data={filteredAnual}
                  onClick={(d) => { if (d?.activeLabel) toggleYear(String(d.activeLabel)); }}
                  style={{ cursor: "pointer" }}
                  margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                >
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={fmt} />
                  <Tooltip formatter={fmt} />
                  <Bar dataKey={activeKey} fill={activeColor} radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          {excludedYears.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Anos ocultos:</span>
              {[...excludedYears].sort().map((year) => (
                <button
                  key={year}
                  onClick={() => toggleYear(year)}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs hover:bg-primary/10"
                >
                  {year} <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
