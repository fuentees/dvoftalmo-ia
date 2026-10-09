"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportChartSvg } from "@/lib/chart-export";
import type { TracomaOverview } from "@/services/sinan-tracoma";
import { CHART } from "@/lib/chart-palette";

const FORM_COLORS: Record<string, string> = {
  TF: "#C4620F",
  TI: "#B42318",
  TS: "#6B4FA3",
  TT: "#1E4FD8",
  CO: "#52625D",
};

function num(v: unknown) {
  return v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR");
}

function pct(v: number | null | undefined, d = 1) {
  if (v == null) return "—";
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: d })}%`;
}

function KpiCard({ label, value, detail, tone = "default" }: {
  label: string;
  value: string | number | null;
  detail?: string;
  tone?: "default" | "green" | "amber" | "blue";
}) {
  const cls = {
    default: "",
    green: "border-green-200 bg-green-50",
    amber: "border-amber-200 bg-amber-50",
    blue: "border-blue-200 bg-blue-50",
  }[tone];
  return (
    <Card className={cls}>
      <CardContent className="pt-4 pb-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {typeof value === "number" || value == null ? num(value) : value}
        </div>
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}

type Props = {
  filters?: {
    gve?: string;
    municipio?: string;
    yearStart?: string;
    yearEnd?: string;
  };
};

export function TracomaChartsView({ filters }: Props) {
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.gve) p.set("gve", filters.gve);
    if (filters?.municipio) p.set("municipio", filters.municipio);
    if (filters?.yearStart) p.set("yearStart", filters.yearStart);
    if (filters?.yearEnd) p.set("yearEnd", filters.yearEnd);
    return p.toString();
  }, [filters]);

  const { data, isLoading, isError, error } = useQuery<TracomaOverview>({
    queryKey: ["tracoma-overview", qs],
    queryFn: async () => {
      const res = await fetch(`/api/sinan-tracoma/overview${qs ? `?${qs}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar overview");
      return json as TracomaOverview;
    },
    staleTime: 5 * 60 * 1000,
  });

  const refNtc = useRef<HTMLDivElement>(null);
  const refFormas = useRef<HTMLDivElement>(null);
  const [excludedYears, setExcludedYears] = useState<Set<string>>(new Set());
  const [hiddenForms, setHiddenForms] = useState<Set<string>>(new Set());

  function toggleYear(year: string) {
    setExcludedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  function toggleForm(form: string) {
    setHiddenForms((prev) => {
      const next = new Set(prev);
      if (next.has(form)) next.delete(form);
      else next.add(form);
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Carregando série histórica...
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-sm text-destructive">Erro ao carregar dados</CardTitle>
          <CardDescription>{(error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!data || data.byYear.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum dado encontrado para os filtros selecionados.
        </CardContent>
      </Card>
    );
  }

  // ── Transform data para gráficos ──────────────────────────────────────────

  // Série histórica principal (já vem ordenada por ano)
  const mainSeries = data.byYear.map((r) => ({
    ano: String(r.ano),
    "TRACONET (casos)": r.traconet,
    "NOTTRACONET (positivos)": r.positivos,
    "Examinados": r.examinados,
    "Positividade (%)": r.positividade != null ? Math.round(r.positividade * 10) / 10 : null,
  }));

  // Série de formas clínicas por ano
  const formSeries = data.byYear.map((r) => ({
    ano: String(r.ano),
    TF: r.tf,
    TI: r.ti,
    TS: r.ts,
    TT: r.tt,
    CO: r.co,
    total: r.tf + r.ti + r.ts + r.tt + r.co,
  })).filter((r) => r.total > 0);

  // Média de positividade para linha de referência
  const ntcSeries = mainSeries.filter((r) => !excludedYears.has(r.ano));
  const pairedSeries = ntcSeries.filter((row) => row["Positividade (%)"] != null);
  const totalNtcPos = pairedSeries.reduce((s, r) => s + (r["NOTTRACONET (positivos)"] ?? 0), 0);
  const totalNtcExa = pairedSeries.reduce((s, r) => s + (r["Examinados"] ?? 0), 0);
  const avgPos = pairedSeries.length === ntcSeries.length && totalNtcExa > 0 ? (totalNtcPos / totalNtcExa) * 100 : null;

  const fmtTick = (v: unknown) => Number(v).toLocaleString("pt-BR");
  const fmtPct = (v: unknown) => `${Number(v).toFixed(1)}%`;

  return (
    <div className="min-w-0 space-y-6">
      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Anos com dados"
          value={data.anosComDados.length > 0 ? `${data.anosComDados[0]}–${data.anosComDados[data.anosComDados.length - 1]}` : "—"}
          detail={`${data.anosComDados.length} ano(s)`}
        />
        <KpiCard
          label="Casos TRACONET"
          value={data.totalTraconet}
          detail="Registros individuais"
          tone="blue"
        />
        <KpiCard
          label="Positivos NOTTRACONET"
          value={data.totalPositivos}
          detail="Casos consolidados"
          tone="amber"
        />
        <KpiCard
          label="Examinados NOTTRACONET"
          value={data.totalExaminados}
          detail="Total do período"
          tone="green"
        />
        <KpiCard
          label="Positividade geral"
          value={pct(data.positividade)}
          detail="Positivos / Examinados"
        />
      </div>

      {/* ── Chart 2: Examinados + Positivos + Positividade ───────────────── */}
      {data.byYear.some((row) => row.examinados != null) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Examinados, positivos e positividade — NOTTRACONET</CardTitle>
                <CardDescription className="text-xs">
                  Clique em um ano para ocultá-lo da análise. Linha vermelha = positividade (%) no eixo direito.
                  {avgPos != null && ` Média do período visível: ${pct(avgPos)}.`}
                </CardDescription>
              </div>
              <button onClick={() => exportChartSvg(refNtc.current, "tracoma-nottraconet")} className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted">
                <Download className="h-3 w-3" /> PNG
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={refNtc} className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={ntcSeries}
                  onClick={(d) => { if (d?.activeLabel) toggleYear(String(d.activeLabel)); }}
                  style={{ cursor: "pointer" }}
                  margin={{ top: 4, right: 52, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={60} tickFormatter={fmtTick} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={44} tickFormatter={fmtPct} domain={[0, "auto"]} />
                  <Tooltip
                    formatter={(v, name) =>
                      name === "Positividade (%)" ? `${Number(v).toFixed(1)}%` : num(v)
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="Examinados" fill={CHART.primarySoft} radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="left" dataKey="NOTTRACONET (positivos)" fill={CHART.accent} radius={[3, 3, 0, 0]} />
                  {avgPos != null && (
                    <ReferenceLine yAxisId="right" y={avgPos} stroke={CHART.alert} strokeDasharray="4 4" label={{ value: `Média ${pct(avgPos)}`, position: "insideTopRight", fontSize: 10, fill: "#dc2626" }} />
                  )}
                  <Line yAxisId="right" type="monotone" dataKey="Positividade (%)" stroke={CHART.alert} strokeWidth={2} dot={ntcSeries.length <= 15} connectNulls={false} />
                </ComposedChart>
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
      )}

      {/* ── Chart 3: Formas clínicas por ano ─────────────────────────────── */}
      {formSeries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Distribuição por forma clínica por ano</CardTitle>
                <CardDescription className="text-xs">
                  TF = Folicular · TI = Inflamatório · TS = Cicatricial · TT = Triquíase · CO = Opacidade corneal.
                  Somente TRACONET. Um registro pode ter várias formas; a soma das barras não representa pessoas únicas.
                </CardDescription>
              </div>
              <button onClick={() => exportChartSvg(refFormas.current, "tracoma-formas-clinicas")} className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted">
                <Download className="h-3 w-3" /> PNG
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={refFormas} className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={formSeries} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ano" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={fmtTick} />
                  <Tooltip formatter={(v) => num(v)} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                    onClick={(d) => toggleForm(String(d.dataKey))}
                    formatter={(value) => (
                      <span style={{ opacity: hiddenForms.has(value) ? 0.35 : 1, textDecoration: hiddenForms.has(value) ? "line-through" : "none" }}>
                        {value}
                      </span>
                    )}
                  />
                  <Bar dataKey="TF" stackId="a" fill={FORM_COLORS.TF} hide={hiddenForms.has("TF")} />
                  <Bar dataKey="TI" stackId="a" fill={FORM_COLORS.TI} hide={hiddenForms.has("TI")} />
                  <Bar dataKey="TS" stackId="a" fill={FORM_COLORS.TS} hide={hiddenForms.has("TS")} />
                  <Bar dataKey="TT" stackId="a" fill={FORM_COLORS.TT} hide={hiddenForms.has("TT")} />
                  <Bar dataKey="CO" stackId="a" fill={FORM_COLORS.CO} radius={[3, 3, 0, 0]} hide={hiddenForms.has("CO")} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Legenda dos bancos ────────────────────────────────────────────── */}
      {data.warnings?.length > 0 && <details className="rounded-md border p-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Limitações da série histórica</summary><ul className="mt-2 space-y-1">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge className="gap-1.5 bg-muted font-normal text-muted-foreground hover:bg-muted">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#7CC4B7]" />
          TRACONET — registros individuais (1 linha = 1 caso)
        </Badge>
        <Badge className="gap-1.5 bg-muted font-normal text-muted-foreground hover:bg-muted">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#C4620F]" />
          NOTTRACONET — consolidado (NU_CASOPOS = positivos; NU_CASOEXA = examinados)
        </Badge>
      </div>
    </div>
  );
}
