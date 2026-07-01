"use client";

import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportChartSvg } from "@/lib/chart-export";
import type { CevespHistorico } from "@/lib/external/supabase-cevesp";

const PALETTE = [
  "#2563eb","#16a34a","#dc2626","#d97706","#7c3aed",
  "#0891b2","#be185d","#059669","#ea580c","#4f46e5",
  "#b45309","#0f766e",
];

const MONTH_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function num(v: unknown) { return Number(v ?? 0).toLocaleString("pt-BR"); }

function KpiCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {typeof value === "number" ? num(value) : value}
        </div>
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}

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
  const refMensal = useRef<HTMLDivElement>(null);
  const refGve = useRef<HTMLDivElement>(null);

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
  const anualData = data.byYear.map((r) => ({
    ano: String(r.ano),
    Casos: r.casos,
    "Incidência/100k": r.incidencia100k,
  }));
  const hasIncidencia = data.byYear.some((r) => r.incidencia100k != null);

  // ── Série mensal por ano (pivot mes × anos) ───────────────────────────────
  const years = data.anosComDados;
  const mensalData = MONTH_LABELS.map((label, idx) => {
    const mes = idx + 1;
    const point: Record<string, unknown> = { mes: label };
    for (const ano of years) {
      const found = data.byYearMonth.find((r) => r.ano === ano && r.mes === mes);
      point[String(ano)] = found?.casos ?? 0;
    }
    return point;
  });
  // Só mostra se tiver dados mensais
  const hasMensal = data.byYearMonth.length > 0;

  // ── Top GVEs série histórica ──────────────────────────────────────────────
  const gveNames = Array.from(new Set(data.byGveYear.map((r) => r.gve)));
  const gveAnoMap = new Map<number, Record<string, number>>();
  for (const r of data.byGveYear) {
    if (!gveAnoMap.has(r.ano)) gveAnoMap.set(r.ano, {});
    gveAnoMap.get(r.ano)![r.gve] = r.casos;
  }
  const gveSeries = Array.from(gveAnoMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([ano, vals]) => ({ ano: String(ano), ...vals }));

  const fmt = (v: unknown) => num(v);
  const primYear = years[years.length - 1];
  const secYear = years[years.length - 2];

  return (
    <div className="space-y-6 p-6">
      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Período"
          value={years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : "—"}
          detail={`${years.length} ano(s) no cache`}
        />
        <KpiCard label="Total de casos" value={data.totalCasos} detail="Soma do campo TotalCaso no cache" />
        <KpiCard
          label={`Casos ${primYear ?? "último ano"}`}
          value={data.byYear.find((r) => r.ano === primYear)?.casos ?? 0}
          detail={secYear ? `vs ${secYear}: ${num(data.byYear.find((r) => r.ano === secYear)?.casos ?? 0)}` : undefined}
        />
        <KpiCard label="GVEs com registro" value={gveNames.length} detail="No período selecionado" />
      </div>

      {/* ── Chart 1: Casos por ano ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Série histórica anual — Conjuntivites CEVESP</CardTitle>
              <CardDescription className="text-xs">Total de casos por ano de notificação (cache Supabase).</CardDescription>
            </div>
            <button onClick={() => exportChartSvg(refAnual.current, "cevesp-anual")} className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted">
              <Download className="h-3 w-3" /> PNG
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div ref={refAnual} className={hasIncidencia ? "h-72" : "h-64"}>
            <ResponsiveContainer width="100%" height="100%">
              {hasIncidencia ? (
                <ComposedChart data={anualData} margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={60} tickFormatter={fmt} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={44} tickFormatter={(v) => `${Number(v).toFixed(1)}`} domain={[0, "auto"]} />
                  <Tooltip formatter={(v, name) => name === "Incidência/100k" ? `${Number(v).toFixed(1)} /100k` : fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="Casos" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="Incidência/100k" stroke="#dc2626" strokeWidth={2} dot={anualData.length <= 15} connectNulls />
                </ComposedChart>
              ) : (
                <BarChart data={anualData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={fmt} />
                  <Tooltip formatter={fmt} />
                  <Bar dataKey="Casos" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* ── Chart 2: Série mensal comparativa ────────────────────────────── */}
      {hasMensal && years.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Perfil mensal por ano</CardTitle>
                <CardDescription className="text-xs">Distribuição de casos por mês — cada linha representa um ano. Útil para comparar sazonalidade.</CardDescription>
              </div>
              <button onClick={() => exportChartSvg(refMensal.current, "cevesp-mensal")} className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted">
                <Download className="h-3 w-3" /> PNG
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={refMensal} className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mensalData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={fmt} />
                  <Tooltip formatter={fmt} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {years.slice(-6).map((ano, i) => (
                    <Line
                      key={ano}
                      type="monotone"
                      dataKey={String(ano)}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Chart 3: Top GVEs série histórica ────────────────────────────── */}
      {gveSeries.length > 1 && gveNames.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Série histórica por GVE — Top {gveNames.length}</CardTitle>
                <CardDescription className="text-xs">Casos por GVE ao longo dos anos. Apenas as GVEs com maior volume total.</CardDescription>
              </div>
              <button onClick={() => exportChartSvg(refGve.current, "cevesp-gves")} className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted">
                <Download className="h-3 w-3" /> PNG
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={refGve} className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={gveSeries} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={fmt} />
                  <Tooltip formatter={fmt} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {gveNames.map((gve, i) => (
                    <Line key={gve} type="monotone" dataKey={gve} stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={2} dot={gveSeries.length <= 12} activeDot={{ r: 4 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
