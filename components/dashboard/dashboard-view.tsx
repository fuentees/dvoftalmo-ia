"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import type { CevespKpis } from "@/services/cevesp-kpis";
import type { CevespHistorico } from "@/lib/external/supabase-cevesp";
import type { EndemicChannelPoint } from "@/services/cevesp-endemic";
import { pickCurrentChannelPoint } from "@/lib/epi-week";
import { classifyChannelPoint, CHANNEL_ZONE_LABELS } from "@/lib/cevesp-channel";

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
  partial?: boolean;
  unavailableSources?: string[];
  priorities: SituationPriority[];
  summary: { total: number; critica: number; alta: number; media: number };
};

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
  if (data.currentWeek.notifications === 0) return { label: "Sem notificações na SE", cls: "bg-muted text-foreground" };
  if ((data.weekDelta ?? 0) >= 30 || data.outbreaksCurrentYear > 0) {
    return { label: "Atenção", cls: "border-red-200 bg-red-50 text-red-700" };
  }
  if ((data.weekDelta ?? 0) >= 10) {
    return { label: "Observação", cls: "border-amber-200 bg-amber-50 text-amber-700" };
  }
  return { label: data.weekDelta == null ? "Sem comparação semanal" : "Sem aumento detectado", cls: "bg-muted text-foreground" };
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
  return { label: "Sem alertas de qualidade", cls: "bg-muted text-foreground" };
}

function KpiCard({
  href,
  label,
  value,
  caption,
  pill,
  tone = "default"
}: {
  href: string;
  label: string;
  value: string;
  caption?: React.ReactNode;
  pill?: { text: string; cls: string };
  tone?: "default" | "alert";
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col gap-2 rounded-xl border bg-card p-[18px] transition-colors hover:border-primary/50 ${tone === "alert" ? "border-orange-200 dark:border-orange-900" : ""}`}
    >
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className={`num text-[32px] font-semibold leading-none ${tone === "alert" ? "text-orange-700 dark:text-orange-300" : ""}`}>{value}</span>
      {caption && <span className="text-[13px] text-muted-foreground">{caption}</span>}
      {pill && <span className={`self-start rounded-md px-2 py-0.5 text-xs font-medium ${pill.cls}`}>{pill.text}</span>}
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

function DataHealthPanel({ diagnostic, error = false }: { diagnostic?: SituationDiagnostic; error?: boolean }) {
  const checks = diagnostic?.checks ?? [];
  const statusLabel = diagnostic?.status === "ok" ? "Operacional" : diagnostic?.status === "error" ? "Erro" : "Atenção";

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Saúde da sala</h2>
        <Badge className={diagnosticStyle(diagnostic?.status === "error" ? "error" : diagnostic?.status === "ok" ? "ok" : "warning")}>
          {statusLabel}
        </Badge>
      </div>
      {error && <p role="alert" className="text-sm text-amber-800">Diagnóstico indisponível.</p>}
      <ul className="divide-y">
        {(checks.length ? checks : [
          { label: "CEVESP", status: "warning" as const, message: "Verificando..." },
          { label: "SINAN Tracoma", status: "warning" as const, message: "Verificando..." },
          { label: "População IBGE", status: "warning" as const, message: "Verificando..." }
        ]).map((check) => (
          <li key={check.label} className="flex items-start gap-2.5 py-2.5">
            {check.status === "ok"
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              : <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${check.status === "error" ? "text-red-600" : "text-orange-600"}`} aria-hidden="true" />}
            <div className="min-w-0">
              <p className="text-sm font-medium">{check.label}</p>
              <p className="text-[13px] text-muted-foreground">{check.message}</p>
              {check.detail && <p className="line-clamp-2 text-xs text-muted-foreground">{check.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TodayPrioritiesPanel({
  data,
  loading,
  error
}: {
  data?: SituationPriorities;
  loading: boolean;
  error: boolean;
}) {
  const priorities = data?.priorities ?? [];

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Prioridades de hoje</h2>
        <div className="flex flex-wrap gap-1.5">
          <Badge className={data?.summary.critica ? "border-red-200 bg-red-50 text-red-700" : "border-teal-200 bg-teal-50 text-teal-700"}>
            {data?.summary.critica ?? "—"} críticas
          </Badge>
          <Badge className="border-amber-200 bg-amber-50 text-amber-700">{data?.summary.alta ?? "—"} altas</Badge>
        </div>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-amber-300 p-4 text-sm text-amber-800">Prioridades indisponíveis no momento.</p>
      ) : loading ? (
        <ol className="space-y-2.5" aria-busy="true" aria-label="Carregando prioridades">
          {[0, 1, 2].map((i) => <li key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
        </ol>
      ) : priorities.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          {data?.partial ? "Análise incompleta: não é possível descartar pendências." : "Nenhuma prioridade nos dados consultados."}
        </p>
      ) : (
        <ol className="space-y-2.5">
          {priorities.slice(0, 5).map((item, index) => (
            <li key={item.id}>
              <Link
                href={item.evidenciaHref}
                className={`group flex gap-3 rounded-lg p-3 transition-colors ${index === 0 && item.level === "critica" ? "bg-orange-50 dark:bg-orange-950/40" : "bg-muted/60 hover:bg-muted"}`}
              >
                <span className={`num pt-0.5 text-[13px] font-semibold ${index === 0 && item.level === "critica" ? "text-orange-700" : "text-muted-foreground"}`}>{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold">{item.motivo} · {item.territorio}</p>
                  <p className="text-[13px] text-muted-foreground">{item.acao}</p>
                  {item.detalhe && <p className="text-xs text-muted-foreground">{item.detalhe}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge className={priorityStyle(item.level)}>{item.prazo}</Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
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
      if (!res.ok) throw new Error("Não foi possível consultar o canal endêmico.");
      return res.json();
    },
    retry: false,
    staleTime: 15 * 60 * 1000
  });

  const cevespState = cevespRisk(kpis.data);
  const tracomaState = tracomaRisk(sinan.data);
  const consolidatedByYear = sinan.data?.consolidatedMetricsByYear ?? [];
  const latestConsolidated = consolidatedByYear.reduce<(typeof consolidatedByYear)[number] | undefined>(
    (latest, row) => !latest || row.ano > latest.ano ? row : latest, undefined
  );

  const cevespSparkData = (historico.data?.byYear ?? []).map((r) => ({ ano: r.ano, value: r.casos }));
  const tracomaSparkData = consolidatedByYear.map((r) => ({ ano: r.ano, value: r.positivos }));
  const localAuthMode = process.env.NEXT_PUBLIC_DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";

  const canalPoint = canal.data ? pickCurrentChannelPoint(canal.data) : null;
  const canalZone = canalPoint ? classifyChannelPoint(canalPoint) : null;
  const lastUpdate = kpis.data?.source === "cache" ? kpis.data.lastSync : kpis.data?.generatedAt;
  const anyFetching = kpis.isFetching || sinan.isFetching || diagnostic.isFetching || priorities.isFetching || historico.isFetching || canal.isFetching;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-[28px] font-bold tracking-tight">Sala de Situação</h1>
          <p className="text-[15px] text-muted-foreground">
            O que pede ação nesta semana, em conjuntivite e tracoma.
            {lastUpdate && <> Dados do CEVESP atualizados em {new Date(lastUpdate).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}.</>}
          </p>
          {localAuthMode && <Badge className="border-amber-200 bg-amber-50 text-amber-700">Login desativado (local)</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => {
              kpis.refetch();
              sinan.refetch();
              diagnostic.refetch();
              priorities.refetch();
              historico.refetch();
              canal.refetch();
            }}
            disabled={anyFetching}
          >
            <RefreshCw className={`h-4 w-4 ${anyFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" className="h-11" asChild>
            <Link href="/boletins">Gerar boletim</Link>
          </Button>
          <Button className="h-11" asChild>
            <Link href="/alertas">Ver alertas</Link>
          </Button>
        </div>
      </header>

      {(kpis.isError || sinan.isError || diagnostic.isError || priorities.isError || historico.isError || canal.isError) && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Alguns indicadores estão indisponíveis agora. Os demais continuam válidos.
        </p>
      )}

      <section aria-label="Indicadores da semana" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          href="/conjuntivite"
          label={`Conjuntivite · SE ${canalPoint?.se ?? kpis.data?.currentWeek.se ?? "—"}`}
          value={canalPoint?.currentYear != null ? formatValue(canalPoint.currentYear) : kpis.isLoading ? "…" : formatValue(kpis.data?.currentWeek.cases)}
          caption={canalPoint?.currentIncidence != null ? `casos · ${canalPoint.currentIncidence.toLocaleString("pt-BR")} por 100 mil hab.` : "casos na semana"}
          pill={canalZone ? {
            text: `Canal endêmico: ${CHANNEL_ZONE_LABELS[canalZone]}`,
            cls: canalZone === "acima" ? "bg-red-50 text-red-700" : canalZone === "insuficiente" ? "bg-orange-50 text-orange-700" : "bg-emerald-50 text-emerald-800"
          } : undefined}
        />
        <KpiCard
          href="/conjuntivite"
          label={`Conjuntivite · ${kpis.data?.currentYear.year ?? "ano"} até a SE ${kpis.data?.comparisonThroughSe ?? "—"}`}
          value={kpis.isLoading ? "…" : formatValue(kpis.data?.currentYear.cases)}
          caption={<DeltaBadge delta={kpis.data?.yearDelta ?? null} />}
        />
        <KpiCard
          href="/conjuntivite"
          label={`Surtos · ${kpis.data?.currentYear.year ?? ""}`.trim()}
          value={kpis.isLoading ? "…" : formatValue(kpis.data?.outbreaksCurrentYear)}
          caption={kpis.data ? `${formatValue(kpis.data.collectionsCurrentYear)} coletas de material` : undefined}
          tone={(kpis.data?.outbreaksCurrentYear ?? 0) > 0 ? "alert" : "default"}
        />
        <KpiCard
          href="/tracoma"
          label={`Tracoma · ${latestConsolidated?.ano ?? ""}`.trim()}
          value={sinan.isLoading ? "…" : formatValue(latestConsolidated?.examinados)}
          caption={latestConsolidated ? `examinados · ${formatValue(latestConsolidated.positivos)} positivos` : "examinados"}
          pill={{ text: tracomaState.label, cls: tracomaState.cls }}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <AlertsPanel />
          {priorities.data?.partial && (
            <p role="alert" className="rounded-lg border border-amber-300 p-3 text-sm text-amber-800">
              Prioridades calculadas com dados parciais. Fontes indisponíveis: {priorities.data.unavailableSources?.join(", ")}.
            </p>
          )}
          <TodayPrioritiesPanel data={priorities.data} loading={priorities.isLoading} error={priorities.isError} />

          <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-semibold">Municípios com mais casos na SE {kpis.data?.currentWeek.se ?? ""}</h2>
              <Link href="/territorios" className="text-sm font-medium text-primary">Ver territórios</Link>
            </div>
            {kpis.data?.topMunicipalitiesCurrentWeek.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2.5 py-2 font-semibold">Município</th>
                      <th className="px-2.5 py-2 text-right font-semibold">Casos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpis.data.topMunicipalitiesCurrentWeek.slice(0, 6).map((m) => (
                      <tr key={m.name} className="border-t">
                        <td className="px-2.5 py-2.5 font-medium">{m.name}</td>
                        <td className="num px-2.5 py-2.5 text-right">{formatValue(m.cases)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{kpis.isLoading ? "Carregando…" : "Sem notificações na semana até agora."}</p>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
            <h2 className="text-[17px] font-semibold">Agravos</h2>
            <Link href="/conjuntivite" className="block rounded-lg border p-3 transition-colors hover:bg-muted/50">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Conjuntivite</p>
                  <p className="text-xs text-muted-foreground">CEVESP · casos por ano</p>
                </div>
                <Badge className={cevespState.cls}>{cevespState.label}</Badge>
              </div>
              {cevespSparkData.length >= 2 && <div className="mt-2"><MiniSparkline data={cevespSparkData} color="#0B5D57" /></div>}
            </Link>
            <Link href="/tracoma" className="block rounded-lg border p-3 transition-colors hover:bg-muted/50">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Tracoma</p>
                  <p className="text-xs text-muted-foreground">SINAN · positivos por ano</p>
                </div>
                <Badge className={tracomaState.cls}>{tracomaState.label}</Badge>
              </div>
              {tracomaSparkData.length >= 2 && <div className="mt-2"><MiniSparkline data={tracomaSparkData} color="#C4620F" /></div>}
            </Link>
          </section>
          <DataHealthPanel diagnostic={diagnostic.data} error={diagnostic.isError} />
        </div>
      </div>
    </div>
  );
}
