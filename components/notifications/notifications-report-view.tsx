"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Download,
  FileText,
  LineChart,
  MessageSquareText,
  RefreshCw
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RateMap, type RateMapRow } from "@/components/epidemiology/rate-map";
import { EndemicChannelChart, EpidemicCharts } from "@/components/notifications/epidemic-charts";
import { listarMunicipiosPorGve } from "@/lib/municipios-sp";

type HubTab = "situacao" | "consulta" | "canal" | "saidas";

type ReportData = {
  generatedAt: string;
  totalRowsInDatabase: number;
  sampledRows: number;
  indicators: {
    notifications: number;
    totalCases: number;
    reportingMunicipalities: number;
    topMunicipalities: Array<{ name: string; total: number }>;
    topGves: Array<{ name: string; total: number }>;
    topUnits: Array<{ name: string; total: number }>;
    sexDistribution: Array<{ label: string; total: number }>;
    ageDistribution: Array<{ label: string; total: number }>;
    outbreakNotifications: number;
    outbreakTotal: number;
    biologicalCollectionNotifications: number;
    biologicalCollectionTotal: number;
    educationalActions: number;
    trainings: number;
    symptomaticStaffRemoval: number;
    specializedReferrals: number;
    weeklySeries: Array<{ week: string; total: number }>;
  };
  previousYear?: {
    ano: number;
    totalCases: number;
    notifications: number;
    reportingMunicipalities: number;
  } | null;
  alerts: Array<{ title: string; severity: "alta" | "media" | "baixa"; description: string }>;
  interpretation: string[];
  bulletinSections: { recomendacoes: string[] };
  columns: Array<{ name: string; type: string; missing: number; topValues: Array<{ value: string; count: number }> }>;
};

type QualityRecord = {
  recordId: string;
  controlaSubmit?: string | null;
  dtNotificacao?: string | null;
  semEpidemio?: number | string | null;
  ano?: number | null;
  municipio?: string | null;
  gve?: string | null;
  totalCaso?: number | null;
  issue: string;
  issueType?: string;
  suggestedField?: string | null;
  suggestedValue?: string | null;
};

type QualityData = {
  total: number;
  filteredTotal?: number;
  records?: QualityRecord[];
  byType: Record<string, number>;
  byGve: Array<{ gve: string; count: number }>;
  byMunicipio: Array<{ municipio: string; gve: string | null; count: number }>;
};

type CevespRatesData = {
  missingPopulation?: boolean;
  message?: string;
  analysisYear?: number;
  populationYear?: number | null;
  byMunicipality?: RateMapRow[];
  byGve?: RateMapRow[];
  mapRows?: RateMapRow[];
  methodology?: string;
};

type AskData = {
  metricLabel?: string;
  timeLabel?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  interpretation?: string[];
  understanding?: {
    metric?: string;
    period?: string;
    temporalGrouping?: string;
    dimensions?: string[];
    filters?: string[];
    source?: string;
    confidence?: string;
    warnings?: string[];
  };
  monthlyReport?: {
    totalCases: number;
    gveSections: Array<{ gve: string; rows: Array<Record<string, unknown>> }>;
    topGves: Array<{ gve: string; total: number }>;
    statewideRows: Array<Record<string, unknown>>;
    methodology: string[];
  };
  weeklyReport?: {
    totalCases: number;
    columns: string[];
    pivotRows: Array<Record<string, unknown>>;
    methodology: string[];
  };
};

const tabs: Array<{ id: HubTab; label: string; icon: React.ElementType }> = [
  { id: "situacao", label: "Situação", icon: BarChart3 },
  { id: "consulta", label: "Consulta", icon: MessageSquareText },
  { id: "canal", label: "Canal", icon: LineChart },
  { id: "saidas", label: "Saídas", icon: FileText }
];

const guidedQuestions = [
  "Total de casos por município nos últimos 5 anos separado por ano",
  "Total de casos por GVE dos últimos 5 anos por mês, com total geral",
  "Casos por semana epidemiológica no ano atual por GVE",
  "Municípios com maior número de surtos este ano",
  "Distribuição por sexo e faixa etária no último ano",
  "Taxa de incidência por município no último ano"
];

function num(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

function pct(part: number, total: number) {
  if (!total) return "0,0%";
  return `${((part / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function sanitizeSe(value: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(53, Math.max(1, Math.trunc(parsed)));
}

function riskFromReport(report?: ReportData, quality?: QualityData) {
  const highAlerts = report?.alerts.filter((item) => item.severity === "alta").length ?? 0;
  const qualityTotal = quality?.total ?? 0;
  if (highAlerts > 0 || qualityTotal >= 100) return { label: "Atenção alta", cls: "border-red-200 bg-red-50 text-red-700" };
  if ((report?.alerts.length ?? 0) > 0 || qualityTotal > 0) return { label: "Monitorar", cls: "border-amber-200 bg-amber-50 text-amber-700" };
  return { label: "Estável", cls: "border-green-200 bg-green-50 text-green-700" };
}

function MetricCard({ label, value, detail, tone = "default", change }: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "default" | "red" | "amber" | "green";
  change?: { pct: number; prevAno: number };
}) {
  const toneClass = {
    default: "",
    red: "border-red-200 bg-red-50",
    amber: "border-amber-200 bg-amber-50",
    green: "border-green-200 bg-green-50"
  }[tone];
  return (
    <Card className={toneClass}>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{typeof value === "number" ? num(value) : value}</div>
        {change != null && (
          <div className={`mt-0.5 text-xs font-medium ${change.pct > 0 ? "text-red-600" : change.pct < 0 ? "text-green-600" : "text-muted-foreground"}`}>
            {change.pct > 0 ? "▲" : change.pct < 0 ? "▼" : "="} {Math.abs(change.pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs {change.prevAno}
          </div>
        )}
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}

function RankingList({ title, items, valueLabel = "casos" }: {
  title: string;
  items: Array<{ name: string; total: number }>;
  valueLabel?: string;
}) {
  const max = Math.max(...items.map((item) => item.total), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.slice(0, 8).map((item) => (
          <div key={item.name} className="space-y-1">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate">{item.name}</span>
              <strong className="tabular-nums">{num(item.total)} {valueLabel}</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round((item.total / max) * 100))}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ResultTable({ title, columns, rows, limit = 80 }: {
  title?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  limit?: number;
}) {
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              {columns.map((key) => <th key={key} className="px-3 py-2 font-medium">{key}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, index) => {
              const isTotal = Object.values(row).some((value) => String(value).toLowerCase() === "total");
              return (
                <tr key={index} className={`border-b last:border-0 ${isTotal ? "bg-muted/40 font-semibold" : ""}`}>
                  {columns.map((key) => <td key={key} className="px-3 py-2">{String(row[key] ?? "")}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <p className="text-xs text-muted-foreground">Exibindo {limit} de {rows.length.toLocaleString("pt-BR")} linhas. Use exportação para tabela completa.</p>
      )}
    </div>
  );
}

function CevespRatesPanel({ data }: { data: CevespRatesData }) {
  const hasGve = (data.byGve?.length ?? 0) > 0;
  const [view, setView] = useState<"municipio" | "gve">("municipio");

  return (
    <div className="space-y-3">
      {hasGve && (
        <div className="flex w-fit gap-1 rounded-lg border bg-muted/30 p-1">
          <button
            onClick={() => setView("municipio")}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${view === "municipio" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
          >
            Por Município
          </button>
          <button
            onClick={() => setView("gve")}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${view === "gve" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
          >
            Por GVE
          </button>
        </div>
      )}
      {view === "municipio" && (
        <RateMap
          title={`Mapa operacional de incidencia municipal${data.analysisYear ? ` - ${data.analysisYear}` : ""}`}
          description={`Casos de conjuntivite por 100 mil habitantes. Populacao IBGE ${data.populationYear ?? "-"}.`}
          rows={data.mapRows ?? data.byMunicipality ?? []}
          valueKey="incidencia100k"
          valueLabel="por 100 mil"
          missingPopulation={data.missingPopulation}
          message={data.message}
          tableColumns={[
            { key: "municipio", label: "Municipio" },
            { key: "gve", label: "GVE" },
            { key: "casos", label: "Casos" },
            { key: "populacao", label: "Populacao" },
            { key: "incidencia100k", label: "Incidencia/100 mil", decimals: 2 }
          ]}
        />
      )}
      {hasGve && view === "gve" && (
        <ResultTable
          title="Incidencia por GVE"
          columns={["gve", "casos", "populacao", "incidencia100k"]}
          rows={(data.byGve ?? []).map((row) => ({
            gve: row.gve,
            casos: row.casos,
            populacao: row.populacao,
            incidencia100k: Number(row.incidencia100k ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })
          }))}
          limit={40}
        />
      )}
    </div>
  );
}

export function NotificationsReportView() {
  const [tab, setTab] = useState<HubTab>("situacao");
  const [question, setQuestion] = useState("Total de casos por GVE dos últimos 5 anos por mês");
  const [showEndemic, setShowEndemic] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | undefined>(undefined);
  const [selectedGve, setSelectedGve] = useState<string>("");
  const [seInicio, setSeInicio] = useState<number | undefined>(undefined);
  const [seFim, setSeFim] = useState<number | undefined>(undefined);
  const [selectedMunicipio, setSelectedMunicipio] = useState<string>("");
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(selectedGve), [selectedGve]);
  const seStart = seInicio != null && seFim != null ? Math.min(seInicio, seFim) : seInicio;
  const seEnd = seInicio != null && seFim != null ? Math.max(seInicio, seFim) : seFim;

  const anosQuery = useQuery<{ anos: number[] }>({
    queryKey: ["cevesp-anos"],
    queryFn: async () => {
      const res = await fetch("/api/cevesp/anos");
      return res.json() as Promise<{ anos: number[] }>;
    },
    staleTime: 10 * 60 * 1000
  });

  const gvesQuery = useQuery<{ gves: string[] }>({
    queryKey: ["cevesp-gves", selectedYear],
    queryFn: async () => {
      const url = selectedYear ? `/api/cevesp/gves?ano=${selectedYear}` : "/api/cevesp/gves";
      const res = await fetch(url);
      return res.json() as Promise<{ gves: string[] }>;
    },
    staleTime: 10 * 60 * 1000
  });

  function buildQueryParams() {
    const params = new URLSearchParams();
    if (selectedYear) params.set("ano", String(selectedYear));
    if (selectedGve) params.set("gve", selectedGve);
    if (selectedMunicipio) params.set("municipio", selectedMunicipio);
    if (seStart != null) params.set("seInicio", String(seStart));
    if (seEnd != null) params.set("seFim", String(seEnd));
    return params.toString();
  }

  const report = useQuery<ReportData>({
    queryKey: ["notifications-report", selectedYear, selectedGve, selectedMunicipio, seStart, seEnd],
    queryFn: async () => {
      const qs = buildQueryParams();
      const response = await fetch(`/api/notificacoes/relatorio${qs ? `?${qs}` : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao gerar relatorio");
      return data as ReportData;
    },
    staleTime: 5 * 60 * 1000
  });

  const quality = useQuery<QualityData>({
    queryKey: ["cevesp-qualidade-resumo", selectedYear, selectedGve, selectedMunicipio, seStart, seEnd],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200" });
      if (selectedYear) params.set("ano", String(selectedYear));
      if (selectedGve) params.set("gve", selectedGve);
      if (selectedMunicipio) params.set("municipio", selectedMunicipio);
      if (seStart != null) params.set("seInicio", String(seStart));
      if (seEnd != null) params.set("seFim", String(seEnd));
      const response = await fetch(`/api/cevesp/qualidade?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Erro ao carregar qualidade");
      return data as QualityData;
    },
    staleTime: 5 * 60 * 1000
  });

  const endemic = useQuery({
    queryKey: ["canal-endemico"],
    queryFn: async () => {
      const response = await fetch("/api/cevesp/canal-endemico");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao calcular canal endemico");
      return data;
    },
    enabled: showEndemic || tab === "canal"
  });

  const rates = useQuery<CevespRatesData>({
    queryKey: ["cevesp-taxas", selectedYear, selectedGve, selectedMunicipio, seStart, seEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedYear) params.set("ano", String(selectedYear));
      if (selectedGve) params.set("gve", selectedGve);
      if (selectedMunicipio) params.set("municipio", selectedMunicipio);
      if (seStart != null) params.set("seInicio", String(seStart));
      if (seEnd != null) params.set("seFim", String(seEnd));
      const qs = params.toString();
      const response = await fetch(`/api/cevesp/taxas${qs ? `?${qs}` : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao calcular taxas");
      return data as CevespRatesData;
    },
    staleTime: 5 * 60 * 1000
  });

  const ask = useMutation<AskData>({
    mutationFn: async () => {
      const response = await fetch("/api/notificacoes/pergunta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao consultar banco");
      return data as AskData;
    }
  });

  const risk = riskFromReport(report.data, quality.data);
  const totalCases = report.data?.indicators.totalCases ?? 0;
  const outbreakRate = pct(report.data?.indicators.outbreakNotifications ?? 0, report.data?.indicators.notifications ?? 0);

  const prevYear = report.data?.previousYear ?? null;
  const casesChange = prevYear && prevYear.totalCases > 0
    ? { pct: ((totalCases - prevYear.totalCases) / prevYear.totalCases) * 100, prevAno: prevYear.ano }
    : null;
  const reportingMunicipalities = report.data?.indicators.reportingMunicipalities ?? 0;
  const muniChange = prevYear && prevYear.reportingMunicipalities > 0
    ? { pct: ((reportingMunicipalities - prevYear.reportingMunicipalities) / prevYear.reportingMunicipalities) * 100, prevAno: prevYear.ano }
    : null;
  const SP_MUNICIPIOS = 645;
  function downloadBoletim() {
    const qs = buildQueryParams();
    window.open(`/api/cevesp/boletim${qs ? `?${qs}` : ""}`, "_blank");
  }

  function printPdf() {
    window.print();
  }

  function downloadSituacaoCsv() {
    const escape = (v: unknown) => {
      const t = String(v ?? "");
      return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };

    const sections: string[] = [];

    if (rates.data?.byMunicipality?.length) {
      sections.push("Incidência por município");
      sections.push(["Município", "GVE", "Casos", "População", "Incidência/100 mil"].map(escape).join(";"));
      for (const r of rates.data.byMunicipality) {
        sections.push([
          r.municipio, r.gve, r.casos, r.populacao,
          Number(r.incidencia100k ?? 0).toFixed(2).replace(".", ",")
        ].map(escape).join(";"));
      }
    } else if (report.data?.indicators.topMunicipalities.length) {
      sections.push("Top municípios por casos");
      sections.push(["Município", "Casos"].map(escape).join(";"));
      for (const r of report.data.indicators.topMunicipalities) {
        sections.push([r.name, r.total].map(escape).join(";"));
      }
    }

    if (rates.data?.byGve?.length) {
      if (sections.length) sections.push("");
      sections.push("Incidência por GVE");
      sections.push(["GVE", "Casos", "População", "Incidência/100 mil"].map(escape).join(";"));
      for (const r of rates.data.byGve) {
        sections.push([
          r.gve, r.casos, r.populacao,
          Number(r.incidencia100k ?? 0).toFixed(2).replace(".", ",")
        ].map(escape).join(";"));
      }
    } else if (report.data?.indicators.topGves.length) {
      if (sections.length) sections.push("");
      sections.push("Top GVEs por casos");
      sections.push(["GVE", "Casos"].map(escape).join(";"));
      for (const r of report.data.indicators.topGves) {
        sections.push([r.name, r.total].map(escape).join(";"));
      }
    }

    if (!sections.length) return;
    const blob = new Blob([`﻿${sections.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const gveSuffix = selectedGve ? `-${selectedGve.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20)}` : "";
    const muniSuffix = selectedMunicipio ? `-${selectedMunicipio.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20)}` : "";
    const seSuffix = (seStart || seEnd) ? `-SE${seStart ?? 1}-${seEnd ?? 53}` : "";
    link.download = `cevesp-situacao${selectedYear ? `-${selectedYear}` : ""}${gveSuffix}${muniSuffix}${seSuffix}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadAskCsv() {
    if (!ask.data) return;
    const rows = ask.data.monthlyReport?.statewideRows ?? ask.data.weeklyReport?.pivotRows ?? ask.data.rows ?? [];
    const columns = ask.data.columns ?? Object.keys(rows[0] ?? {});
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [
      columns.map(escape).join(";"),
      ...rows.map((row) => columns.map((column) => escape(row[column])).join(";"))
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "cevesp-consulta.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Análise por agravo</Badge>
              <Badge className={risk.cls}>{risk.label}</Badge>
            </div>
            <h1 className="mt-2 text-lg font-semibold leading-tight">
              Conjuntivites - CEVESP{selectedYear ? ` · ${selectedYear}` : ""}
              {selectedGve ? ` · ${selectedGve}` : ""}
              {selectedMunicipio ? ` · ${selectedMunicipio}` : ""}
              {(seStart || seEnd) ? ` · SE ${seStart ?? 1}-${seEnd ?? 53}` : ""}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Aprofundamento da Sala de Situação: consulta ao banco, canal endêmico, qualidade e saídas técnicas.
            </p>
            <Link href="/dashboard" className="mt-1 inline-flex text-xs font-medium text-primary underline">
              Voltar para a Sala de Situação
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 print-hide" data-print-hide>
            <select
              value={selectedYear ?? ""}
              onChange={e => {
                setSelectedYear(e.target.value ? Number(e.target.value) : undefined);
                setSelectedGve("");
                setSeInicio(undefined);
                setSeFim(undefined);
                setSelectedMunicipio("");
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              disabled={anosQuery.isLoading}
            >
              <option value="">Todos os anos</option>
              {(anosQuery.data?.anos ?? []).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              value={selectedGve}
              onChange={e => { setSelectedGve(e.target.value); setSelectedMunicipio(""); }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              disabled={gvesQuery.isLoading}
            >
              <option value="">Todos os GVEs</option>
              {(gvesQuery.data?.gves ?? []).map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select
              value={selectedMunicipio}
              onChange={e => setSelectedMunicipio(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos os municípios</option>
              {municipioOptions.map(m => (
                <option key={m.codigo} value={m.nome}>{m.nome}</option>
              ))}
            </select>
            {selectedYear && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">SE</span>
                <input
                  type="number"
                  min={1}
                  max={53}
                  placeholder="01"
                  value={seInicio ?? ""}
                  onChange={e => setSeInicio(sanitizeSe(e.target.value))}
                  className="h-9 w-14 rounded-md border bg-background px-2 text-sm text-center"
                />
                <span className="text-xs text-muted-foreground">a</span>
                <input
                  type="number"
                  min={1}
                  max={53}
                  placeholder="53"
                  value={seFim ?? ""}
                  onChange={e => setSeFim(sanitizeSe(e.target.value))}
                  className="h-9 w-14 rounded-md border bg-background px-2 text-sm text-center"
                />
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => {
                void report.refetch();
                void quality.refetch();
                void rates.refetch();
              }}
              disabled={report.isFetching || quality.isFetching || rates.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${report.isFetching || quality.isFetching || rates.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button variant="outline" onClick={printPdf}>
              <Download className="h-4 w-4" />
              Salvar PDF
            </Button>
            <Button variant="outline" onClick={downloadBoletim}>
              <Download className="h-4 w-4" />
              Boletim Word
            </Button>
            <Button asChild>
              <Link href="/chat">
                <MessageSquareText className="h-4 w-4" />
                Perguntar ao agente
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1 print-hide" data-print-hide>
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setTab(item.id);
                  if (item.id === "canal") setShowEndemic(true);
                }}
                className={`flex h-9 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm transition-colors ${
                  tab === item.id ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-6 p-6">
        {(report.isLoading || quality.isLoading) && (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Carregando análise CEVESP...
          </div>
        )}

        {(report.isError || quality.isError) && (
          <Card className="border-amber-300 bg-amber-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <AlertTriangle className="h-5 w-5" />
                Dados CEVESP parcialmente indisponíveis
              </CardTitle>
              <CardDescription className="text-amber-800">
                {report.error instanceof Error ? report.error.message : quality.error instanceof Error ? quality.error.message : "Verifique sincronização, cache ou conexão."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {tab === "situacao" && report.data && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-2 print-hide" data-print-hide>
              <div className="text-xs text-muted-foreground">
                {(() => {
                  const lastWeek = report.data.indicators.weeklySeries.at(-1);
                  const match = lastWeek?.week.match(/^(\d{4})-SE(\d+)$/);
                  const seLabel = match ? `SE ${match[2]}/${match[1]}` : null;
                  const genDate = new Date(report.data.generatedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
                  return seLabel
                    ? `Dados até ${seLabel} · Relatório gerado em ${genDate}`
                    : `Relatório gerado em ${genDate}`;
                })()}
              </div>
              <Button variant="outline" size="sm" onClick={downloadSituacaoCsv} disabled={!rates.data && !report.data}>
                <Download className="h-4 w-4" />
                Exportar análise CSV
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard
                label="Casos analisados"
                value={totalCases}
                detail={`${num(report.data.indicators.notifications)} notificações no recorte`}
                change={casesChange ?? undefined}
              />
              <MetricCard
                label="Municípios notificando"
                value={`${reportingMunicipalities} de ${SP_MUNICIPIOS}`}
                detail={`${pct(reportingMunicipalities, SP_MUNICIPIOS)} dos municípios SP`}
                tone={reportingMunicipalities < SP_MUNICIPIOS * 0.5 ? "amber" : "green"}
                change={muniChange ?? undefined}
              />
              <MetricCard label="Notificações com surto" value={report.data.indicators.outbreakNotifications} detail={`${outbreakRate} das notificações`} tone={report.data.indicators.outbreakNotifications > 0 ? "amber" : "green"} />
              <MetricCard label="Materiais coletados" value={report.data.indicators.biologicalCollectionTotal} detail={`${num(report.data.indicators.biologicalCollectionNotifications)} notificações com coleta`} />
              <MetricCard label="Problemas de qualidade" value={quality.data?.total ?? 0} detail="Registros que precisam revisão" tone={(quality.data?.total ?? 0) > 0 ? "amber" : "green"} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Leitura epidemiológica</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {report.data.interpretation.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                </CardContent>
              </Card>

              <Card className={report.data.alerts.length ? "border-amber-300" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Alertas para investigação</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {report.data.alerts.length ? report.data.alerts.slice(0, 5).map((alert) => (
                    <div key={alert.title} className="rounded-md border p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge className={alert.severity === "alta" ? "border-red-300 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-700"}>
                          {alert.severity}
                        </Badge>
                        <strong className="text-sm">{alert.title}</strong>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.description}</p>
                    </div>
                  )) : (
                    <p className="text-sm text-muted-foreground">Nenhum alerta automático relevante na base avaliada.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <EpidemicCharts
              weeklySeries={report.data.indicators.weeklySeries ?? []}
              ageDistribution={report.data.indicators.ageDistribution ?? []}
              sexDistribution={report.data.indicators.sexDistribution ?? []}
              topMunicipalities={report.data.indicators.topMunicipalities ?? []}
              topGves={report.data.indicators.topGves ?? []}
            />

            {rates.data && <CevespRatesPanel data={rates.data} />}

            <RankingList title="Unidades notificadoras" items={report.data.indicators.topUnits ?? []} />
          </div>
        )}

        {tab === "situacao" && !report.data && rates.data && <CevespRatesPanel data={rates.data} />}

        {tab === "consulta" && (
          <Card>
            <CardHeader>
              <CardTitle>Perguntar ao banco CEVESP</CardTitle>
              <CardDescription>
                Use para perguntas específicas por período, GVE, município, semana epidemiológica, surto, sexo, idade ou unidade notificadora.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ex.: Total de casos por GVE dos últimos 5 anos por mês"
                className="min-h-[90px]"
              />
              <div className="flex flex-wrap gap-2">
                {guidedQuestions.map((item) => (
                  <Button
                    key={item}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-8 whitespace-normal text-left text-xs"
                    onClick={() => setQuestion(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => ask.mutate()} disabled={ask.isPending}>
                  {ask.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
                  Consultar banco
                </Button>
                {ask.data && (
                  <Button variant="outline" onClick={downloadAskCsv}>
                    <Download className="h-4 w-4" />
                    Exportar CSV
                  </Button>
                )}
              </div>

              {ask.isError && <p className="text-sm text-destructive">{(ask.error as Error).message}</p>}

              {ask.data && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {ask.data.metricLabel && <Badge>{ask.data.metricLabel}</Badge>}
                    {ask.data.timeLabel && <Badge className="border-primary/50 text-primary">{ask.data.timeLabel}</Badge>}
                    {(ask.data.understanding?.dimensions ?? []).map((item) => <Badge key={item} className="bg-muted text-foreground">{item}</Badge>)}
                  </div>

                  {ask.data.understanding && (
                    <details className="rounded-md border p-3">
                      <summary className="cursor-pointer text-sm font-medium">Critérios entendidos pelo agente</summary>
                      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                        <InfoItem label="Indicador" value={ask.data.understanding.metric ?? "-"} />
                        <InfoItem label="Período" value={ask.data.understanding.period ?? "-"} />
                        <InfoItem label="Tempo" value={ask.data.understanding.temporalGrouping ?? "-"} />
                        <InfoItem label="Dimensões" value={(ask.data.understanding.dimensions ?? []).join(", ") || "Nenhuma"} />
                        <InfoItem label="Filtros" value={(ask.data.understanding.filters ?? []).join(", ") || "Nenhum"} />
                        <InfoItem label="Fonte" value={ask.data.understanding.source ?? "-"} />
                      </div>
                    </details>
                  )}

                  {(ask.data.interpretation ?? []).length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Interpretação epidemiológica</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                          {(ask.data.interpretation ?? []).map((item, index) => <li key={index}>{item}</li>)}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {ask.data.monthlyReport && (
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <MetricCard label="Total geral" value={ask.data.monthlyReport.totalCases} />
                        <MetricCard label="GVEs analisados" value={ask.data.monthlyReport.gveSections.length} />
                        <MetricCard label="Top GVE" value={ask.data.monthlyReport.topGves[0]?.gve ?? "-"} detail={ask.data.monthlyReport.topGves[0] ? `${num(ask.data.monthlyReport.topGves[0].total)} casos` : undefined} />
                      </div>
                      <ResultTable title="Consolidado estadual" columns={ask.data.columns ?? []} rows={ask.data.monthlyReport.statewideRows} />
                      <details className="rounded-md border p-3">
                        <summary className="cursor-pointer text-sm font-medium">Abrir tabelas por GVE</summary>
                        <div className="mt-4 space-y-4">
                          {ask.data.monthlyReport.gveSections.map((section) => (
                            <ResultTable key={section.gve} title={`GVE: ${section.gve}`} columns={ask.data.columns ?? []} rows={section.rows} limit={24} />
                          ))}
                        </div>
                      </details>
                    </div>
                  )}

                  {ask.data.weeklyReport && (
                    <div className="space-y-4">
                      <MetricCard label="Total geral" value={ask.data.weeklyReport.totalCases} />
                      <ResultTable title="Relatório semanal" columns={ask.data.weeklyReport.columns} rows={ask.data.weeklyReport.pivotRows} />
                    </div>
                  )}

                  {!ask.data.monthlyReport && !ask.data.weeklyReport && (
                    <ResultTable columns={ask.data.columns ?? Object.keys(ask.data.rows?.[0] ?? {})} rows={ask.data.rows ?? []} />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "canal" && (
          <div className="space-y-4">
            {endemic.isFetching && (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">Calculando canal endêmico...</CardContent></Card>
            )}
            {endemic.isError && (
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    Erro no canal endêmico
                  </CardTitle>
                  <CardDescription>{(endemic.error as Error).message}</CardDescription>
                </CardHeader>
              </Card>
            )}
            {endemic.data && endemic.data.length > 0 && <EndemicChannelChart data={endemic.data} />}
          </div>
        )}

        {tab === "saidas" && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Boletim técnico</CardTitle>
                  <CardDescription>Documento Word com situação epidemiológica e recomendações.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={downloadBoletim}>
                    <Download className="h-4 w-4" />
                    Baixar boletim
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Chat epidemiológico</CardTitle>
                  <CardDescription>Para perguntas livres, interpretação e redação de relatório.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline"><Link href="/chat">Abrir chat</Link></Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sincronização</CardTitle>
                  <CardDescription>Exportar/importar banco quando estiver fora da rede interna.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline"><Link href="/sincronizacao">Abrir sincronização</Link></Button>
                </CardContent>
              </Card>
            </div>

            {report.data && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Recomendações para boletim</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    {report.data.bulletinSections.recomendacoes.map((item, index) => <p key={index}>{item}</p>)}
                  </CardContent>
                </Card>

                <details className="rounded-lg border bg-card p-4">
                  <summary className="cursor-pointer text-sm font-medium">Resumo estrutural do banco</summary>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="py-2">Coluna</th>
                          <th>Tipo</th>
                          <th>Ausentes</th>
                          <th>Valores frequentes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.columns.map((column) => (
                          <tr key={column.name} className="border-b last:border-0">
                            <td className="py-2 font-medium">{column.name}</td>
                            <td>{column.type}</td>
                            <td>{column.missing}</td>
                            <td className="max-w-[520px] truncate">
                              {column.topValues.map((item) => `${item.value} (${item.count})`).join(", ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  );
}
