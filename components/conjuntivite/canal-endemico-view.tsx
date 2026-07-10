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
import { pickCurrentChannelPoint, monthToEpiWeekRange } from "@/lib/epi-week";

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
function CanalTooltip({ active, payload, label, mode }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string | number; mode?: "se" | "mes" }) {
  if (!active || !payload?.length) return null;
  const byName = Object.fromEntries(payload.map((p) => [p.name, p.value]));
  const q1   = byName["_q1Base"]        ?? 0;
  const band = byName["Faixa esperada"] ?? 0;
  const q3   = q1 + band;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{mode === "mes" ? label : `SE ${label}`}</p>
      {byName["Atual"] != null        && <p className="font-medium text-blue-700">Atual: {Number(byName["Atual"]).toLocaleString("pt-BR")}</p>}
      {byName["Projeção"] != null     && <p className="text-blue-400">Projeção: {Number(byName["Projeção"]).toLocaleString("pt-BR")}</p>}
      {byName["Ano anterior"] != null && <p className="text-violet-600">Ano anterior: {Number(byName["Ano anterior"]).toLocaleString("pt-BR")}</p>}
      {byName["Média"] != null        && <p className="text-gray-500">Média hist.: {Number(byName["Média"]).toLocaleString("pt-BR")}</p>}
      <p className="mt-1 border-t pt-1 text-muted-foreground">Limite inferior: {q1.toLocaleString("pt-BR")} · Limite superior: {q3.toLocaleString("pt-BR")}</p>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
type Props = {
  filters?: { gve?: string; municipio?: string };
};

export function CanalEndemicoView({ filters }: Props) {
  const thisYear = new Date().getFullYear();

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

  const qs = useMemo(() => {
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
    return p.toString();
  }, [filters, refYear]);

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
  const { chartData, lastSE, currentZona, projStart } = useMemo(() => {
    if (!data) return { chartData: [], lastSE: null, currentZona: null, projStart: null };

    const withData = data.filter((d) => d.currentYear !== null);
    const currentPt = pickCurrentChannelPoint(data);
    const lastSE    = currentPt?.se ?? null;
    const currentZona = currentPt?.currentYear != null
      ? currentPt.currentYear > currentPt.q3
        ? "epidemia"
        : currentPt.currentYear > currentPt.q1
          ? "esperado" : "sucesso"
      : null;

    // Previous year lookup by SE
    const prevMap = new Map((prevData ?? []).map((p) => [p.se, p.currentYear]));

    // Linear regression on last 6 observed SEs
    const recent = withData.slice(-6);
    const reg = linearRegression(recent.map((d) => ({ x: d.se, y: d.currentYear! })));
    const projStart = lastSE ?? null;

    const chartData = data.map((d) => {
      const alertBand = Math.max(0, d.q3 - d.q1);
      const projecao =
        reg && projStart && d.se > projStart && d.se <= projStart + 4
          ? Math.max(0, Math.round(reg.slope * d.se + reg.intercept))
          : undefined;
      const anoAnterior = prevMap.has(d.se) ? prevMap.get(d.se) ?? undefined : undefined;
      return {
        se:                 d.se,
        label:              String(d.se),
        "_q1Base":          d.q1,
        "Faixa esperada":   alertBand,
        "Média":            d.median,
        "Atual":            d.currentYear ?? undefined,
        "Ano anterior":     anoAnterior,
        "Projeção":         projecao,
      };
    });

    return { chartData, lastSE, currentZona, projStart };
  }, [data, prevData]);

  // ── Agregação mensal (soma das SEs de cada mês), usada quando o eixo X = Mês ─
  const monthlyChartData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
      const [lo, hi] = monthToEpiWeekRange(refYear, month);
      const rows = chartData.filter((d) => d.se >= lo && d.se <= hi);
      const sum = (key: "_q1Base" | "Faixa esperada" | "Média" | "Atual" | "Ano anterior" | "Projeção") =>
        rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
      const sumIfAny = (key: "Atual" | "Ano anterior" | "Projeção") =>
        rows.some((r) => r[key] != null) ? sum(key) : undefined;
      return {
        se:                 month,
        label:              MESES[month - 1].slice(0, 3),
        "_q1Base":          sum("_q1Base"),
        "Faixa esperada":   sum("Faixa esperada"),
        "Média":            sum("Média"),
        "Atual":            sumIfAny("Atual"),
        "Ano anterior":     sumIfAny("Ano anterior"),
        "Projeção":         sumIfAny("Projeção"),
      };
    });
  }, [chartData, refYear]);

  const displayData = xAxisMode === "se" ? chartData : monthlyChartData;

  // Mês corrente correspondente à última SE observada, para a linha de referência
  const currentMonthLabel = useMemo(() => {
    if (lastSE == null) return null;
    for (let month = 1; month <= 12; month++) {
      const [lo, hi] = monthToEpiWeekRange(refYear, month);
      if (lastSE >= lo && lastSE <= hi) return MESES[month - 1].slice(0, 3);
    }
    return null;
  }, [lastSE, refYear]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!data || !lastSE) return null;
    const seData = data.find((d) => d.se === lastSE);
    if (!seData) return null;
    const atual = seData.currentYear ?? 0;
    const acima = data.filter((d) => d.currentYear !== null && d.currentYear > d.q3).length;
    return { atual, q1: seData.q1, q3: seData.q3, median: seData.median, acima };
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
            <span className="text-muted-foreground">SE {lastSE} — casos:</span>
            <span className="font-semibold">{kpis.atual.toLocaleString("pt-BR")}</span>
            <ZoneBadge zona={currentZona} />
          </div>
          <div className="rounded-lg border bg-card px-4 py-2 text-xs text-muted-foreground shadow-sm">
            Limite inferior: <strong>{kpis.q1.toLocaleString("pt-BR")}</strong> · média: <strong>{kpis.median.toLocaleString("pt-BR")}</strong> · Limite superior: <strong>{kpis.q3.toLocaleString("pt-BR")}</strong>
          </div>
          {kpis.acima > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 shadow-sm">
              <AlertTriangle className="h-3.5 w-3.5" />
              {kpis.acima} {kpis.acima === 1 ? "semana acima" : "semanas acima"} do limite de epidemia em {refYear}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { window.location.href = `/api/cevesp/canal-endemico/export${qs ? `?${qs}` : ""}`; }}
            >
              <Download className="h-3.5 w-3.5" />
              Exportar XLSX
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { window.location.href = `/api/cevesp/relatorio${qs ? `?${qs}` : ""}`; }}
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
                Faixa azul = intervalo esperado (média ± 2 desvios-padrão em escala logarítmica, dos 10 anos anteriores — evita que anos de surto distorçam o limite inferior). Azul escuro = {refYear}. Roxo tracejado = {refYear - 1}. Cinza pontilhado = média histórica. Azul claro tracejado = projeção.
                {xAxisMode === "mes" && " Valores mensais somam as SEs de cada mês."}
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
              {projStart && (
                <div className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                  <TrendingUp className="h-3 w-3" />
                  Projeção a partir da SE {projStart + 1}
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={displayData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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

              {/* Ano atual — linha principal, mais grossa e escura que todas as outras.
                  Sem connectNulls: semanas sem notificação sincronizada viram lacuna
                  visível, em vez de parecer "zero casos confirmados". */}
              <Line
                type="monotone"
                dataKey="Atual"
                stroke="#1d4ed8"
                strokeWidth={3.5}
                dot={false}
                legendType="line"
              />

              {/* Linha da SE (ou mês) atual */}
              {lastSE && (xAxisMode === "se" || currentMonthLabel) && (
                <ReferenceLine
                  x={xAxisMode === "se" ? String(lastSE) : currentMonthLabel!}
                  stroke="#6b7280"
                  strokeDasharray="2 2"
                  label={{ value: xAxisMode === "se" ? `SE ${lastSE}` : currentMonthLabel!, position: "top", fontSize: 10, fill: "#6b7280" }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Legenda das zonas ────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { color: "bg-green-200 border-green-400", label: "Zona de Sucesso",   desc: "Casos abaixo do limite inferior (média − 2 DP em escala log) — transmissão baixa, controle bem-sucedido." },
          { color: "bg-sky-200   border-sky-400",   label: "Dentro do Esperado", desc: "Casos dentro da faixa azul do gráfico (média ± 2 DP em escala log) — comportamento normal, sem ação adicional." },
          { color: "bg-red-200   border-red-400",   label: "Zona Epidêmica",    desc: "Casos acima do limite superior (média + 2 DP em escala log) — epidemia confirmada, acionar protocolos." },
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
