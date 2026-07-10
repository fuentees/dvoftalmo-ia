"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Database,
  Eye,
  Map,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  TrendingUp
} from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import type { CevespKpis } from "@/services/cevesp-kpis";
import type { CevespHistorico } from "@/lib/external/supabase-cevesp";
import type { EndemicChannelPoint } from "@/services/cevesp-endemic";
import { pickCurrentChannelPoint } from "@/lib/epi-week";

interface SinanSnapshot {
  totalTraconet?: number;
  totalNottraconet?: number;
  consolidatedMetrics?: Record<string, { value: number; field: string | null; rowsMissing: number }>;
  consolidatedMetricsByYear?: Array<{
    ano: number;
    examinados: number;
    positivos: number;
    tratados: number;
    linhas: number;
  }>;
  crossBankDivergences?: Array<{ risco?: string }>;
  semGraduacao?: number;
  tfSemTratamento?: number;
  ttSemCircurgia?: number;
  semConclusao?: number;
  duplicateNotificationIds?: Array<unknown>;
}

type DiagnosticCheck = {
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
  detail?: string;
};

type SituationDiagnostic = {
  status: "ok" | "warning" | "error";
  generatedAt: string;
  checks: DiagnosticCheck[];
};

type SituationPriority = {
  id: string;
  level: "critica" | "alta" | "media";
  source: "alerta" | "cevesp" | "sinan" | "qualidade";
  agravo: "Conjuntivite" | "Tracoma" | "Dados";
  territorio: string;
  motivo: string;
  acao: string;
  prazo: string;
  evidenciaHref: string;
  score: number;
  detalhe?: string;
};

type SituationPriorities = {
  generatedAt: string;
  priorities: SituationPriority[];
  summary: { total: number; critica: number; alta: number; media: number };
};

const quickActions = [
  { href: "/territorios", label: "Territórios", detail: "Ranking operacional por risco e evidência", icon: Map },
  { href: "/conjuntivite", label: "Analisar CEVESP", detail: "Séries, mapas, canal e boletim", icon: Eye },
  { href: "/tracoma", label: "Analisar Tracoma", detail: "Prevalência, bancos e qualidade clínica", icon: Stethoscope },
  { href: "/qualidade-dados", label: "Qualidade", detail: "Pendências que afetam a decisão", icon: ShieldAlert }
];

function formatValue(value: number | undefined) {
  if (value === undefined) return "-";
  return value.toLocaleString("pt-BR");
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
  if (!data) return { label: "Sem dados", cls: "bg-muted text-foreground" };
  if ((data.weekDelta ?? 0) >= 30 || data.outbreaksCurrentYear > 0) {
    return { label: "Atenção", cls: "border-red-200 bg-red-50 text-red-700" };
  }
  if ((data.weekDelta ?? 0) >= 10) {
    return { label: "Observação", cls: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  return { label: "Estável", cls: "border-teal-200 bg-teal-50 text-teal-700" };
}

function tracomaRisk(data?: SinanSnapshot) {
  if (!data) return { label: "Sem dados", cls: "bg-muted text-foreground" };
  const highRisk = data.crossBankDivergences?.filter((item) => item.risco === "alto").length ?? 0;
  const clinicalAlerts =
    (data.tfSemTratamento ?? 0) +
    (data.semConclusao ?? 0) +
    (data.duplicateNotificationIds?.length ?? 0);
  if (highRisk > 0 || clinicalAlerts > 0) {
    return { label: "Atenção", cls: "border-red-200 bg-red-50 text-red-700" };
  }
  if ((data.semGraduacao ?? 0) > 0) {
    return { label: "Qualificar", cls: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  return { label: "Estável", cls: "border-teal-200 bg-teal-50 text-teal-700" };
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

function CanalZoneStrip({ data, loading }: { data?: EndemicChannelPoint[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border bg-muted/30 px-4 text-xs text-muted-foreground animate-pulse">
        <TrendingUp className="h-3.5 w-3.5" />
        Carregando canal endêmico…
      </div>
    );
  }
  if (!data?.length) return null;

  const pt = pickCurrentChannelPoint(data);
  if (!pt || pt.currentYear === null) return null;

  const cur = pt.currentYear;
  const isEpidemia = cur > pt.q3;
  const isAlerta = !isEpidemia && cur > pt.q1;
  const zona = isEpidemia ? "Epidemia" : isAlerta ? "Alerta" : "Sucesso";
  const bg  = isEpidemia ? "border-red-200 bg-red-50 text-red-800"
            : isAlerta   ? "border-amber-200 bg-amber-50 text-amber-800"
            :              "border-teal-200 bg-teal-50 text-teal-800";
  const badgeCls = isEpidemia ? "bg-red-100 text-red-700"
                 : isAlerta   ? "bg-amber-100 text-amber-700"
                 :              "bg-teal-100 text-teal-700";

  return (
    <Link href="/conjuntivite?tab=situacao" className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm transition-opacity hover:opacity-80 ${bg}`}>
      <TrendingUp className="h-4 w-4 shrink-0" />
      <span className="flex-1 font-medium">Canal Endêmico · SE {pt.se}</span>
      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badgeCls}`}>{zona}</span>
      <span className="text-xs opacity-75">
        {cur.toLocaleString("pt-BR")} casos · alerta={pt.q1.toLocaleString("pt-BR")} epidemia={pt.q3.toLocaleString("pt-BR")}
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
    </Link>
  );
}

function MiniSparkline({ data, color = "#2563eb" }: { data: Array<{ ano: number; value: number }>; color?: string }) {
  if (data.length < 2) return null;
  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barSize={data.length > 12 ? undefined : 10}>
          <XAxis dataKey="ano" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0];
              return (
                <div className="rounded border bg-background px-2 py-1 text-xs shadow">
                  <span className="font-medium">{p.payload.ano}</span>: {Number(p.value).toLocaleString("pt-BR")}
                </div>
              );
            }}
          />
          <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function diagnosticStyle(status: DiagnosticCheck["status"]) {
  if (status === "ok") return "border-teal-200 bg-teal-50 text-teal-700";
  if (status === "error") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function priorityStyle(level: SituationPriority["level"]) {
  if (level === "critica") return "border-red-200 bg-red-50 text-red-700";
  if (level === "alta") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function DataHealthPanel({ diagnostic }: { diagnostic?: SituationDiagnostic }) {
  const checks = diagnostic?.checks ?? [];
  const statusLabel = diagnostic?.status === "ok" ? "Operacional" : diagnostic?.status === "error" ? "Erro" : "Atenção";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Saúde da sala</CardTitle>
            <CardDescription>Conexões, bases e caches usados para decidir</CardDescription>
          </div>
          <Badge className={diagnosticStyle(diagnostic?.status === "error" ? "error" : diagnostic?.status === "ok" ? "ok" : "warning")}>
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {(checks.length ? checks : [
            { label: "Autenticacao", status: "warning" as const, message: "Verificando..." },
            { label: "CEVESP", status: "warning" as const, message: "Verificando..." },
            { label: "SINAN Tracoma", status: "warning" as const, message: "Verificando..." },
            { label: "Populacao IBGE", status: "warning" as const, message: "Verificando..." },
            { label: "Boletins", status: "warning" as const, message: "Verificando..." }
          ]).map((check) => (
            <div key={check.label} className={`rounded-md border p-3 ${diagnosticStyle(check.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">{check.label}</p>
                {check.status === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </div>
              <p className="mt-2 text-sm font-semibold leading-snug">{check.message}</p>
              {check.detail && <p className="mt-1 line-clamp-2 text-xs opacity-80">{check.detail}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TodayPrioritiesPanel({
  data,
  loading
}: {
  data?: SituationPriorities;
  loading: boolean;
}) {
  const priorities = data?.priorities ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Prioridades de hoje</CardTitle>
            <CardDescription>Cockpit operacional: o que exige decisão agora</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className={data?.summary.critica ? "border-red-200 bg-red-50 text-red-700" : "border-teal-200 bg-teal-50 text-teal-700"}>
              {data?.summary.critica ?? 0} críticas
            </Badge>
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">{data?.summary.alta ?? 0} altas</Badge>
            <Badge className="bg-muted text-foreground">{data?.summary.total ?? 0} total</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-28 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Consolidando prioridades...
          </div>
        ) : priorities.length === 0 ? (
          <div className="flex h-28 flex-col items-center justify-center rounded-md border border-dashed text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mb-2 h-7 w-7 text-teal-600" />
            Nenhuma prioridade operacional crítica com os dados carregados.
          </div>
        ) : (
          <div className="grid gap-3">
            {priorities.slice(0, 5).map((item, index) => (
              <Link
                key={item.id}
                href={item.evidenciaHref}
                className="group grid gap-3 rounded-md border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5 lg:grid-cols-[44px_140px_1fr_220px_auto]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-sm font-semibold tabular-nums">
                  {index + 1}
                </div>
                <div className="space-y-1">
                  <Badge className={priorityStyle(item.level)}>{item.level}</Badge>
                  <p className="text-xs text-muted-foreground">{item.agravo}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.territorio}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.motivo}</p>
                  {item.detalhe && <p className="mt-1 text-xs text-muted-foreground">{item.detalhe}</p>}
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ação</p>
                  <p className="mt-1 text-sm leading-snug">{item.acao}</p>
                </div>
                <div className="flex items-center justify-between gap-3 lg:justify-end">
                  <Badge className="bg-muted text-foreground">{item.prazo}</Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardView() {
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

  const diagnostic = useQuery<SituationDiagnostic>({
    queryKey: ["situacao-diagnostico"],
    queryFn: async () => {
      const response = await fetch("/api/situacao/diagnostico");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar diagnostico");
      return data;
    },
    retry: false,
    staleTime: 5 * 60 * 1000
  });

  const priorities = useQuery<SituationPriorities>({
    queryKey: ["situacao-prioridades"],
    queryFn: async () => {
      const response = await fetch("/api/situacao/prioridades");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar prioridades");
      return data;
    },
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const historico = useQuery<CevespHistorico>({
    queryKey: ["cevesp-historico-dash"],
    queryFn: async () => {
      const response = await fetch("/api/cevesp/historico");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro");
      return data;
    },
    retry: false,
    staleTime: 10 * 60 * 1000
  });

  const canal = useQuery<EndemicChannelPoint[]>({
    queryKey: ["canal-endemico-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/cevesp/canal-endemico");
      if (!res.ok) return [];
      return res.json();
    },
    retry: false,
    staleTime: 15 * 60 * 1000
  });

  const cevespState = cevespRisk(kpis.data);
  const tracomaState = tracomaRisk(sinan.data);
  const consolidatedByYear = sinan.data?.consolidatedMetricsByYear ?? [];
  const latestConsolidated = consolidatedByYear[consolidatedByYear.length - 1];

  const cevespSparkData = (historico.data?.byYear ?? []).map((r) => ({ ano: r.ano, value: r.casos }));
  const tracomaSparkData = consolidatedByYear.map((r) => ({ ano: r.ano, value: r.positivos }));
  const localAuthMode = process.env.NEXT_PUBLIC_DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Sala de Situação</Badge>
              <Badge className={cevespState.cls}>CEVESP: {cevespState.label}</Badge>
              <Badge className={tracomaState.cls}>Tracoma: {tracomaState.label}</Badge>
              {localAuthMode && <Badge className="border-amber-200 bg-amber-50 text-amber-700">Login desativado</Badge>}
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Vigilância oftalmológica</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Cockpit para priorizar decisões. As análises detalhadas ficam nas páginas de investigação.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                kpis.refetch();
                sinan.refetch();
                diagnostic.refetch();
                priorities.refetch();
                historico.refetch();
              }}
              disabled={kpis.isFetching || sinan.isFetching || diagnostic.isFetching || priorities.isFetching || historico.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${kpis.isFetching || sinan.isFetching || diagnostic.isFetching || priorities.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" asChild>
              <Link href="/territorios">Abrir territórios</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
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
            value={sinan.isFetching ? "..." : formatValue(latestConsolidated?.positivos ?? sinan.data?.totalNottraconet)}
            icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
            tone="amber"
          />
        </div>

        <CanalZoneStrip data={canal.data} loading={canal.isFetching && !canal.data} />

        <AlertsPanel />
        <TodayPrioritiesPanel data={priorities.data} loading={priorities.isLoading} />

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="group flex min-h-20 items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{action.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{action.detail}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Agravos monitorados</CardTitle>
              <CardDescription>Tendência histórica · série completa em Análises</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/conjuntivite" className="block rounded-md border p-3 transition-colors hover:bg-muted/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Conjuntivites</p>
                    <p className="text-xs text-muted-foreground">CEVESP · casos por ano</p>
                  </div>
                  <Badge className={cevespState.cls}>{cevespState.label}</Badge>
                </div>
                {cevespSparkData.length >= 2 && (
                  <div className="mt-2">
                    <MiniSparkline data={cevespSparkData} color="#2563eb" />
                  </div>
                )}
              </Link>
              <Link href="/tracoma" className="block rounded-md border p-3 transition-colors hover:bg-muted/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Tracoma</p>
                    <p className="text-xs text-muted-foreground">SINAN · positivos NOTTRACONET por ano</p>
                  </div>
                  <Badge className={tracomaState.cls}>{tracomaState.label}</Badge>
                </div>
                {tracomaSparkData.length >= 2 && (
                  <div className="mt-2">
                    <MiniSparkline data={tracomaSparkData} color="#d97706" />
                  </div>
                )}
              </Link>
            </CardContent>
          </Card>

          <DataHealthPanel diagnostic={diagnostic.data} />
        </div>

        <Card>
          <CardContent className="flex flex-col gap-2 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2">
              <Database className="h-3.5 w-3.5" />
              Sala sem repetição: decisão aqui, investigação em Análises.
            </span>
            <span>Última atualização CEVESP: {kpis.data?.generatedAt ? new Date(kpis.data.generatedAt).toLocaleString("pt-BR") : "sem atualização"}</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
