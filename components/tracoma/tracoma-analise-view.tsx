"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileText, RefreshCw, Search } from "lucide-react";
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

type DemographicBucket = { label: string; total: number };
type DemographicCross = { label: string; TF: number; TI: number; TS: number; TT: number; CO: number; semForma: number; total: number };
type TracomaDemographics = {
  missingData?: boolean;
  message?: string;
  totalRows: number;
  withSex: number;
  withAge: number;
  withClinicalForm: number;
  sexDistribution: DemographicBucket[];
  ageDistribution: DemographicBucket[];
  clinicalForms: DemographicBucket[];
  sexByForm: DemographicCross[];
  ageByForm: DemographicCross[];
};

type TracomaFilters = {
  yearStart?: string;
  yearEnd?: string;
  gve?: string;
  municipio?: string;
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

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ExecutiveSummary({
  totalPositivos,
  prevMedia,
  muniAcimaMeta,
  topPriorityMuni,
  demographics
}: {
  totalPositivos: number;
  prevMedia: number | null;
  muniAcimaMeta: number;
  topPriorityMuni?: MuniRow;
  demographics?: TracomaDemographics;
}) {
  const missingClinical = demographics ? demographics.totalRows - demographics.withClinicalForm : 0;
  const risk = muniAcimaMeta > 0 || (prevMedia ?? 0) >= 5 ? "Atenção alta" : totalPositivos > 0 ? "Monitorar" : "Estável";
  const nextAction = muniAcimaMeta > 0
    ? "Priorizar municípios acima de 5% e revisar estratégia de busca ativa."
    : missingClinical > 0
      ? "Completar forma clínica antes de consolidar leitura epidemiológica."
      : "Manter vigilância e registrar acompanhamento dos territórios.";
  const itemClass = "rounded-md border bg-background p-3";
  const labelClass = "text-xs font-medium uppercase text-muted-foreground";
  const valueClass = "mt-1 text-sm font-semibold leading-snug";
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Resumo executivo</CardTitle>
        <CardDescription>Leitura rápida para decisão do recorte selecionado.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        <div className={itemClass}>
          <div className={labelClass}>Risco</div>
          <div className={valueClass}>{risk}</div>
          <div className="mt-1 text-xs text-muted-foreground">síntese operacional</div>
        </div>
        <div className={itemClass}>
          <div className={labelClass}>Onde agir</div>
          <div className={valueClass}>
            {topPriorityMuni
              ? `${topPriorityMuni.municipio} (${pct(topPriorityMuni.prevalencia)})`
              : `${muniAcimaMeta.toLocaleString("pt-BR")} município(s)`}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {muniAcimaMeta.toLocaleString("pt-BR")} acima da meta OMS
          </div>
        </div>
        <div className={itemClass}>
          <div className={labelClass}>Sinal principal</div>
          <div className={valueClass}>{prevMedia != null ? pct(prevMedia) : "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">prevalência média TF/TI</div>
        </div>
        <div className={itemClass}>
          <div className={labelClass}>Próxima ação</div>
          <div className={valueClass}>{nextAction}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DistributionList({ title, rows }: { title: string; rows: DemographicBucket[] }) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados mapeados.</p>
        ) : rows.map((row) => {
          const share = total ? (row.total / total) * 100 : 0;
          return (
            <div key={row.label} className="space-y-1">
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <strong className="shrink-0 tabular-nums">
                  {num(row.total)} ({share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)
                </strong>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${row.total > 0 ? Math.max(4, Math.round(share)) : 0}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function cellPercent(value: number, total: number) {
  if (!total) return "0%";
  return `${((value / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function CrossCell({ value, total }: { value: number; total: number }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <span className="font-medium">{num(value)}</span>
      <span className="ml-1 text-[11px] text-muted-foreground">({cellPercent(value, total)})</span>
    </td>
  );
}

function CrossTable({ title, rows }: { title: string; rows: DemographicCross[] }) {
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>Contagem e percentual dentro de cada grupo.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem cruzamento disponível.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Grupo</th>
                  <th className="px-3 py-2 text-right">TF</th>
                  <th className="px-3 py-2 text-right">TI</th>
                  <th className="px-3 py-2 text-right">TS</th>
                  <th className="px-3 py-2 text-right">TT</th>
                  <th className="px-3 py-2 text-right">CO</th>
                  <th className="px-3 py-2 text-right">Sem forma</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    <CrossCell value={row.TF} total={row.total} />
                    <CrossCell value={row.TI} total={row.total} />
                    <CrossCell value={row.TS} total={row.total} />
                    <CrossCell value={row.TT} total={row.total} />
                    <CrossCell value={row.CO} total={row.total} />
                    <CrossCell value={row.semForma} total={row.total} />
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      <span>{num(row.total)}</span>
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">({cellPercent(row.total, grandTotal)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DemographicsPanel({ data, loading }: { data?: TracomaDemographics; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Carregando perfil demográfico...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.missingData) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <CardHeader>
          <CardTitle className="text-amber-900">Perfil demográfico indisponível</CardTitle>
          <CardDescription className="text-amber-800">
            {data?.message ?? "Importe o TRACONET para visualizar sexo, idade e forma clínica."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const childrenOneToNine = data.ageDistribution
    .filter((row) => row.label === "1 a 4 anos" || row.label === "5 a 9 anos")
    .reduce((sum, row) => sum + row.total, 0);
  const childrenOneToNinePct = data.totalRows ? ((childrenOneToNine / data.totalRows) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Perfil demográfico TRACONET</h2>
        <p className="text-sm text-muted-foreground">
          Sexo, faixa etária e forma clínica dos casos individuais. Use para orientar busca ativa, educação em saúde e revisão clínica.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Casos individuais" value={data.totalRows} detail="TRACONET no recorte" />
        <MetricCard label="Com sexo mapeado" value={data.withSex} detail={`(${data.totalRows ? ((data.withSex / data.totalRows) * 100).toFixed(1) : "0"}%) dos casos`} tone={data.withSex < data.totalRows ? "amber" : "green"} />
        <MetricCard label="Com idade mapeada" value={data.withAge} detail={`(${data.totalRows ? ((data.withAge / data.totalRows) * 100).toFixed(1) : "0"}%) dos casos`} tone={data.withAge < data.totalRows ? "amber" : "green"} />
        <MetricCard label="1 a 9 anos" value={childrenOneToNine} detail={`(${childrenOneToNinePct}%) dos casos individuais`} tone={childrenOneToNine > 0 ? "amber" : "default"} />
        <MetricCard label="Com forma clínica" value={data.withClinicalForm} detail={`(${data.totalRows ? ((data.withClinicalForm / data.totalRows) * 100).toFixed(1) : "0"}%) com TF/TI/TS/TT/CO`} tone={data.withClinicalForm < data.totalRows ? "amber" : "green"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <DistributionList title="Distribuição por sexo" rows={data.sexDistribution} />
        <DistributionList title="Distribuição por faixa etária" rows={data.ageDistribution} />
        <DistributionList title="Forma clínica" rows={data.clinicalForms} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <CrossTable title="Forma clínica por sexo" rows={data.sexByForm} />
        <CrossTable title="Forma clínica por faixa etária" rows={data.ageByForm} />
      </div>
    </div>
  );
}

export function TracomaAnaliseView({ externalFilters, hideFilters = false }: { externalFilters?: TracomaFilters; hideFilters?: boolean } = {}) {
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

  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(pendingGve), [pendingGve]);

  useEffect(() => {
    if (!externalFilters) return;
    const nextGve = externalFilters.gve ?? "";
    const nextMunicipio = externalFilters.municipio ?? "";
    const nextStart = externalFilters.yearStart ? Number(externalFilters.yearStart) : undefined;
    const nextEnd = externalFilters.yearEnd ? Number(externalFilters.yearEnd) : undefined;
    setPendingGve(nextGve);
    setPendingMunicipio(nextMunicipio);
    setPendingYearStart(nextStart);
    setPendingYearEnd(nextEnd);
    setGve(nextGve);
    setMunicipio(nextMunicipio);
    setYearStart(nextStart);
    setYearEnd(nextEnd);
  }, [externalFilters]);


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

  const demographics = useQuery<TracomaDemographics>({
    queryKey: ["sinan-demografia", gve, municipio, yearStart, yearEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (gve) params.set("gve", gve);
      if (municipio) params.set("municipio", municipio);
      if (yearStart) params.set("yearStart", String(yearStart));
      if (yearEnd) params.set("yearEnd", String(yearEnd));
      const qs = params.toString();
      const res = await fetch(`/api/sinan/demografia${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar demografia SINAN tracoma");
      return data as TracomaDemographics;
    },
    staleTime: 5 * 60 * 1000
  });


  // Derived indicators
  const byMuni = rates.data?.byMunicipality ?? [];
  const byGveData = rates.data?.byGve ?? [];
  const totalExaminados = byMuni.reduce((s, r) => s + r.examinados, 0);
  const totalPositivos = byMuni.reduce((s, r) => s + r.positivos, 0);
  const prevMedia = totalExaminados > 0 ? (totalPositivos / totalExaminados) * 100 : null;
  const muniAcimaMeta = byMuni.filter((r) => (r.prevalencia ?? 0) > 5).length;
  const topPriorityMuni = [...byMuni]
    .filter((row) => (row.positivos ?? 0) > 0)
    .sort((a, b) => {
      const prevDiff = Number(b.prevalencia ?? -1) - Number(a.prevalencia ?? -1);
      return prevDiff !== 0 ? prevDiff : Number(b.positivos ?? 0) - Number(a.positivos ?? 0);
    })[0];
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
      {!hideFilters && <Card>
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
      </Card>}

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
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadTracamaCsv} disabled={!byMuni.length && !byGveData.length}>
                <Download className="h-3.5 w-3.5" />
                Exportar CSV
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/boletins?agravo=tracoma">
                  <FileText className="h-3.5 w-3.5" />
                  Boletins
                </Link>
              </Button>
            </div>
          </div>

          <ExecutiveSummary
            totalPositivos={totalPositivos}
            prevMedia={prevMedia}
            muniAcimaMeta={muniAcimaMeta}
            topPriorityMuni={topPriorityMuni}
            demographics={demographics.data}
          />

          <div className="space-y-4">
            <SectionIntro
              title="Indicadores principais"
              description="Síntese do recorte consolidado para acompanhar eliminação, carga ativa e cobertura operacional."
            />
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
          </div>

          <DemographicsPanel data={demographics.data} loading={demographics.isLoading} />

          <div className="space-y-4">
            <SectionIntro
              title="Território e taxas"
              description="Mapa e tabela para priorizar município ou GVE por prevalência, detecção e cobertura de exame."
            />
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
              direction={taxaMetric === "coberturaExame" ? "higher-better" : "higher-risk"}
              missingPopulation={false}
              tableColumns={
                taxaMapView === "municipio"
                  ? [
                      { key: "municipio", label: "Município" },
                      { key: "gve", label: "GVE" },
                      { key: "examinados", label: "Examinados", percentKey: "coberturaExame", percentDecimals: 2 },
                      { key: "positivos", label: "Positivos", percentKey: "prevalencia", percentDecimals: 2 },
                      { key: "prevalencia", label: "Prevalência", decimals: 2, suffix: "%" },
                      { key: "taxaDeteccao100k", label: "Detecção/100 mil", decimals: 2 },
                      { key: "coberturaExame", label: "Cobertura", decimals: 2, suffix: "%" },
                      { key: "populacao", label: "População" }
                    ]
                  : [
                      { key: "gve", label: "GVE" },
                      { key: "examinados", label: "Examinados", percentKey: "coberturaExame", percentDecimals: 2 },
                      { key: "positivos", label: "Positivos", percentKey: "prevalencia", percentDecimals: 2 },
                      { key: "prevalencia", label: "Prevalência", decimals: 2, suffix: "%" },
                      { key: "taxaDeteccao100k", label: "Detecção/100 mil", decimals: 2 },
                      { key: "coberturaExame", label: "Cobertura", decimals: 2, suffix: "%" },
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
    </div>
  );
}
