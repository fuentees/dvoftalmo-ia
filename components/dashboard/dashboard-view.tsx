"use client";

import { useQuery } from "@tanstack/react-query";
import type { AIProvider } from "@/services/ai/provider";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart2,
  Microscope,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CevespKpis } from "@/services/cevesp-kpis";

const PIE_COLORS = ["#2563eb", "#dc2626"];

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-muted-foreground">sem comparativo</span>;
  const up = delta > 0;
  const neutral = delta === 0;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${neutral ? "text-muted-foreground" : up ? "text-red-600" : "text-teal-600"}`}>
      {neutral ? null : up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {delta > 0 ? "+" : ""}{delta}% vs período anterior
    </span>
  );
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI GPT-4.1-mini",
  anthropic: "Anthropic Claude Haiku",
  gemini: "Google Gemini Flash"
};

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

  const settings = useQuery<{ ai_provider: AIProvider }>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.ok ? res.json() : { ai_provider: "openai" as AIProvider };
    },
    staleTime: 60 * 1000
  });

  const weekData = kpis.data
    ? [
        { label: `SE ${kpis.data.previousWeek.se}`, cases: kpis.data.previousWeek.cases },
        { label: `SE ${kpis.data.currentWeek.se}`, cases: kpis.data.currentWeek.cases }
      ]
    : [];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Vigilância Epidemiológica das Conjuntivites — CEVESP/SP</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => kpis.refetch()} disabled={kpis.isFetching}>
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </Button>
      </div>
      <div className="space-y-6 p-6">

      {kpis.isError && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-700">
              <AlertTriangle className="h-4 w-4" />
              Banco CEVESP indisponível
            </CardTitle>
            <CardDescription className="text-yellow-700/80">
              O banco MySQL do CEVESP (192.168.1.204) não está acessível neste ambiente.
              Os KPIs e gráficos precisam ser executados dentro da rede da SES-SP ou via VPN.
              O chat com IA funciona normalmente.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* ── KPIs principais ──────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm text-muted-foreground">Casos — SE {kpis.data?.currentWeek.se ?? "atual"}</CardTitle>
            <BarChart2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{kpis.isFetching ? "..." : (kpis.data?.currentWeek.cases ?? "—")}</div>
            <DeltaBadge delta={kpis.data?.weekDelta ?? null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm text-muted-foreground">Casos — ano {kpis.data?.currentYear.year ?? new Date().getFullYear()}</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{kpis.isFetching ? "..." : (kpis.data?.currentYear.cases ?? "—")}</div>
            <DeltaBadge delta={kpis.data?.yearDelta ?? null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm text-muted-foreground">Surtos — ano atual</CardTitle>
            <ShieldAlert className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{kpis.isFetching ? "..." : (kpis.data?.outbreaksCurrentYear ?? "—")}</div>
            <span className="text-xs text-muted-foreground">notificações com surto</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm text-muted-foreground">Coletas biológicas — ano</CardTitle>
            <Microscope className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{kpis.isFetching ? "..." : (kpis.data?.collectionsCurrentYear ?? "—")}</div>
            <span className="text-xs text-muted-foreground">coletas registradas</span>
          </CardContent>
        </Card>
      </div>

      {/* ── Gráficos ─────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Comparativo SE atual × anterior</CardTitle>
            <CardDescription>Total de casos nas duas últimas semanas epidemiológicas</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => [value, "Casos"]} />
                <Bar dataKey="cases" fill="#0f766e" name="Casos" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ano atual × anterior</CardTitle>
            <CardDescription>Total acumulado no ano</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={
                  kpis.data
                    ? [
                        { label: String(kpis.data.previousYear.year), cases: kpis.data.previousYear.cases },
                        { label: String(kpis.data.currentYear.year), cases: kpis.data.currentYear.cases }
                      ]
                    : []
                }
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => [value, "Casos"]} />
                <Bar dataKey="cases" fill="#ca8a04" name="Casos" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Top municípios semana atual ──────────────────────── */}
      {kpis.data && kpis.data.topMunicipalitiesCurrentWeek.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Municípios com mais casos — SE {kpis.data.currentWeek.se}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kpis.data.topMunicipalitiesCurrentWeek} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => [value, "Casos"]} />
                <Bar dataKey="cases" fill="#0f766e" name="Casos" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Informações do sistema ──────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Sobre o agente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Banco de dados", value: kpis.isError ? "CEVESP — offline neste ambiente" : "CEVESP — MariaDB externo (leitura)" },
            { label: "IA utilizada", value: PROVIDER_LABELS[settings.data?.ai_provider ?? "openai"] + " + embeddings" },
            { label: "Especialidade", value: "Vigilância das Conjuntivites — SP" },
            { label: "Cobertura", value: "Estado de São Paulo — todas as GVEs" }
          ].map((item) => (
            <div key={item.label} className="rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-1 font-medium">{item.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
