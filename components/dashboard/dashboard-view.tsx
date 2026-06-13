"use client";

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
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  CheckCircle2,
  Database,
  MapPin,
  Microscope,
  RefreshCw,
  ShieldAlert,
  TrendingUp
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import type { CevespKpis } from "@/services/cevesp-kpis";

const nextActions = [
  { label: "Validar alertas", href: "/alertas", tone: "red" },
  { label: "Auditar SINAN", href: "/sinan-qualidade", tone: "amber" },
  { label: "Qualidade CEVESP", href: "/cevesp-qualidade", tone: "amber" },
  { label: "Gerar boletim", href: "/boletins", tone: "teal" }
];

const watchlist = [
  { label: "Conjuntivites", source: "CEVESP", status: "Ativo" },
  { label: "Tracoma", source: "SINAN", status: "Auditoria" },
  { label: "Outros agravos", source: "Pendente", status: "Integrar" }
];

const missingSignals = [
  "Mapa por município/GVE",
  "Taxas com população",
  "Oportunidade da notificação",
  "Plano de ação por alerta"
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

function riskState(data?: CevespKpis) {
  if (!data) return { label: "Sem dados", cls: "bg-muted text-foreground", note: "sincronizar base" };
  if ((data.weekDelta ?? 0) >= 30 || data.outbreaksCurrentYear > 0) {
    return { label: "Atenção", cls: "border-red-200 bg-red-50 text-red-700", note: "validar território" };
  }
  if ((data.weekDelta ?? 0) >= 10) {
    return { label: "Observação", cls: "border-amber-200 bg-amber-50 text-amber-700", note: "acompanhar tendência" };
  }
  return { label: "Estável", cls: "border-teal-200 bg-teal-50 text-teal-700", note: "manter rotina" };
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
  tone?: "default" | "red";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold tabular-nums ${tone === "red" ? "text-red-600" : ""}`}>{value}</div>
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

  const weekData = kpis.data
    ? [
        { label: `SE ${kpis.data.previousWeek.se}`, cases: kpis.data.previousWeek.cases },
        { label: `SE ${kpis.data.currentWeek.se}`, cases: kpis.data.currentWeek.cases }
      ]
    : [];

  const risk = riskState(kpis.data);
  const topMunicipalities = kpis.data?.topMunicipalitiesCurrentWeek ?? [];
  const generatedAt = kpis.data?.generatedAt
    ? new Date(kpis.data.generatedAt).toLocaleString("pt-BR")
    : "sem atualização";

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Sala de Situação</Badge>
              <Badge className={risk.cls}>{risk.label}</Badge>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Vigilância oftalmológica</h1>
            <p className="mt-1 text-sm text-muted-foreground">Estado atual, território prioritário e próxima ação.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => kpis.refetch()} disabled={kpis.isFetching}>
              <RefreshCw className={`h-4 w-4 ${kpis.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" asChild>
              <Link href="/notificacoes">Investigar CEVESP</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        {kpis.isError && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex items-start gap-3 py-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">CEVESP indisponível</p>
                <p className="text-amber-800/80">Sem rede/cache sincronizado, a sala opera apenas com módulos locais.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <AlertsPanel />

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
                <Badge className={risk.cls}>{risk.note}</Badge>
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
                <div className="flex h-[250px] flex-col items-center justify-center rounded-md border border-dashed text-center text-sm text-muted-foreground">
                  <MapPin className="mb-2 h-8 w-8 opacity-40" />
                  Sem ranking disponível
                </div>
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

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr_0.8fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Monitorados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {watchlist.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.source}</p>
                  </div>
                  <Badge className="bg-muted text-foreground">{item.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Fila do gestor</CardTitle>
              <CardDescription>Ações que fecham vigilância e resposta</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {nextActions.map((action) => (
                <ActionButton key={action.href} href={action.href} label={action.label} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Sinais ausentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {missingSignals.map((signal) => (
                <div key={signal} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-amber-600" />
                  <span>{signal}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-2 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2">
              <Database className="h-3.5 w-3.5" />
              Base: CEVESP + SINAN importado
            </span>
            <span>Última atualização: {generatedAt}</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
