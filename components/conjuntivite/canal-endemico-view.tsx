"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, ComposedChart, CartesianGrid, Legend, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Download, Info, RefreshCw, TrendingUp, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EndemicChannelPoint } from "@/services/cevesp-endemic";
import { currentEpiWeek, pickCurrentPoint } from "@/lib/epi-week";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

// ── Linear regression for trend projection ──────────────────────────────────
function linearRegression(pts: Array<{ x: number; y: number }>) {
  const n = pts.length;
  if (n < 3) return null;
  const sumX  = pts.reduce((s, p) => s + p.x, 0);
  const sumY  = pts.reduce((s, p) => s + p.y, 0);
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ── Zone badge ───────────────────────────────────────────────────────────────
function ZoneBadge({ zona }: { zona: string | null }) {
  if (!zona) return null;
  const cfg = {
    sucesso:  { label: "Zona de Sucesso",  Icon: CheckCircle2, cls: "bg-green-100 text-green-800 border-green-300" },
    esperado: { label: "Dentro do Esperado", Icon: Info,        cls: "bg-sky-100   text-sky-800   border-sky-300"   },
    epidemia: { label: "Zona Epidêmica",   Icon: XCircle,       cls: "bg-red-100   text-red-800    border-red-300"   },
  }[zona] ?? null;
  if (!cfg) return null;
  const { label, Icon, cls } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

// ── Custom tooltip ───────────────────────────────────────────────────────────
function CanalTooltip({ active, payload, label, mode }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; payload?: Record<string, unknown> }>; label?: string | number; mode?: "se" | "mes" }) {
  if (!active || !payload?.length) return null;
  const byName = Object.fromEntries(payload.map((p) => [p.name, p.value]));
  const row = payload[0]?.payload ?? {};
  const q1   = byName["_q1Base"]        ?? 0;
  const band = byName["Faixa esperada"] ?? 0;
  const q3   = q1 + band;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{mode === "mes" ? label : `SE ${label}`}</p>
      {byName["Incidência atual"] != null && <p className="font-medium text-blue-700">Incidência atual: {Number(byName["Incidência atual"]).toLocaleString("pt-BR")} / 100 mil</p>}
      {row["Casos atuais"] != null && <p className="text-blue-700">Casos atuais: {Number(row["Casos atuais"]).toLocaleString("pt-BR")}</p>}
      {byName["Projeção"] != null     && <p className="text-blue-400">Projeção: {Number(byName["Projeção"]).toLocaleString("pt-BR")} / 100 mil</p>}
      {byName["Ano anterior"] != null && <p className="text-violet-600">Ano anterior: {Number(byName["Ano anterior"]).toLocaleString("pt-BR")} / 100 mil</p>}
      {byName["Média"] != null        && <p className="text-gray-500">Média hist.: {Number(byName["Média"]).toLocaleString("pt-BR")}</p>}
      <p className="mt-1 border-t pt-1 text-muted-foreground">Limite inferior: {q1.toLocaleString("pt-BR")} · Limite superior: {q3.toLocaleString("pt-BR")} / 100 mil</p>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
type Props = {
  filters?: { gve?: string; municipio?: string };
};

export function CanalEndemicoView({ filters }: Props) {
  const thisYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const currentWeek = currentEpiWeek();

  // ── Ano de referência (qual ano é o "ano atual" da comparação) ──────────────
  const [refYear, setRefYear] = useState(thisYear);

  // ── Granularidade do eixo X do gráfico: semana epidemiológica ou mês ────────
  const [xAxisMode, setXAxisMode] = useState<"se" | "mes">("se");

  const anosQuery = useQuery<{ anos: number[] }>({
    queryKey: ["cevesp-anos"],
    queryFn: async () => {
      const res = await fetch("/api/cevesp/anos");
      return res.json() as Promise<{ anos: number[] }>;
    },
    staleTime: 10 * 60 * 1000,
  });
  const anoOptions = anosQuery.data?.anos?.length ? anosQuery.data.anos : [thisYear];

  const syncInfo = useQuery<{ latestNotificationDate: string | null; lastSync: string | null }>({
    queryKey: ["cevesp-sync-info"],
    queryFn: async () => {
      const res = await fetch("/api/admin/cevesp-status");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  // ── Busca de dados já no grain certo: SE tem estatística própria por semana,
  // Mês tem estatística própria por mês (não é mais soma das SEs do mês) ──────
  const grain = xAxisMode === "mes" ? "month" : "week";

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.gve)       p.set("gve", filters.gve);
    if (filters?.municipio) p.set("municipality", filters.municipio);
    p.set("year", String(refYear));
    if (grain === "month") p.set("grain", "month");
    return p.toString();
  }, [filters, refYear, grain]);

  // Export sempre usa o grain semanal (é o único formato que os endpoints de export entendem)
  const exportQs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.gve)       p.set("gve", filters.gve);
    if (filters?.municipio) p.set("municipality", filters.municipio);
    p.set("year", String(refYear));
    return p.toString();
  }, [filters, refYear]);

  const { data, isLoading, isError, error } = useQuery<EndemicChannelPoint[]>({
    queryKey: ["canal-endemico", qs],
    queryFn: async () => {
      const res = await fetch(`/api/cevesp/canal-endemico${qs ? `?${qs}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao calcular canal endêmico.");
      return json as EndemicChannelPoint[];
    },
    staleTime: 10 * 60 * 1000,
  });

  const prevYearQs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.gve)       p.set("gve", filters.gve);
    if (filters?.municipio) p.set("municipality", filters.municipio);
    p.set("year", String(refYear - 1));
    if (grain === "month") p.set("grain", "month");
    return p.toString();
  }, [filters, refYear, grain]);

  const { data: prevData } = useQuery<EndemicChannelPoint[]>({
    queryKey: ["canal-endemico-prev", prevYearQs],
    queryFn: async () => {
      const res = await fetch(`/api/cevesp/canal-endemico?${prevYearQs}`);
      const json = await res.json();
      if (!res.ok) return [];
      return json as EndemicChannelPoint[];
    },
    staleTime: 30 * 60 * 1000,
  });

  // ── Derive chart data + projection ─────────────────────────────────────────
  const { chartData, lastSE, lastLabel, currentZona, projStart } = useMemo(() => {
    if (!data) return { chartData: [], lastSE: null, lastLabel: null, currentZona: null, projStart: null };

    const bucketLabel = (bucket: number) => xAxisMode === "se" ? String(bucket) : MESES[bucket - 1].slice(0, 3);
    const currentBucket = refYear === thisYear
      ? (xAxisMode === "se" ? currentWeek.se : currentMonth)
      : (xAxisMode === "se" ? 53 : 12);

    const withData = data.filter((d) => d.currentIncidence !== null && d.se <= currentBucket);
    const currentPt = pickCurrentPoint(data, currentBucket);
    const lastSE    = currentPt?.se ?? null;
    const lastLabel = lastSE != null ? bucketLabel(lastSE) : null;
    const currentZona = currentPt?.currentIncidence != null
      ? currentPt.currentIncidence > currentPt.q3
        ? "epidemia"
        : currentPt.currentIncidence >= currentPt.q1
          ? "esperado"
          : "sucesso"
      : null;

    // Previous year lookup by bucket
    const prevMap = new Map((prevData ?? []).map((p) => [p.se, p.currentIncidence]));

    // Projeção linear a partir dos últimos pontos observados: 4 SEs (~1 mês) ou 2 meses
    const projectionSteps = xAxisMode === "se" ? 4 : 2;
    const recent = withData.slice(-6);
    const reg = linearRegression(recent.map((d) => ({ x: d.se, y: d.currentIncidence! })));
    const projStart = lastSE ?? null;

    const chartData = data.map((d) => {
      const alertBand = Math.max(0, d.q3 - d.q1);
      const projecao =
        reg && projStart && d.se > projStart && d.se <= projStart + projectionSteps
          ? Number(Math.max(0, reg.slope * d.se + reg.intercept).toFixed(2))
          : undefined;
      const anoAnterior = prevMap.has(d.se) ? prevMap.get(d.se) ?? undefined : undefined;
      return {
        se:                 d.se,
        label:              bucketLabel(d.se),
        "_q1Base":          d.q1,
        "Faixa esperada":   alertBand,
        "Média":            d.median,
        "Incidência atual": d.currentIncidence ?? undefined,
        "Casos atuais":     d.currentYear ?? undefined,
        "Ano anterior":     anoAnterior,
        "Projeção":         projecao,
      };
    });

    return { chartData, lastSE, lastLabel, currentZona, projStart };
  }, [currentMonth, currentWeek.se, data, prevData, refYear, thisYear, xAxisMode]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!data || !lastSE) return null;
    const seData = data.find((d) => d.se === lastSE);
    if (!seData) return null;
    const atual = seData.currentIncidence ?? 0;
    const casos = seData.currentYear ?? 0;
    const acima = data.filter((d) => d.currentIncidence !== null && d.currentIncidence > d.q3).length;
    return { atual, casos, q1: seData.q1, q3: seData.q3, median: seData.median, acima };
  }, [data, lastSE]);

  if (isLoading) return (
    <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Calculando canal endêmico...
    </div>
  );

  if (isError) return (
    <Card className="border-destructive">
      <CardContent className="py-8 text-center text-sm text-red-700">{(error as Error).message}</CardContent>
    </Card>
  );

  if (!data || data.length === 0) return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Sem dados suficientes para calcular o canal endêmico. Sincronize o CEVESP.
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* ── Ano de referência / eixo X ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Ano</span>
          <select
            value={refYear}
            onChange={(e) => setRefYear(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {(anoOptions.includes(refYear) ? anoOptions : [...anoOptions, refYear])
              .sort((a, b) => b - a)
              .map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Eixo X</span>
          <div className="flex gap-0.5 rounded-md bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setXAxisMode("se")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                xAxisMode === "se" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              SE
            </button>
            <button
              type="button"
              onClick={() => setXAxisMode("mes")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                xAxisMode === "mes" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Mês
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI row + export ────────────────────────────────────────────── */}
      {kpis && lastSE && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm shadow-sm">
            <span className="text-muted-foreground">{xAxisMode === "se" ? `SE ${lastLabel}` : lastLabel} — incidência:</span>
            <span className="font-semibold">{kpis.atual.toLocaleString("pt-BR")} / 100 mil</span>
            <span className="text-xs text-muted-foreground">({kpis.casos.toLocaleString("pt-BR")} casos)</span>
            <ZoneBadge zona={currentZona} />
          </div>
          <div className="rounded-lg border bg-card px-4 py-2 text-xs text-muted-foreground shadow-sm">
            Limite inferior: <strong>{kpis.q1.toLocaleString("pt-BR")}</strong> · média: <strong>{kpis.median.toLocaleString("pt-BR")}</strong> · Limite superior: <strong>{kpis.q3.toLocaleString("pt-BR")}</strong> por 100 mil hab.
          </div>
          {kpis.acima > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 shadow-sm">
              <AlertTriangle className="h-3.5 w-3.5" />
              {kpis.acima} {xAxisMode === "se"
                ? (kpis.acima === 1 ? "semana acima" : "semanas acima")
                : (kpis.acima === 1 ? "mês acima" : "meses acima")} do limite de epidemia em {refYear}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { window.location.href = `/api/cevesp/canal-endemico/export${exportQs ? `?${exportQs}` : ""}`; }}
            >
              <Download className="h-3.5 w-3.5" />
              Exportar XLSX
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { window.location.href = `/api/cevesp/relatorio${exportQs ? `?${exportQs}` : ""}`; }}
            >
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          </div>
        </div>
      )}

      {/* ── Main chart ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-primary" />
                Canal Endêmico — Conjuntivites CEVESP
              </CardTitle>
              <CardDescription className="text-xs">
                Faixa azul = intervalo esperado do coeficiente de incidência por 100 mil habitantes (limite inferior = média − 1 desvio-padrão; limite superior = média + 2 desvios-padrão dos últimos 10 anos, excluindo 2011, 2021 e 2022 e considerando só anos com casos registrados; zeros históricos anteriores a 2026 são tratados como ausência de notificação de zero caso). Azul escuro = {refYear}. Roxo tracejado = {refYear - 1}. Cinza pontilhado = média histórica. Azul claro tracejado = projeção. Casos absolutos aparecem no tooltip.
                {xAxisMode === "mes" && " Estatísticas calculadas por mês, independente da visão por SE."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {syncInfo.data?.latestNotificationDate && (() => {
                const latest = new Date(syncInfo.data!.latestNotificationDate!);
                const daysStale = Math.floor((Date.now() - latest.getTime()) / 86_400_000);
                const stale = daysStale > 14;
                return (
                  <div className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${stale ? "border-amber-200 bg-amber-50 text-amber-700" : "border-teal-200 bg-teal-50 text-teal-700"}`}>
                    {stale && <AlertTriangle className="h-3 w-3" />}
                    Dados até {latest.toLocaleDateString("pt-BR")}
                    {stale && ` (${daysStale} dias sem notificação nova)`}
                  </div>
                );
              })()}
              {projStart && (xAxisMode === "se" || projStart < 12) && (
                <div className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                  <TrendingUp className="h-3 w-3" />
                  Projeção a partir {xAxisMode === "se" ? `da SE ${projStart + 1}` : `de ${MESES[projStart]}`}
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                label={{ value: xAxisMode === "se" ? "Semana Epidemiológica" : "Mês", position: "insideBottom", offset: -2, fontSize: 11, fill: "#6b7280" }}
                height={36}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                width={48}
              />
              <Tooltip content={<CanalTooltip mode={xAxisMode} />} />
              <Legend verticalAlign="top" height={28} iconSize={10} wrapperStyle={{ fontSize: 11 }} />

              {/* Faixa esperada (média ± 2 DP) — única área sombreada, sem amarelo */}
              <Area
                type="monotone"
                dataKey="_q1Base"
                stackId="zone"
                fill="transparent"
                stroke="none"
                legendType="none"
              />
              <Area
                type="monotone"
                dataKey="Faixa esperada"
                stackId="zone"
                fill="#bae6fd"
                stroke="none"
                fillOpacity={0.55}
                legendType="square"
                name="Faixa esperada"
              />

              {/* Ano anterior — atrás das outras linhas, tom neutro. Sem connectNulls:
                  semanas sem notificação sincronizada ficam como lacuna, não como zero. */}
              <Line
                type="monotone"
                dataKey="Ano anterior"
                stroke="#7c3aed"
                strokeWidth={1.75}
                strokeDasharray="4 3"
                dot={false}
                legendType="line"
              />

              {/* Média histórica — linha de referência fina */}
              <Line
                type="monotone"
                dataKey="Média"
                stroke="#475569"
                strokeWidth={1.5}
                strokeDasharray="2 3"
                dot={false}
                legendType="line"
              />

              {/* Projeção — continuação clara do ano atual */}
              <Line
                type="monotone"
                dataKey="Projeção"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                legendType="line"
                connectNulls
              />

              {/* Ano atual — linha principal de incidencia, mais grossa e escura que todas as outras.
                  Sem connectNulls: semanas sem notificação sincronizada viram lacuna
                  visível, em vez de parecer "zero casos confirmados". */}
              <Line
                type="monotone"
                dataKey="Incidência atual"
                stroke="#1d4ed8"
                strokeWidth={3.5}
                dot={false}
                legendType="line"
              />

              {/* Linha da SE (ou mês) atual */}
              {lastLabel && (
                <ReferenceLine
                  x={lastLabel}
                  stroke="#6b7280"
                  strokeDasharray="2 2"
                  label={{ value: xAxisMode === "se" ? `SE ${lastLabel}` : lastLabel, position: "top", fontSize: 10, fill: "#6b7280" }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Legenda das zonas ────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { color: "bg-green-200 border-green-400", label: "Zona de Sucesso",   desc: "Incidência abaixo do limite inferior (média − 1 desvio-padrão) — transmissão baixa, controle bem-sucedido." },
          { color: "bg-sky-200   border-sky-400",   label: "Dentro do Esperado", desc: "Incidência dentro da faixa azul do gráfico (média ± 2 desvios-padrão) — comportamento normal, sem ação adicional." },
          { color: "bg-red-200   border-red-400",   label: "Zona Epidêmica",    desc: "Incidência acima do limite superior (média + 2 desvios-padrão) — epidemia confirmada, acionar protocolos." },
        ].map(({ color, label, desc }) => (
          <div key={label} className={`rounded-lg border-l-4 bg-opacity-40 px-4 py-3 text-xs ${color}`}>
            <p className="font-semibold">{label}</p>
            <p className="mt-0.5 text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
