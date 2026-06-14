"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle2,
  Database,
  Eye,
  Microscope,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  TrendingUp
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { RateMap, type RateMapRow } from "@/components/epidemiology/rate-map";
import { StateMap } from "@/components/epidemiology/sp-state-map";
import spStateFeature from "@/sp_state_feature.json";
import type { CevespKpis } from "@/services/cevesp-kpis";

type Tab = "geral" | "conjuntivites" | "tracoma";

interface SinanSnapshot {
  totalTraconet?: number;
  totalNottraconet?: number;
  totalNottraconetRows?: number;
  consolidatedMetrics?: Record<string, { value: number; field: string | null; rowsMissing: number }>;
  consolidatedMetricsByYear?: Array<{
    ano: number;
    examinados: number;
    positivos: number;
    tratados: number;
    linhas: number;
  }>;
  crossBankDivergences?: Array<{ risco?: string }>;
  divergencesByYear?: Array<{
    ano: number;
    traconet: number;
    nottraconet: number;
    diff: number;
    risco: "alto" | "medio" | "baixo";
  }>;
  semGraduacao?: number;
  tfSemTratamento?: number;
  ttSemCircurgia?: number;
  semConclusao?: number;
  duplicateNotificationIds?: Array<unknown>;
}

type RateAnalysis = {
  missingPopulation?: boolean;
  message?: string;
  analysisYear?: number;
  populationYear?: number | null;
  metric?: string;
  methodology?: string;
  byMunicipality?: RateMapRow[];
  byGve?: RateMapRow[];
  mapRows?: RateMapRow[];
};

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "geral", label: "Geral", icon: <Activity className="h-4 w-4" /> },
  { id: "conjuntivites", label: "Conjuntivites", icon: <Eye className="h-4 w-4" /> },
  { id: "tracoma", label: "Tracoma", icon: <Stethoscope className="h-4 w-4" /> }
];

function formatValue(value: number | undefined) {
  if (value === undefined) return "-";
  return value.toLocaleString("pt-BR");
}

function riskSummary(rows?: RateMapRow[]) {
  const summary = { baixo: 0, atencao: 0, medio: 0, alto: 0, indefinido: 0 };
  rows?.forEach((row) => {
    switch (row.riskColor) {
      case "#14b8a6":
        summary.baixo += 1;
        break;
      case "#84cc16":
        summary.atencao += 1;
        break;
      case "#f59e0b":
        summary.medio += 1;
        break;
      case "#dc2626":
        summary.alto += 1;
        break;
      default:
        summary.indefinido += 1;
    }
  });
  return summary;
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-muted-foreground">sem base</span>;
  const up = delta > 0;
  const neutral = delta === 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${neutral ? "text-muted-foreground" : up ? "text-red-600" : "text-teal-600"}`}>
      {neutral ? null : up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {delta > 0 ? "+" : ""}{delta}%
    </span>
  );
}

function cevespRisk(data?: CevespKpis) {
  if (!data) return { label: "Sem dados", cls: "bg-muted text-foreground", note: "sincronizar base" };
  if ((data.weekDelta ?? 0) >= 30 || data.outbreaksCurrentYear > 0) {
    return { label: "Atenção", cls: "border-red-200 bg-red-50 text-red-700", note: "validar território" };
  }
  if ((data.weekDelta ?? 0) >= 10) {
    return { label: "Observação", cls: "border-amber-200 bg-amber-50 text-amber-700", note: "acompanhar tendência" };
  }
  return { label: "Estável", cls: "border-teal-200 bg-teal-50 text-teal-700", note: "manter rotina" };
}

function tracomaRisk(data?: SinanSnapshot) {
  if (!data) return { label: "Sem dados", cls: "bg-muted text-foreground", note: "importar/auditar base" };
  const highRisk = data.crossBankDivergences?.filter((item) => item.risco === "alto").length ?? 0;
  const clinicalAlerts =
    (data.tfSemTratamento ?? 0) +
    (data.ttSemCircurgia ?? 0) +
    (data.semConclusao ?? 0) +
    (data.duplicateNotificationIds?.length ?? 0);
  if (highRisk > 0 || clinicalAlerts > 0) {
    return { label: "Atenção", cls: "border-red-200 bg-red-50 text-red-700", note: "corrigir divergências" };
  }
  if ((data.semGraduacao ?? 0) > 0) {
    return { label: "Qualificar", cls: "border-amber-200 bg-amber-50 text-amber-700", note: "revisar forma clínica" };
  }
  return { label: "Estável", cls: "border-teal-200 bg-teal-50 text-teal-700", note: "manter auditoria" };
}

function KpiCard({
  label,
  value,
  icon,
  delta,
  tone = "default"
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  delta?: number | null;
  tone?: "default" | "red" | "amber";
}) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold tabular-nums ${color}`}>{value}</div>
        {delta !== undefined && <DeltaBadge delta={delta} />}
      </CardContent>
    </Card>
  );
}

function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="justify-between">
      <Link href={href}>
        {label}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-[230px] flex-col items-center justify-center rounded-md border border-dashed text-center text-sm text-muted-foreground">
      <AlertTriangle className="mb-2 h-7 w-7 opacity-40" />
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-xs">{detail}</p>
    </div>
  );
}

export function DashboardView() {
  const [tab, setTab] = useState<Tab>("geral");
  const [cevespMapView, setCevespMapView] = useState<"municipio" | "gve">("municipio");
  const [sinanMapView, setSinanMapView] = useState<"municipio" | "gve">("municipio");

  const kpis = useQuery<CevespKpis>({
    queryKey: ["cevesp-kpis"],
    queryFn: async () => {
      const response = await fetch("/api/cevesp/kpis");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar KPIs");
      return data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000
  });

  const sinan = useQuery<SinanSnapshot>({
    queryKey: ["sinan-snapshot"],
    queryFn: async () => {
      const response = await fetch("/api/sinan/auditoria");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar SINAN");
      return data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000
  });

  const cevespRates = useQuery<RateAnalysis>({
    queryKey: ["cevesp-rates"],
    queryFn: async () => {
      const response = await fetch("/api/cevesp/taxas");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar taxas CEVESP");
      return data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000
  });

  const sinanRates = useQuery<RateAnalysis>({
    queryKey: ["sinan-rates"],
    queryFn: async () => {
      const response = await fetch("/api/sinan/taxas");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar taxas SINAN");
      return data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000
  });

  const cevespMapLoaded = !!cevespRates.data?.mapRows?.length && !cevespRates.data.missingPopulation;
  const sinanMapLoaded = !!sinanRates.data?.mapRows?.length && !sinanRates.data.missingPopulation;

  const stateRiskLabel = (counts: ReturnType<typeof riskSummary>) => {
    if (counts.alto > 0) return "Alto";
    if (counts.medio > 0) return "Médio";
    if (counts.atencao > 0) return "Atenção";
    if (counts.baixo > 0) return "Baixo";
    return "Sem classificação";
  };

  const stateRiskColor = (counts: ReturnType<typeof riskSummary>) => {
    if (counts.alto > 0) return "#dc2626";
    if (counts.medio > 0) return "#f59e0b";
    if (counts.atencao > 0) return "#84cc16";
    return "#14b8a6";
  };

  const missingSignals = [
    ...(cevespRates.isError || (!cevespMapLoaded && !cevespRates.isLoading) ? ["Mapa por município/GVE (CEVESP)"] : []),
    ...(sinanRates.isError || (!sinanMapLoaded && !sinanRates.isLoading) ? ["Mapa por município/GVE (Tracoma)"] : []),
    ...(kpis.isError ? ["Taxas com população"] : []),
    ...(sinan.isError ? ["Oportunidade da notificação"] : []),
    ...(cevespRates.isLoading || sinanRates.isLoading ? ["Carregando mapas de SP"] : [])
  ];

  const cevespMapRows = cevespMapView === "municipio" ? cevespRates.data?.byMunicipality ?? [] : cevespRates.data?.byGve ?? [];
  const sinanMapRows = sinanMapView === "municipio" ? sinanRates.data?.byMunicipality ?? [] : sinanRates.data?.byGve ?? [];
  const cevespRiskCounts = riskSummary(cevespMapRows);
  const sinanRiskCounts = riskSummary(sinanMapRows);

  const weekData = kpis.data
    ? [
        { label: `SE ${kpis.data.previousWeek.se}`, cases: kpis.data.previousWeek.cases },
        { label: `SE ${kpis.data.currentWeek.se}`, cases: kpis.data.currentWeek.cases }
      ]
    : [];

  const topMunicipalities = kpis.data?.topMunicipalitiesCurrentWeek ?? [];
  const cevespState = cevespRisk(kpis.data);
  const tracomaState = tracomaRisk(sinan.data);
  const generatedAt = kpis.data?.generatedAt
    ? new Date(kpis.data.generatedAt).toLocaleString("pt-BR")
    : "sem atualização";
  const tracomaHighRisk = sinan.data?.crossBankDivergences?.filter((item) => item.risco === "alto").length;
  const consolidatedByYear = sinan.data?.consolidatedMetricsByYear ?? [];
  const latestConsolidated = consolidatedByYear[consolidatedByYear.length - 1];
  const tracomaClinicalAlerts =
    (sinan.data?.tfSemTratamento ?? 0) +
    (sinan.data?.ttSemCircurgia ?? 0) +
    (sinan.data?.semConclusao ?? 0) +
    (sinan.data?.duplicateNotificationIds?.length ?? 0);

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Sala de Situação</Badge>
              <Badge className={cevespState.cls}>CEVESP: {cevespState.label}</Badge>
              <Badge className={tracomaState.cls}>Tracoma: {tracomaState.label}</Badge>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Vigilância oftalmológica</h1>
            <p className="mt-1 text-sm text-muted-foreground">Dois agravos, uma fila de decisão.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                kpis.refetch();
                sinan.refetch();
                cevespRates.refetch();
                sinanRates.refetch();
              }}
              disabled={kpis.isFetching || sinan.isFetching || cevespRates.isFetching || sinanRates.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${kpis.isFetching || sinan.isFetching || cevespRates.isFetching || sinanRates.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" asChild>
              <Link href={tab === "tracoma" ? "/sinan-qualidade" : "/notificacoes"}>Abrir módulo</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        <div className="flex flex-wrap gap-2 rounded-md border bg-card p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition-colors ${
                tab === item.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {(kpis.isError || sinan.isError) && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex items-start gap-3 py-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Dados incompletos neste ambiente</p>
                <p className="text-amber-800/80">Sem sessão, Supabase ou rede CEVESP, alguns indicadores ficam indisponíveis.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <AlertsPanel />

        {tab === "geral" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Conjuntivites no ano"
                value={kpis.isFetching ? "..." : formatValue(kpis.data?.currentYear.cases)}
                icon={<Eye className="h-4 w-4 text-primary" />}
                delta={kpis.data?.yearDelta ?? null}
              />
              <KpiCard
                label="Surtos CEVESP"
                value={kpis.isFetching ? "..." : formatValue(kpis.data?.outbreaksCurrentYear)}
                icon={<ShieldAlert className="h-4 w-4 text-red-500" />}
                tone="red"
              />
              <KpiCard
                label={`Examinados ${latestConsolidated?.ano ?? ""}`.trim()}
                value={sinan.isFetching ? "..." : formatValue(latestConsolidated?.examinados)}
                icon={<Stethoscope className="h-4 w-4 text-primary" />}
              />
              <KpiCard
                label={`Casos tracoma ${latestConsolidated?.ano ?? ""}`.trim()}
                value={sinan.isFetching ? "..." : formatValue(latestConsolidated?.positivos)}
                icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                tone="amber"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1fr_0.8fr]">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Agravos monitorados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { name: "Conjuntivites", source: "CEVESP", state: cevespState },
                    { name: "Tracoma", source: "SINAN", state: tracomaState }
                  ].map((item) => (
                    <div key={item.name} className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.source}</p>
                      </div>
                      <Badge className={item.state.cls}>{item.state.label}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Mapa de SP</CardTitle>
                  <CardDescription>Disponibilidade dos mapas municipais e GVE</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="rounded-md border p-3">
                    <p className="text-sm text-muted-foreground">CEVESP</p>
                    <p className="text-base font-semibold">{cevespRates.isLoading ? "Carregando..." : cevespMapLoaded ? "Disponível" : "Indisponível"}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-sm text-muted-foreground">SINAN Tracoma</p>
                    <p className="text-base font-semibold">{sinanRates.isLoading ? "Carregando..." : sinanMapLoaded ? "Disponível" : "Indisponível"}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Sinais ausentes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {missingSignals.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Todos os principais indicadores estão disponíveis.</div>
                  ) : (
                    missingSignals.map((signal) => (
                      <div key={signal} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-amber-600" />
                        <span>{signal}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {tab === "conjuntivites" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label={`Casos SE ${kpis.data?.currentWeek.se ?? "atual"}`}
                value={kpis.isFetching ? "..." : formatValue(kpis.data?.currentWeek.cases)}
                icon={<BarChart2 className="h-4 w-4 text-primary" />}
                delta={kpis.data?.weekDelta ?? null}
              />
              <KpiCard
                label="Casos no ano"
                value={kpis.isFetching ? "..." : formatValue(kpis.data?.currentYear.cases)}
                icon={<TrendingUp className="h-4 w-4 text-primary" />}
                delta={kpis.data?.yearDelta ?? null}
              />
              <KpiCard
                label="Surtos"
                value={kpis.isFetching ? "..." : formatValue(kpis.data?.outbreaksCurrentYear)}
                icon={<ShieldAlert className="h-4 w-4 text-red-500" />}
                tone="red"
              />
              <KpiCard
                label="Coletas"
                value={kpis.isFetching ? "..." : formatValue(kpis.data?.collectionsCurrentYear)}
                icon={<Microscope className="h-4 w-4 text-primary" />}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>Semana epidemiológica</CardTitle>
                      <CardDescription>Atual vs anterior</CardDescription>
                    </div>
                    <Badge className={cevespState.cls}>{cevespState.note}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weekData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => [value, "Casos"]} />
                      <Bar dataKey="cases" fill="#0f766e" name="Casos" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Territórios críticos</CardTitle>
                  <CardDescription>Prioridade da semana</CardDescription>
                </CardHeader>
                <CardContent>
                  {topMunicipalities.length === 0 ? (
                    <EmptyState title="Sem ranking disponível" detail="Sincronize o CEVESP ou revise o cache." />
                  ) : (
                    <div className="space-y-2">
                      {topMunicipalities.slice(0, 5).map((item, index) => (
                        <div key={item.name} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-md border p-3">
                          <span className="text-sm font-semibold text-muted-foreground">{index + 1}</span>
                          <span className="truncate text-sm font-medium">{item.name}</span>
                          <span className="text-lg font-semibold tabular-nums">{item.cases}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Decisão CEVESP</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-3">
                <ActionButton href="/notificacoes" label="Consultar banco" />
                <ActionButton href="/cevesp-qualidade" label="Revisar qualidade" />
                <ActionButton href="/correcoes" label="Tratar correções" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Mapa operacional SP</CardTitle>
                    <CardDescription>CEVESP - taxas por município e GVE</CardDescription>
                  </div>
                  <div className="inline-flex rounded-md border bg-background p-1">
                    {(["municipio", "gve"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCevespMapView(mode)}
                        className={`rounded px-3 py-1 text-xs font-semibold transition ${cevespMapView === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {mode === "municipio" ? "Município" : "GVE"}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {cevespRates.isLoading ? (
                  <EmptyState title="Carregando mapa CEVESP" detail="Aguarde a atualização dos dados." />
                ) : cevespRates.isError || !cevespRates.data?.mapRows?.length ? (
                  <EmptyState title="Mapa CEVESP indisponível" detail="Não foi possível carregar o mapa de SP." />
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span>{cevespMapView === "municipio" ? `${cevespRates.data.byMunicipality?.length ?? 0} municípios` : `${cevespRates.data.byGve?.length ?? 0} GVE`}</span>
                      <span className="text-[11px] uppercase tracking-[0.16em]">População IBGE {cevespRates.data.populationYear ?? "-"}</span>
                      <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs">
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#dc2626]" />{cevespRiskCounts.alto}
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />{cevespRiskCounts.medio}
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#84cc16]" />{cevespRiskCounts.atencao}
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#14b8a6]" />{cevespRiskCounts.baixo}
                      </span>
                    </div>
                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle>Mapa geográfico de SP</CardTitle>
                          <CardDescription>Contorno do estado com sinalização por risco</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <StateMap
                            geoJson={spStateFeature as any}
                            fillColor={stateRiskColor(cevespRiskCounts)}
                            strokeColor="#0f766e"
                          />
                          <p className="mt-3 text-sm text-muted-foreground">
                            Risco estadual: <span className="font-semibold text-foreground">{stateRiskLabel(cevespRiskCounts)}</span>
                          </p>
                        </CardContent>
                      </Card>
                      <RateMap
                      title={`CEVESP SP - ${cevespMapView === "municipio" ? "Municípios" : "GVE"}`}
                      description="Incidência de conjuntivite por 100 mil habitantes"
                      rows={cevespMapRows}
                      valueKey="incidencia100k"
                      valueLabel="incidência/100k"
                      tableColumns={
                        cevespMapView === "municipio"
                          ? [
                              { key: "municipio", label: "Município" },
                              { key: "gve", label: "GVE" },
                              { key: "incidencia100k", label: "Incidência/100k", decimals: 1 }
                            ]
                          : [
                              { key: "gve", label: "GVE" },
                              { key: "incidencia100k", label: "Incidência/100k", decimals: 1 }
                            ]
                      }
                    />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {tab === "tracoma" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label={`Examinados ${latestConsolidated?.ano ?? ""}`.trim()}
                value={sinan.isFetching ? "..." : formatValue(latestConsolidated?.examinados ?? sinan.data?.consolidatedMetrics?.examinados?.value)}
                icon={<Database className="h-4 w-4 text-primary" />}
              />
              <KpiCard
                label={`Casos positivos ${latestConsolidated?.ano ?? ""}`.trim()}
                value={sinan.isFetching ? "..." : formatValue(latestConsolidated?.positivos ?? sinan.data?.totalNottraconet)}
                icon={<BarChart2 className="h-4 w-4 text-primary" />}
              />
              <KpiCard
                label="Individuais TRACONET"
                value={sinan.isFetching ? "..." : formatValue(sinan.data?.totalTraconet)}
                icon={<Stethoscope className="h-4 w-4 text-primary" />}
              />
              <KpiCard
                label="Diferenças alto risco"
                value={sinan.isFetching ? "..." : formatValue(tracomaHighRisk)}
                icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                tone="red"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Consolidado por ano</CardTitle>
                  <CardDescription>
                    NOTTRACONET/NTRACOMA
                    {sinan.data?.consolidatedMetrics?.examinados?.field
                      ? ` · examinados: ${sinan.data.consolidatedMetrics.examinados.field}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {consolidatedByYear.length === 0 ? (
                    <EmptyState title="SINAN indisponível" detail="Importe os bancos ou acesse com sessão válida." />
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full min-w-[460px] text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50 text-left">
                            <th className="px-3 py-2">Ano</th>
                            <th className="px-3 py-2 text-right">Examinados</th>
                            <th className="px-3 py-2 text-right">Positivos</th>
                            <th className="px-3 py-2 text-right">% Pos.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consolidatedByYear.slice(-6).map((row) => (
                            <tr key={row.ano} className="border-b last:border-0">
                              <td className="px-3 py-2 font-medium">{row.ano}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatValue(row.examinados)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatValue(row.positivos)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {row.examinados > 0 ? `${((row.positivos / row.examinados) * 100).toFixed(1)}%` : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Comparação dos bancos</CardTitle>
                  <CardDescription>TRACONET individuais x consolidado positivo</CardDescription>
                </CardHeader>
                <CardContent>
                  {(sinan.data?.divergencesByYear ?? []).length === 0 ? (
                    <EmptyState title="Comparação indisponível" detail="Importe TRACONET e NOTTRACONET para comparar." />
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50 text-left">
                            <th className="px-3 py-2">Ano</th>
                            <th className="px-3 py-2 text-right">TRACONET</th>
                            <th className="px-3 py-2 text-right">Consolidado</th>
                            <th className="px-3 py-2 text-right">Dif.</th>
                            <th className="px-3 py-2 text-center">Risco</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(sinan.data?.divergencesByYear ?? []).slice(-6).map((row) => (
                            <tr key={row.ano} className="border-b last:border-0">
                              <td className="px-3 py-2 font-medium">{row.ano}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatValue(row.traconet)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatValue(row.nottraconet)}</td>
                              <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.diff === 0 ? "text-muted-foreground" : row.diff > 0 ? "text-red-600" : "text-amber-700"}`}>
                                {row.diff > 0 ? "+" : ""}{formatValue(row.diff)}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <Badge className={row.risco === "alto" ? "border-red-200 bg-red-50 text-red-700" : row.risco === "medio" ? "border-amber-200 bg-amber-50 text-amber-700" : "bg-muted text-foreground"}>
                                  {row.risco}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Qualidade clínica</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Alertas clínicos", value: tracomaClinicalAlerts },
                    { label: "Sem forma clínica", value: sinan.data?.semGraduacao },
                    { label: "TF sem tratamento", value: sinan.data?.tfSemTratamento },
                    { label: "TT sem cirurgia", value: sinan.data?.ttSemCircurgia }
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">{formatValue(item.value)}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Decisão Tracoma</CardTitle>
                  <CardDescription>Foco em eliminação, tratamento e consistência</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  <ActionButton href="/sinan-qualidade" label="Abrir auditoria" />
                  <ActionButton href="/sincronizacao" label="Importar bancos" />
                  <ActionButton href="/chat" label="Perguntar ao agente" />
                  <ActionButton href="/boletins" label="Registrar boletim" />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Mapa operacional SP</CardTitle>
                    <CardDescription>SINAN Tracoma - prevalência por município e GVE</CardDescription>
                  </div>
                  <div className="inline-flex rounded-md border bg-background p-1">
                    {(["municipio", "gve"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSinanMapView(mode)}
                        className={`rounded px-3 py-1 text-xs font-semibold transition ${sinanMapView === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {mode === "municipio" ? "Município" : "GVE"}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {sinanRates.isLoading ? (
                  <EmptyState title="Carregando mapa Tracoma" detail="Aguarde a atualização dos dados." />
                ) : sinanRates.isError || !sinanRates.data?.mapRows?.length ? (
                  <EmptyState title="Mapa Tracoma indisponível" detail="Não foi possível carregar o mapa de SP." />
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      <span>{sinanMapView === "municipio" ? `${sinanRates.data.byMunicipality?.length ?? 0} municípios` : `${sinanRates.data.byGve?.length ?? 0} GVE`}</span>
                      <span className="text-[11px] uppercase tracking-[0.16em]">População IBGE {sinanRates.data.populationYear ?? "-"}</span>
                      <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs">
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#dc2626]" />{sinanRiskCounts.alto}
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />{sinanRiskCounts.medio}
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#84cc16]" />{sinanRiskCounts.atencao}
                        <span className="h-2.5 w-2.5 rounded-sm bg-[#14b8a6]" />{sinanRiskCounts.baixo}
                      </span>
                    </div>
                    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle>Mapa geográfico de SP</CardTitle>
                          <CardDescription>Contorno do estado com sinalização por risco</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <StateMap
                            geoJson={spStateFeature as any}
                            fillColor={stateRiskColor(sinanRiskCounts)}
                            strokeColor="#0f766e"
                          />
                          <p className="mt-3 text-sm text-muted-foreground">
                            Risco estadual: <span className="font-semibold text-foreground">{stateRiskLabel(sinanRiskCounts)}</span>
                          </p>
                        </CardContent>
                      </Card>
                      <RateMap
                      title={`SINAN Tracoma SP - ${sinanMapView === "municipio" ? "Municípios" : "GVE"}`}
                      description="Prevalência de tracoma entre examinados"
                      rows={sinanMapRows}
                      valueKey="prevalencia"
                      valueLabel="prevalência %"
                      tableColumns={
                        sinanMapView === "municipio"
                          ? [
                              { key: "municipio", label: "Município" },
                              { key: "gve", label: "GVE" },
                              { key: "prevalencia", label: "Prevalência %", decimals: 1 }
                            ]
                          : [
                              { key: "gve", label: "GVE" },
                              { key: "prevalencia", label: "Prevalência %", decimals: 1 }
                            ]
                      }
                    />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardContent className="flex flex-col gap-2 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2">
              <Database className="h-3.5 w-3.5" />
              Bases: CEVESP e SINAN/Tracoma
            </span>
            <span>Última atualização CEVESP: {generatedAt}</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
