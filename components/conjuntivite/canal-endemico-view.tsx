"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, ComposedChart, CartesianGrid, Legend, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, TrendingUp, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EndemicChannelPoint } from "@/services/cevesp-endemic";

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
    sucesso:  { label: "Zona de Sucesso",  Icon: CheckCircle2,  cls: "bg-green-100 text-green-800 border-green-300"  },
    alerta:   { label: "Zona de Alerta",   Icon: AlertTriangle,  cls: "bg-amber-100  text-amber-800  border-amber-300"  },
    epidemia: { label: "Zona Epidêmica",   Icon: XCircle,        cls: "bg-red-100    text-red-800    border-red-300"    },
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
function CanalTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  const byName = Object.fromEntries(payload.map((p) => [p.name, p.value]));
  const q1   = byName["Sucesso (Q1)"]   ?? 0;
  const band = byName["Alerta (Q1-Q3)"] ?? 0;
  const q3   = q1 + band;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">SE {label}</p>
      {byName["Atual"] != null        && <p className="text-blue-600">Atual: {Number(byName["Atual"]).toLocaleString("pt-BR")}</p>}
      {byName["Projeção"] != null     && <p className="text-blue-400">Projeção: {Number(byName["Projeção"]).toLocaleString("pt-BR")}</p>}
      {byName["Mediana"] != null      && <p className="text-gray-500">Mediana hist.: {Number(byName["Mediana"]).toLocaleString("pt-BR")}</p>}
      <p className="text-green-700">Q1 (limite sucesso): {q1.toLocaleString("pt-BR")}</p>
      <p className="text-amber-700">Q3 (limite alerta): {q3.toLocaleString("pt-BR")}</p>
      {byName["Farrington"] != null   && <p className="text-red-700 font-medium">Limiar Farrington: {Number(byName["Farrington"]).toLocaleString("pt-BR")}</p>}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
type Props = {
  filters?: { gve?: string; municipio?: string };
};

export function CanalEndemicoView({ filters }: Props) {
  const currentYear = new Date().getFullYear();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.gve)       p.set("gve", filters.gve);
    if (filters?.municipio) p.set("municipality", filters.municipio);
    return p.toString();
  }, [filters]);

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
    p.set("year", String(currentYear - 1));
    return p.toString();
  }, [filters, currentYear]);

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
    const lastSE   = withData.length > 0 ? Math.max(...withData.map((d) => d.se)) : null;
    const currentZona = lastSE ? (data.find((d) => d.se === lastSE)?.currentYear ?? null) !== null
      ? data.find((d) => d.se === lastSE)!.currentYear! > data.find((d) => d.se === lastSE)!.q3
        ? "epidemia"
        : data.find((d) => d.se === lastSE)!.currentYear! > data.find((d) => d.se === lastSE)!.q1
          ? "alerta" : "sucesso"
      : null : null;

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
        "Sucesso (Q1)":     d.q1,
        "Alerta (Q1-Q3)":   alertBand,
        "Mediana":          d.median,
        "Atual":            d.currentYear ?? undefined,
        "Ano anterior":     anoAnterior,
        "Projeção":         projecao,
        "Farrington":       d.farrington ?? undefined,
      };
    });

    return { chartData, lastSE, currentZona, projStart };
  }, [data, prevData]);

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
    <Card className="border-destructive m-6">
      <CardContent className="py-8 text-center text-sm text-red-700">{(error as Error).message}</CardContent>
    </Card>
  );

  if (!data || data.length === 0) return (
    <Card className="m-6">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Sem dados suficientes para calcular o canal endêmico. Sincronize o CEVESP.
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 p-6">
      {/* ── KPI row + export ────────────────────────────────────────────── */}
      {kpis && lastSE && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm shadow-sm">
            <span className="text-muted-foreground">SE {lastSE} — casos:</span>
            <span className="font-semibold">{kpis.atual.toLocaleString("pt-BR")}</span>
            <ZoneBadge zona={currentZona} />
          </div>
          <div className="rounded-lg border bg-card px-4 py-2 text-xs text-muted-foreground shadow-sm">
            Q1 histórico: <strong>{kpis.q1.toLocaleString("pt-BR")}</strong> · mediana: <strong>{kpis.median.toLocaleString("pt-BR")}</strong> · Q3: <strong>{kpis.q3.toLocaleString("pt-BR")}</strong>
          </div>
          {kpis.acima > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 shadow-sm">
              <AlertTriangle className="h-3.5 w-3.5" />
              {kpis.acima} {kpis.acima === 1 ? "semana acima" : "semanas acima"} do Q3 no ano atual
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
                Zonas calculadas com base nos últimos 5 anos (P25–P75 por SE). Azul sólido = {currentYear}. Cinza tracejado = {currentYear - 1}. Azul claro = projeção. Linha vermelha = limiar Farrington (EARS C2).
              </CardDescription>
            </div>
            {projStart && (
              <div className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                <TrendingUp className="h-3 w-3" />
                Projeção a partir da SE {projStart + 1}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="se"
                tick={{ fontSize: 11 }}
                tickLine={false}
                label={{ value: "Semana Epidemiológica", position: "insideBottom", offset: -2, fontSize: 11, fill: "#6b7280" }}
                height={36}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                width={48}
              />
              <Tooltip content={<CanalTooltip />} />
              <Legend verticalAlign="top" height={28} iconSize={10} wrapperStyle={{ fontSize: 11 }} />

              {/* Zonas — stacked areas */}
              <Area
                type="monotone"
                dataKey="Sucesso (Q1)"
                stackId="zone"
                fill="#bbf7d0"
                stroke="none"
                fillOpacity={0.7}
                legendType="square"
              />
              <Area
                type="monotone"
                dataKey="Alerta (Q1-Q3)"
                stackId="zone"
                fill="#fde68a"
                stroke="none"
                fillOpacity={0.7}
                legendType="square"
              />

              {/* Mediana histórica */}
              <Line
                type="monotone"
                dataKey="Mediana"
                stroke="#9ca3af"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                legendType="line"
              />

              {/* Ano atual */}
              <Line
                type="monotone"
                dataKey="Atual"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={false}
                legendType="line"
                connectNulls
              />

              {/* Ano anterior */}
              <Line
                type="monotone"
                dataKey="Ano anterior"
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="3 2"
                dot={false}
                legendType="line"
                connectNulls
              />

              {/* Projeção */}
              <Line
                type="monotone"
                dataKey="Projeção"
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                legendType="line"
                connectNulls
              />

              {/* Limiar epidêmico Farrington (EARS C2 simplificado) */}
              <Line
                type="monotone"
                dataKey="Farrington"
                stroke="#dc2626"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                legendType="line"
                connectNulls
              />

              {/* Linha da SE atual */}
              {lastSE && (
                <ReferenceLine
                  x={lastSE}
                  stroke="#6b7280"
                  strokeDasharray="2 2"
                  label={{ value: `SE ${lastSE}`, position: "top", fontSize: 10, fill: "#6b7280" }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Legenda das zonas ────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { color: "bg-green-200 border-green-400", label: "Zona de Sucesso", desc: "Casos abaixo do Q1 histórico — transmissão baixa ou esperada." },
          { color: "bg-amber-200 border-amber-400", label: "Zona de Alerta",  desc: "Casos entre Q1 e Q3 — tendência de aumento, monitorar GVEs." },
          { color: "bg-red-200   border-red-400",   label: "Zona Epidêmica",  desc: "Casos acima do Q3 — epidemia confirmada, acionar protocolos." },
          { color: "bg-rose-100  border-rose-500",  label: "Limiar Farrington", desc: "Limiar estatístico EARS C2 (μ + 2,576·√(φ·μ)). Acima: sinal epidêmico robusto independente de sazonalidade." },
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
