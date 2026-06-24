"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Download, ExternalLink, FileText, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RateMap } from "@/components/epidemiology/rate-map";

type MuniRow = {
  codigoIbge: string;
  municipio: string;
  gve: string;
  examinados: number;
  positivos: number;
  populacao: number;
  prevalencia: number | null;
  taxaDeteccao100k: number | null;
  coberturaExame: number | null;
  riskColor: string;
};

type GveRow = {
  gve: string;
  examinados: number;
  positivos: number;
  populacao: number;
  prevalencia: number | null;
  taxaDeteccao100k: number | null;
  coberturaExame: number | null;
};

type TracomaRates = {
  missingPopulation?: boolean;
  message?: string;
  analysisYear?: number;
  periodStart?: number | null;
  periodEnd?: number | null;
  populationYear?: number | null;
  metric?: string;
  byMunicipality?: MuniRow[];
  byGve?: GveRow[];
  mapRows?: MuniRow[];
};

type Bulletin = {
  id: string;
  se: number | null;
  ano: number;
  title: string;
  created_at: string;
};

function num(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

function pct(value: number | null | undefined, decimals = 1) {
  if (value == null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: decimals })}%`;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "default"
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "default" | "red" | "amber" | "green";
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
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {typeof value === "number" ? num(value) : value}
        </div>
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}

export function TracomaAnaliseView() {
  const qc = useQueryClient();

  // Pending inputs (user edits before clicking Filtrar)
  const [pendingGve, setPendingGve] = useState("");
  const [pendingMunicipio, setPendingMunicipio] = useState("");
  const [pendingYearStart, setPendingYearStart] = useState<number | undefined>(undefined);
  const [pendingYearEnd, setPendingYearEnd] = useState<number | undefined>(undefined);

  // Applied filters (drive queries)
  const [gve, setGve] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [yearStart, setYearStart] = useState<number | undefined>(undefined);
  const [yearEnd, setYearEnd] = useState<number | undefined>(undefined);

  // Bulletin viewer state
  const [openBulletinId, setOpenBulletinId] = useState<string | null>(null);

  // Bulletin form state
  const [bulletinAno, setBulletinAno] = useState(new Date().getFullYear());
  const [bulletinAnoInicio, setBulletinAnoInicio] = useState<number | undefined>(undefined);
  const [bulletinForce, setBulletinForce] = useState(false);

  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(pendingGve), [pendingGve]);


  const [taxaMapView, setTaxaMapView] = useState<"municipio" | "gve">("municipio");
  const [taxaMetric, setTaxaMetric] = useState<"prevalencia" | "taxaDeteccao100k" | "coberturaExame">("prevalencia");

  function applyFilters() {
    setGve(pendingGve);
    setMunicipio(pendingMunicipio);
    setYearStart(pendingYearStart);
    setYearEnd(pendingYearEnd);
  }

  function resetFilters() {
    setPendingGve(""); setGve("");
    setPendingMunicipio(""); setMunicipio("");
    setPendingYearStart(undefined); setYearStart(undefined);
    setPendingYearEnd(undefined); setYearEnd(undefined);
  }

  const rates = useQuery<TracomaRates>({
    queryKey: ["sinan-taxas", gve, municipio, yearStart, yearEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gve) params.set("gve", gve);
      if (municipio) params.set("municipio", municipio);
      if (yearStart) params.set("yearStart", String(yearStart));
      if (yearEnd) params.set("yearEnd", String(yearEnd));
      const qs = params.toString();
      const res = await fetch(`/api/sinan/taxas${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar dados SINAN tracoma");
      return data as TracomaRates;
    },
    staleTime: 5 * 60 * 1000
  });


  const bulletinsQuery = useQuery<Bulletin[]>({
    queryKey: ["boletins-tracoma"],
    queryFn: async () => {
      const res = await fetch("/api/boletins?agravo=tracoma");
      if (!res.ok) return [];
      return res.json() as Promise<Bulletin[]>;
    },
    staleTime: 2 * 60 * 1000
  });

  const bulletinDetailQuery = useQuery<{ id: string; title: string; content: string | null; ano: number; created_at: string }>({
    queryKey: ["boletim-detail", openBulletinId],
    queryFn: async () => {
      const res = await fetch(`/api/boletins/${openBulletinId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar boletim");
      return data;
    },
    enabled: !!openBulletinId,
    staleTime: 10 * 60 * 1000
  });

  const generateBulletin = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/boletins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agravo: "tracoma",
          ano: bulletinAno,
          anoInicio: bulletinAnoInicio,
          force: bulletinForce
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Erro ao gerar boletim");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["boletins-tracoma"] });
      setBulletinForce(false);
    }
  });

  // Derived indicators
  const byMuni = rates.data?.byMunicipality ?? [];
  const byGveData = rates.data?.byGve ?? [];
  const totalExaminados = byMuni.reduce((s, r) => s + r.examinados, 0);
  const totalPositivos = byMuni.reduce((s, r) => s + r.positivos, 0);
  const prevMedia = totalExaminados > 0 ? (totalPositivos / totalExaminados) * 100 : null;
  const muniAcimaMeta = byMuni.filter((r) => (r.prevalencia ?? 0) > 5).length;
  const hasFilter = !!(gve || municipio || yearStart || yearEnd);
  const hasData = !rates.isLoading && !rates.isError && !rates.data?.missingPopulation;

  function downloadTracamaCsv() {
    const escape = (v: unknown) => {
      const t = String(v ?? "");
      return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const sections: string[] = [];
    if (byMuni.length) {
      sections.push("Prevalência por município");
      sections.push(["Município", "GVE", "Examinados", "Positivos", "Prevalência (%)", "Cobertura (%)", "Taxa/100 mil"].map(escape).join(";"));
      for (const r of byMuni) {
        sections.push([
          r.municipio, r.gve, r.examinados, r.positivos,
          r.prevalencia != null ? Number(r.prevalencia).toFixed(2).replace(".", ",") : "",
          r.coberturaExame != null ? Number(r.coberturaExame).toFixed(2).replace(".", ",") : "",
          r.taxaDeteccao100k != null ? Number(r.taxaDeteccao100k).toFixed(2).replace(".", ",") : ""
        ].map(escape).join(";"));
      }
    }
    if (byGveData.length) {
      if (sections.length) sections.push("");
      sections.push("Prevalência por GVE");
      sections.push(["GVE", "Examinados", "Positivos", "Prevalência (%)", "Cobertura (%)", "Taxa/100 mil"].map(escape).join(";"));
      for (const r of byGveData) {
        sections.push([
          r.gve, r.examinados, r.positivos,
          r.prevalencia != null ? Number(r.prevalencia).toFixed(2).replace(".", ",") : "",
          r.coberturaExame != null ? Number(r.coberturaExame).toFixed(2).replace(".", ",") : "",
          r.taxaDeteccao100k != null ? Number(r.taxaDeteccao100k).toFixed(2).replace(".", ",") : ""
        ].map(escape).join(";"));
      }
    }
    if (!sections.length) return;
    const blob = new Blob([`﻿${sections.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const gveSuffix = gve ? `-${gve.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20)}` : "";
    const yearSuffix = yearStart ? `-${yearStart}${yearEnd && yearEnd !== yearStart ? `-${yearEnd}` : ""}` : "";
    link.download = `tracoma-analise${yearSuffix}${gveSuffix}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="space-y-6 p-6">
      {/* ── Filtros ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filtros de análise</CardTitle>
          <CardDescription className="text-xs">
            Clique em &quot;Filtrar&quot; para aplicar. Sem filtros: exibe todos os dados NOTTRACONET disponíveis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">GVE</label>
              <select
                value={pendingGve}
                onChange={(e) => { setPendingGve(e.target.value); setPendingMunicipio(""); }}
                className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Todos os GVEs</option>
                {gveOptions.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Município</label>
              <select
                value={pendingMunicipio}
                onChange={(e) => setPendingMunicipio(e.target.value)}
                className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Todos os municípios</option>
                {municipioOptions.map((m) => <option key={m.codigo} value={m.nome}>{m.nome}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Ano início</label>
              <input
                type="number"
                placeholder="Ex: 2020"
                value={pendingYearStart ?? ""}
                onChange={(e) => setPendingYearStart(e.target.value ? Number(e.target.value) : undefined)}
                className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Ano fim</label>
              <input
                type="number"
                placeholder="Ex: 2025"
                value={pendingYearEnd ?? ""}
                onChange={(e) => setPendingYearEnd(e.target.value ? Number(e.target.value) : undefined)}
                className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
              />
            </div>
            <Button onClick={applyFilters} disabled={rates.isFetching}>
              {rates.isFetching
                ? <RefreshCw className="h-4 w-4 animate-spin" />
                : <Search className="h-4 w-4" />}
              Filtrar
            </Button>
            {hasFilter && (
              <Button variant="ghost" onClick={resetFilters} className="text-muted-foreground">
                Limpar
              </Button>
            )}
          </div>
          {hasFilter && (
            <div className="mt-2 flex flex-wrap gap-2">
              {gve && <Badge className="bg-muted text-foreground">GVE: {gve}</Badge>}
              {municipio && <Badge className="bg-muted text-foreground">Município: {municipio}</Badge>}
              {yearStart && <Badge className="bg-muted text-foreground">De: {yearStart}</Badge>}
              {yearEnd && <Badge className="bg-muted text-foreground">Até: {yearEnd}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Loading / Error ── */}
      {rates.isLoading && (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Carregando dados SINAN / NOTTRACONET...
        </div>
      )}

      {rates.isError && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-5 w-5" />
              Dados SINAN indisponíveis
            </CardTitle>
            <CardDescription className="text-amber-800">
              {rates.error instanceof Error ? rates.error.message : "Verifique o cache Supabase."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {rates.data?.missingPopulation && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Dados populacionais ausentes</CardTitle>
            <CardDescription className="text-amber-800">{rates.data.message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {hasData && byMuni.length > 0 && (
        <>
          {/* Period + export */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {rates.data!.periodStart && rates.data!.periodEnd
                ? `Período: ${rates.data!.periodStart} – ${rates.data!.periodEnd} · `
                : ""}
              Fonte: NOTTRACONET / SINAN Tracoma
              {rates.data!.populationYear ? ` · Pop. IBGE ${rates.data!.populationYear}` : ""}
            </p>
            <Button variant="outline" size="sm" onClick={downloadTracamaCsv} disabled={!byMuni.length && !byGveData.length}>
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          </div>

          {/* ── Indicadores ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Municípios com dados"
              value={byMuni.length}
              detail="com pelo menos 1 exame registrado"
            />
            <MetricCard
              label="Total examinados"
              value={totalExaminados}
              detail="acumulado no período selecionado"
            />
            <MetricCard
              label="Total positivos (TF/TI)"
              value={totalPositivos}
              detail="formas ativas de tracoma"
              tone={totalPositivos > 0 ? "amber" : "green"}
            />
            <MetricCard
              label="Prevalência média"
              value={prevMedia != null ? pct(prevMedia) : "—"}
              detail="meta OMS de eliminação: < 5%"
              tone={
                prevMedia == null ? "default"
                  : prevMedia >= 5 ? "red"
                  : prevMedia > 0 ? "amber"
                  : "green"
              }
            />
            <MetricCard
              label="Municípios acima da meta"
              value={muniAcimaMeta}
              detail="com TF > 5% (threshold OMS)"
              tone={muniAcimaMeta > 0 ? "red" : "green"}
            />
          </div>

          {/* ── Mapa epidemiológico ── */}
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Mapa de taxas do tracoma</p>
                <p className="text-xs text-muted-foreground">
                  O mapa por município usa o shapefile municipal de SP; o mapa por GVE consolida os municípios do grupo.
                </p>
              </div>
              <div className="inline-flex w-fit rounded-md border bg-background p-1">
                {(["municipio", "gve"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTaxaMapView(mode)}
                    className={`rounded px-3 py-1 text-xs font-semibold transition ${
                      taxaMapView === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {mode === "municipio" ? "Município" : "GVE"}
                  </button>
                ))}
              </div>
              <select
                value={taxaMetric}
                onChange={(event) => setTaxaMetric(event.target.value as typeof taxaMetric)}
                className="h-8 rounded-md border bg-background px-2 text-xs font-medium"
              >
                <option value="prevalencia">Prevalência %</option>
                <option value="taxaDeteccao100k">Taxa de detecção/100 mil</option>
                <option value="coberturaExame">Cobertura de exame %</option>
              </select>
            </div>
            <RateMap
              title={`Mapa operacional de ${
                taxaMetric === "prevalencia"
                  ? "prevalência"
                  : taxaMetric === "taxaDeteccao100k"
                    ? "taxa de detecção"
                    : "cobertura de exame"
              } por ${taxaMapView === "municipio" ? "município" : "GVE"}${
                rates.data!.periodStart && rates.data!.periodEnd
                  ? ` - ${rates.data!.periodStart === rates.data!.periodEnd ? rates.data!.periodStart : `${rates.data!.periodStart} a ${rates.data!.periodEnd}`}`
                  : ""
              }`}
              description={`Prevalência entre examinados, taxa de detecção e cobertura. Pop. IBGE: ${rates.data!.populationYear ?? "-"}.`}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              rows={(taxaMapView === "municipio" ? rates.data!.byMunicipality ?? [] : rates.data!.byGve ?? []) as any}
              valueKey={taxaMetric}
              valueLabel={taxaMetric === "taxaDeteccao100k" ? "por 100 mil hab." : "%"}
              missingPopulation={false}
              tableColumns={
                taxaMapView === "municipio"
                  ? [
                      { key: "municipio", label: "Município" },
                      { key: "gve", label: "GVE" },
                      { key: "examinados", label: "Examinados" },
                      { key: "positivos", label: "Positivos" },
                      { key: "prevalencia", label: "Prevalência %", decimals: 2 },
                      { key: "taxaDeteccao100k", label: "Detecção/100 mil", decimals: 2 },
                      { key: "coberturaExame", label: "Cobertura %", decimals: 2 },
                      { key: "populacao", label: "População" }
                    ]
                  : [
                      { key: "gve", label: "GVE" },
                      { key: "examinados", label: "Examinados" },
                      { key: "positivos", label: "Positivos" },
                      { key: "prevalencia", label: "Prevalência %", decimals: 2 },
                      { key: "taxaDeteccao100k", label: "Detecção/100 mil", decimals: 2 },
                      { key: "coberturaExame", label: "Cobertura %", decimals: 2 },
                      { key: "populacao", label: "População" }
                    ]
              }
            />
          </div>
        </>
      )}

      {hasData && byMuni.length === 0 && !rates.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum dado NOTTRACONET encontrado para os filtros selecionados.
          </CardContent>
        </Card>
      )}

      {/* ── Boletins ── */}
      <div className="grid gap-4 md:grid-cols-[1fr_1.5fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gerar boletim técnico</CardTitle>
            <CardDescription>
              Boletim de eliminação do tracoma gerado por IA com base nos dados SINAN.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">Ano de referência</label>
                <input
                  type="number"
                  value={bulletinAno}
                  onChange={(e) => setBulletinAno(Number(e.target.value))}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">Ano início (opcional)</label>
                <input
                  type="number"
                  placeholder="Ex: 2020"
                  value={bulletinAnoInicio ?? ""}
                  onChange={(e) => setBulletinAnoInicio(e.target.value ? Number(e.target.value) : undefined)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={bulletinForce}
                onChange={(e) => setBulletinForce(e.target.checked)}
              />
              Forçar regeneração (mesmo que já exista)
            </label>
            <Button
              onClick={() => generateBulletin.mutate()}
              disabled={generateBulletin.isPending}
              className="w-full"
            >
              {generateBulletin.isPending
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Gerando...</>
                : <><FileText className="h-4 w-4" /> Gerar boletim {bulletinAno}</>}
            </Button>
            {generateBulletin.isError && (
              <p className="text-xs text-destructive">{(generateBulletin.error as Error).message}</p>
            )}
            {generateBulletin.isSuccess && (
              <p className="text-xs text-green-700">Boletim gerado com sucesso.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Boletins gerados</CardTitle>
          </CardHeader>
          <CardContent>
            {bulletinsQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            )}
            {!bulletinsQuery.isLoading && (bulletinsQuery.data?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum boletim gerado ainda.</p>
            )}
            <ul className="space-y-2">
              {(bulletinsQuery.data ?? []).slice(0, 8).map((b) => (
                <li key={b.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium leading-tight">{b.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Ano {b.ano}{b.se ? ` · SE ${b.se}` : ""} ·{" "}
                        {new Date(b.created_at).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => setOpenBulletinId(openBulletinId === b.id ? null : b.id)}
                    >
                      {openBulletinId === b.id ? "Fechar" : "Ver"}
                    </Button>
                  </div>
                  {openBulletinId === b.id && (
                    <div className="mt-3 border-t pt-3">
                      {bulletinDetailQuery.isLoading && (
                        <p className="text-xs text-muted-foreground">Carregando...</p>
                      )}
                      {bulletinDetailQuery.isError && (
                        <p className="text-xs text-destructive">Erro ao carregar conteúdo.</p>
                      )}
                      {bulletinDetailQuery.data?.content && (
                        <>
                          <div className="max-h-80 overflow-y-auto pr-1 text-xs [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-xs [&_h1]:font-bold [&_h1]:uppercase [&_h1]:text-teal-900 [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:uppercase [&_h2]:text-teal-800 [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_li]:leading-relaxed [&_p]:mb-2 [&_p]:leading-relaxed [&_p]:text-foreground/80 [&_strong]:font-semibold [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-teal-50 [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {bulletinDetailQuery.data.content}
                            </ReactMarkdown>
                          </div>
                          <div className="mt-2 flex justify-end">
                            <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                              <Link href={`/boletins?id=${b.id}&agravo=tracoma`}>
                                <ExternalLink className="h-3.5 w-3.5" />
                                Abrir boletim completo
                              </Link>
                            </Button>
                          </div>
                        </>
                      )}
                      {bulletinDetailQuery.data && !bulletinDetailQuery.data.content && (
                        <p className="text-xs text-muted-foreground">Conteúdo não disponível.</p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
