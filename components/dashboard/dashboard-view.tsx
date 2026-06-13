"use client";

import { useQuery } from "@tanstack/react-query";
import type { AIProvider } from "@/services/ai/provider";
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
  FileWarning,
  MapPin,
  Microscope,
  RefreshCw,
  ShieldAlert,
  Siren,
  Stethoscope,
  TrendingUp,
  Users
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CevespKpis } from "@/services/cevesp-kpis";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI GPT-4.1-mini",
  anthropic: "Anthropic Claude Haiku",
  gemini: "Google Gemini Flash"
};

const surveillanceAxes = [
  {
    title: "Magnitude",
    description: "Casos, notificações, surtos, internações evitáveis e óbitos quando aplicável.",
    status: "Parcial",
    href: "/notificacoes"
  },
  {
    title: "Tempo",
    description: "Semana epidemiológica, tendência, sazonalidade, canal endêmico e picos inesperados.",
    status: "Operacional",
    href: "/notificacoes"
  },
  {
    title: "Lugar",
    description: "GVE, DRS, município, unidade notificadora, CNES e concentração espacial.",
    status: "Operacional",
    href: "/notificacoes"
  },
  {
    title: "Pessoa",
    description: "Faixa etária, sexo, vulnerabilidades, exposição coletiva e grupos prioritários.",
    status: "Parcial",
    href: "/notificacoes"
  },
  {
    title: "Qualidade",
    description: "Completude, duplicidade, divergência entre bancos, oportunidade e consistência clínica.",
    status: "Crítico",
    href: "/sinan-qualidade"
  },
  {
    title: "Resposta",
    description: "Coleta laboratorial, medidas educativas, afastamento, encaminhamento e encerramento.",
    status: "Parcial",
    href: "/alertas"
  }
];

const diseasePortfolio = [
  {
    name: "Conjuntivites e surtos oculares",
    source: "CEVESP",
    whatToWatch: "aumento semanal, surtos, coletas, escolas, serviços de saúde e municípios silenciosos",
    status: "Monitoramento ativo"
  },
  {
    name: "Tracoma",
    source: "SINAN / TRACONET / NOTTRACONET",
    whatToWatch: "divergência entre bases, forma clínica, tratamento, cirurgia de TT e encerramento",
    status: "Auditoria ativa"
  },
  {
    name: "Outros agravos prioritários",
    source: "A integrar",
    whatToWatch: "incidência, oportunidade de notificação, cobertura territorial, gravidade e resposta",
    status: "Lacuna estrutural"
  }
];

const gaps = [
  "Criar cadastro de agravos monitorados com definição de caso, fonte, periodicidade, indicador principal, limiares e responsável técnico.",
  "Adicionar mapa por município/GVE para detectar concentração espacial e áreas silenciosas sem notificação.",
  "Medir oportunidade: data de início de sintomas, notificação, investigação, coleta, encerramento e tempo até resposta.",
  "Incluir denominadores populacionais para taxas, comparação territorial justa e priorização por risco.",
  "Padronizar matriz de alertas por nível: observação, atenção, investigação imediata e resposta coordenada.",
  "Registrar plano de ação por alerta com responsável, prazo, status, evidência e devolutiva ao território."
];

const weeklyRoutine = [
  "Segunda: atualizar bases, revisar completude e emitir boletim preliminar.",
  "Terça: validar alertas com GVE/município e separar sinais reais de artefatos de dado.",
  "Quarta: priorizar investigação, coleta laboratorial e medidas de controle nos territórios críticos.",
  "Quinta: revisar pendências de encerramento, tratamento, encaminhamentos e ações educativas.",
  "Sexta: consolidar decisão, publicar boletim e registrar plano da semana seguinte."
];

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

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Crítico" || status === "Lacuna estrutural"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "Parcial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-teal-200 bg-teal-50 text-teal-700";
  return <Badge className={cls}>{status}</Badge>;
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
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

  const topMunicipalities = kpis.data?.topMunicipalitiesCurrentWeek ?? [];
  const generatedAt = kpis.data?.generatedAt ? new Date(kpis.data.generatedAt).toLocaleString("pt-BR") : "aguardando atualização";

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Sala de Situação</Badge>
              <Badge className="bg-muted text-foreground">Oftalmologia sanitária</Badge>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Monitoramento de doenças e problemas prioritários</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Painel para gestão pública: identifica sinais de alerta, fragilidades dos dados, territórios prioritários e ações necessárias para vigilância epidemiológica.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => kpis.refetch()} disabled={kpis.isFetching}>
              <RefreshCw className={`h-4 w-4 ${kpis.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button size="sm" asChild>
              <Link href="/notificacoes">Analisar CEVESP</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {kpis.isError && (
          <Card className="border-amber-300 bg-amber-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                Banco CEVESP indisponível neste ambiente
              </CardTitle>
              <CardDescription className="text-amber-800/80">
                Os indicadores dependem da rede da SES-SP, VPN ou cache sincronizado. A ausência de conexão deve ser tratada como risco operacional de vigilância.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <AlertsPanel />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm text-muted-foreground">Casos na SE {kpis.data?.currentWeek.se ?? "atual"}</CardTitle>
              <BarChart2 className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{kpis.isFetching ? "..." : (kpis.data?.currentWeek.cases ?? "-")}</div>
              <DeltaBadge delta={kpis.data?.weekDelta ?? null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm text-muted-foreground">Casos no ano</CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{kpis.isFetching ? "..." : (kpis.data?.currentYear.cases ?? "-")}</div>
              <DeltaBadge delta={kpis.data?.yearDelta ?? null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm text-muted-foreground">Surtos no ano</CardTitle>
              <ShieldAlert className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{kpis.isFetching ? "..." : (kpis.data?.outbreaksCurrentYear ?? "-")}</div>
              <span className="text-xs text-muted-foreground">notificações com surto</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm text-muted-foreground">Coletas biológicas</CardTitle>
              <Microscope className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{kpis.isFetching ? "..." : (kpis.data?.collectionsCurrentYear ?? "-")}</div>
              <span className="text-xs text-muted-foreground">investigação laboratorial registrada</span>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Comparativo semanal</CardTitle>
              <CardDescription>Variação de casos entre a semana epidemiológica atual e a anterior.</CardDescription>
            </CardHeader>
            <CardContent className="h-[260px]">
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
            <CardHeader>
              <CardTitle>Municípios prioritários da semana</CardTitle>
              <CardDescription>Usar esta lista para contato ativo, verificação de surtos e revisão de medidas locais.</CardDescription>
            </CardHeader>
            <CardContent>
              {topMunicipalities.length === 0 ? (
                <div className="flex h-[220px] flex-col items-center justify-center rounded-md border border-dashed text-center text-sm text-muted-foreground">
                  <MapPin className="mb-2 h-8 w-8 opacity-40" />
                  Nenhum município disponível. Sincronize o CEVESP ou revise o cache.
                </div>
              ) : (
                <div className="space-y-2">
                  {topMunicipalities.map((item, index) => (
                    <div key={item.name} className="flex items-center justify-between rounded-md border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{index + 1}. {item.name}</p>
                        <p className="text-xs text-muted-foreground">priorizar validação territorial</p>
                      </div>
                      <span className="text-lg font-semibold tabular-nums">{item.cases}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Carteira de agravos monitorados</CardTitle>
            <CardDescription>O projeto precisa deixar explícito o que monitora, de onde vem o dado e qual problema deve ser identificado.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-3">
            {diseasePortfolio.map((item) => (
              <div key={item.name} className="rounded-md border p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{item.name}</h3>
                    <p className="text-xs text-muted-foreground">{item.source}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="text-sm text-muted-foreground">{item.whatToWatch}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle>Eixos mínimos de vigilância</CardTitle>
              <CardDescription>Sem esses eixos, o sistema mostra números, mas não orienta decisão pública.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {surveillanceAxes.map((axis) => (
                <div key={axis.title} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{axis.title}</h3>
                    <StatusBadge status={axis.status} />
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">{axis.description}</p>
                  <ActionLink href={axis.href} label="Abrir módulo" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lacunas críticas a implementar</CardTitle>
              <CardDescription>Itens que faltam para transformar análise em monitoramento programático.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {gaps.map((gap) => (
                <div key={gap} className="flex gap-3 rounded-md border p-3 text-sm">
                  <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>{gap}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Rotina semanal de monitoramento</CardTitle>
              <CardDescription>Agenda operacional para não depender apenas de consultas avulsas.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {weeklyRoutine.map((item) => (
                <div key={item} className="flex gap-3 rounded-md border p-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  <span>{item}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Próximas decisões</CardTitle>
              <CardDescription>Ações de gestor para fechar o ciclo vigilância-resposta.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ActionLink href="/alertas" label="Reconhecer alertas pendentes" />
              <ActionLink href="/sinan-qualidade" label="Auditar qualidade SINAN" />
              <ActionLink href="/cevesp-qualidade" label="Revisar qualidade CEVESP" />
              <ActionLink href="/boletins" label="Consultar boletins" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Governança e fontes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {[
              { icon: Database, label: "Dados", value: kpis.isError ? "CEVESP offline/cache" : "CEVESP + SINAN importado" },
              { icon: Stethoscope, label: "Escopo atual", value: "Conjuntivites e tracoma" },
              { icon: Siren, label: "Resposta", value: "Alertas, boletins e auditorias" },
              { icon: Users, label: "IA", value: PROVIDER_LABELS[settings.data?.ai_provider ?? "openai"] }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    <p className="text-xs font-medium uppercase">{item.label}</p>
                  </div>
                  <p className="font-medium">{item.value}</p>
                </div>
              );
            })}
          </CardContent>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            Última atualização dos indicadores: {generatedAt}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
