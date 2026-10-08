"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RateMap } from "@/components/epidemiology/rate-map";
import { TracomaChartsView } from "@/components/tracoma/tracoma-charts-view";

type MuniRow = {
  codigoIbge: string;
  municipio: string;
  gve: string;
  examinados: number | null;
  positivos: number | null;
  populacao: number | null;
  prevalencia: number | null;
  taxaDeteccao100k: number | null;
  coberturaExame: number | null;
  riskColor: string;
  populationSourceYears?: number[];
  missingYears?: number[];
};

type GveRow = {
  gve: string;
  examinados: number | null;
  positivos: number | null;
  populacao: number | null;
  prevalencia: number | null;
  taxaDeteccao100k: number | null;
  coberturaExame: number | null;
  populationSourceYears?: number[];
  missingYears?: number[];
  reportedMunicipalities?: number;
  territoryMunicipalities?: number;
};

type TracomaRates = {
  missingPopulation?: boolean;
  message?: string;
  analysisYear?: number;
  isPeriod?: boolean;
  periodStart?: number | null;
  periodEnd?: number | null;
  populationYear?: number | null;
  metric?: string;
  warnings?: string[];
  methodology?: string;
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
  warnings?: string[];
};

type TracomaFilters = {
  yearStart?: string;
  yearEnd?: string;
  gve?: string;
  municipio?: string;
};

function num(value: unknown) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("pt-BR");
}

function pct(value: number | null | undefined, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: decimals })}%`;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "default"
}: {
  label: string;
  value: string | number | null;
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
          {typeof value === "number" || value == null ? num(value) : value}
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
  totalPositivos: number | null;
  prevMedia: number | null;
  muniAcimaMeta: number;
  topPriorityMuni?: MuniRow;
  demographics?: TracomaDemographics;
}) {
  const missingClinical = demographics ? demographics.totalRows - demographics.withClinicalForm : 0;
  const nextAction = missingClinical > 0 ? "Revisar os registros sem forma clínica na aba Qualidade dos Dados." : "Conferir completude e contexto de busca ativa antes de interpretar o recorte.";
  const itemClass = "rounded-md border bg-background p-3";
  const labelClass = "text-xs font-medium uppercase text-muted-foreground";
  const valueClass = "mt-1 text-sm font-semibold leading-snug";
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Resumo executivo</CardTitle>
        <CardDescription>Resumo dos registros disponíveis no recorte selecionado.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        <div className={itemClass}>
          <div className={labelClass}>Positivos informados</div>
          <div className={valueClass}>{num(totalPositivos)}</div>
          <div className="mt-1 text-xs text-muted-foreground">consolidado NOTTRACONET</div>
        </div>
        <div className={itemClass}>
          <div className={labelClass}>Maior positividade observada</div>
          <div className={valueClass}>
            {topPriorityMuni
              ? `${topPriorityMuni.municipio} (${pct(topPriorityMuni.prevalencia)})`
              : "Sem positividade calculável"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {topPriorityMuni ? `${num(topPriorityMuni.examinados)} examinados; interpretar o tamanho do denominador` : `${num(muniAcimaMeta)} município(s) com indicador calculável`}
          </div>
        </div>
        <div className={itemClass}>
          <div className={labelClass}>Sinal principal</div>
          <div className={valueClass}>{prevMedia != null ? pct(prevMedia) : "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">positivos / examinados no consolidado</div>
        </div>
        <div className={itemClass}>
          <div className={labelClass}>Próxima ação</div>
          <div className={valueClass}>{nextAction}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DistributionList({ title, rows, denominator }: { title: string; rows: DemographicBucket[]; denominator?: number }) {
  const total = denominator ?? rows.reduce((sum, row) => sum + row.total, 0);
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

type PctMode = "linha" | "coluna";

function CrossCell({ value, rowTotal, columnTotal, mode }: { value: number; rowTotal: number; columnTotal: number; mode: PctMode }) {
  const pct = mode === "linha" ? cellPercent(value, rowTotal) : cellPercent(value, columnTotal);
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <div className="font-medium">{num(value)}</div>
      <div className="text-[11px] text-muted-foreground">{pct}</div>
    </td>
  );
}

function CrossTable({ title, rows }: { title: string; rows: DemographicCross[] }) {
  const [mode, setMode] = useState<PctMode>("coluna");
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const columnTotals = {
    TF: rows.reduce((sum, row) => sum + row.TF, 0),
    TI: rows.reduce((sum, row) => sum + row.TI, 0),
    TS: rows.reduce((sum, row) => sum + row.TS, 0),
    TT: rows.reduce((sum, row) => sum + row.TT, 0),
    CO: rows.reduce((sum, row) => sum + row.CO, 0),
    semForma: rows.reduce((sum, row) => sum + row.semForma, 0)
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <div className="flex shrink-0 overflow-hidden rounded-md border text-xs">
            <button
              onClick={() => setMode("coluna")}
              className={`px-2 py-1 transition-colors ${mode === "coluna" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              % coluna
            </button>
            <button
              onClick={() => setMode("linha")}
              className={`border-l px-2 py-1 transition-colors ${mode === "linha" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              % linha
            </button>
          </div>
        </div>
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
                    <CrossCell value={row.TF} rowTotal={row.total} columnTotal={columnTotals.TF} mode={mode} />
                    <CrossCell value={row.TI} rowTotal={row.total} columnTotal={columnTotals.TI} mode={mode} />
                    <CrossCell value={row.TS} rowTotal={row.total} columnTotal={columnTotals.TS} mode={mode} />
                    <CrossCell value={row.TT} rowTotal={row.total} columnTotal={columnTotals.TT} mode={mode} />
                    <CrossCell value={row.CO} rowTotal={row.total} columnTotal={columnTotals.CO} mode={mode} />
                    <CrossCell value={row.semForma} rowTotal={row.total} columnTotal={columnTotals.semForma} mode={mode} />
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      <span>{num(row.total)}</span>
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">({cellPercent(row.total, grandTotal)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 font-semibold">
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(columnTotals.TF)} ({cellPercent(columnTotals.TF, grandTotal)})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(columnTotals.TI)} ({cellPercent(columnTotals.TI, grandTotal)})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(columnTotals.TS)} ({cellPercent(columnTotals.TS, grandTotal)})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(columnTotals.TT)} ({cellPercent(columnTotals.TT, grandTotal)})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(columnTotals.CO)} ({cellPercent(columnTotals.CO, grandTotal)})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(columnTotals.semForma)} ({cellPercent(columnTotals.semForma, grandTotal)})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(grandTotal)} (100%)</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DemographicsPanel({ data, loading, error }: { data?: TracomaDemographics; loading: boolean; error?: Error | null }) {
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
            {error?.message ?? data?.message ?? "Importe o TRACONET para visualizar sexo, idade e forma clínica."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!data.totalRows) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Nenhum registro individual TRACONET no recorte selecionado.</CardContent></Card>;

  const childrenOneToNine = data.ageDistribution
    .filter((row) => row.label === "1 a 4 anos" || row.label === "5 a 9 anos")
    .reduce((sum, row) => sum + row.total, 0);
  const childrenOneToNinePct = data.totalRows ? ((childrenOneToNine / data.totalRows) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Perfil demográfico TRACONET</h2>
        <p className="text-sm text-muted-foreground">
          Sexo, faixa etária e forma clínica dos registros individuais. Um registro pode ter várias formas; os percentuais de formas usam o total de registros e podem somar mais de 100%.
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
        <DistributionList title="Forma clínica" rows={data.clinicalForms} denominator={data.totalRows} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <CrossTable title="Forma clínica por sexo" rows={data.sexByForm} />
        <CrossTable title="Forma clínica por faixa etária" rows={data.ageByForm} />
      </div>
    </div>
  );
}

export function TracomaAnaliseView({ externalFilters }: { externalFilters?: TracomaFilters } = {}) {
  const gve = externalFilters?.gve ?? "";
  const municipio = externalFilters?.municipio ?? "";
  const yearStart = externalFilters?.yearStart ? Number(externalFilters.yearStart) : undefined;
  const yearEnd = externalFilters?.yearEnd ? Number(externalFilters.yearEnd) : undefined;

  const [taxaMapView, setTaxaMapView] = useState<"municipio" | "gve">("municipio");
  const [taxaMetric, setTaxaMetric] = useState<"prevalencia" | "taxaDeteccao100k" | "coberturaExame">("prevalencia");

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
  const totalExaminados = byMuni.some((r) => r.examinados == null) ? null : byMuni.reduce((s, r) => s + (r.examinados ?? 0), 0);
  const totalPositivos = byMuni.some((r) => r.positivos == null) ? null : byMuni.reduce((s, r) => s + (r.positivos ?? 0), 0);
  const prevMedia = byMuni.some((r) => r.prevalencia == null && (r.examinados ?? 0) > 0) ? null : totalExaminados != null && totalExaminados > 0 && totalPositivos != null && totalPositivos <= totalExaminados ? (totalPositivos / totalExaminados) * 100 : null;
  const muniAcimaMeta = byMuni.filter((r) => r.prevalencia != null).length;
  const topPriorityMuni = [...byMuni]
    .filter((row) => row.prevalencia != null && (row.positivos ?? 0) > 0)
    .sort((a, b) => {
      const prevDiff = Number(b.prevalencia ?? -1) - Number(a.prevalencia ?? -1);
      return prevDiff !== 0 ? prevDiff : Number(b.positivos ?? 0) - Number(a.positivos ?? 0);
    })[0];
  const hasData = Boolean(rates.data) && !rates.isLoading && !rates.isError;

  function downloadTracamaCsv() {
    const escape = (v: unknown) => {
      const t = String(v ?? "");
      return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const sections: string[] = [];
    if (byMuni.length) {
      sections.push(`Positividade por município;Período ${rates.data?.periodStart ?? ""} a ${rates.data?.periodEnd ?? ""};Fonte NOTTRACONET`);
      sections.push(["Município", "GVE", "Examinados", "Positivos", "Positividade (%)", "Exames/população anual (%)", "Detecção registrada/100 mil", "Anos IBGE usados", "Anos sem registros"].map(escape).join(";"));
      for (const r of byMuni) {
        sections.push([
          r.municipio, r.gve, r.examinados, r.positivos,
          r.prevalencia != null ? Number(r.prevalencia).toFixed(2).replace(".", ",") : "",
          r.coberturaExame != null ? Number(r.coberturaExame).toFixed(2).replace(".", ",") : "",
          r.taxaDeteccao100k != null ? Number(r.taxaDeteccao100k).toFixed(2).replace(".", ",") : "", r.populationSourceYears?.join(", "), r.missingYears?.join(", ")
        ].map(escape).join(";"));
      }
    }
    if (byGveData.length) {
      if (sections.length) sections.push("");
      sections.push("Positividade por GVE");
      sections.push(["GVE", "Examinados", "Positivos", "Positividade (%)", "Exames/população anual (%)", "Detecção registrada/100 mil", "Anos IBGE usados", "Municípios com registros", "Municípios no território", "Anos sem registros"].map(escape).join(";"));
      for (const r of byGveData) {
        sections.push([
          r.gve, r.examinados, r.positivos,
          r.prevalencia != null ? Number(r.prevalencia).toFixed(2).replace(".", ",") : "",
          r.coberturaExame != null ? Number(r.coberturaExame).toFixed(2).replace(".", ",") : "",
          r.taxaDeteccao100k != null ? Number(r.taxaDeteccao100k).toFixed(2).replace(".", ",") : "", r.populationSourceYears?.join(", "), r.reportedMunicipalities, r.territoryMunicipalities, r.missingYears?.join(", ")
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
    <div className="min-w-0 space-y-6 p-4 sm:p-6">
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

      {rates.data?.warnings && <details className="rounded-lg border bg-muted/20 p-4 text-sm"><summary className="cursor-pointer font-medium">Como interpretar os indicadores e limitações</summary><ul className="mt-3 space-y-2 text-muted-foreground">{rates.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-3 text-xs text-muted-foreground">{rates.data.methodology}</p><a className="mt-3 inline-block text-primary underline" href="https://www.who.int/en/news-room/fact-sheets/detail/trachoma" target="_blank" rel="noreferrer">Critérios de eliminação da OMS</a></details>}

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
              <Button variant="outline" size="sm" onClick={downloadTracamaCsv} disabled={rates.isFetching || (!byMuni.length && !byGveData.length)}>
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
              description="Contagens e positividade do NOTTRACONET no recorte. Não representam prevalência populacional nem confirmam eliminação."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard
                label="Municípios com dados"
                value={byMuni.length}
                detail="com consolidado no recorte"
              />
              <MetricCard
                label="Total examinados"
                value={totalExaminados}
                detail="acumulado no período selecionado"
              />
              <MetricCard
                label="Positivos informados"
                value={totalPositivos}
                detail="campo de positivos do consolidado"
              />
              <MetricCard
                label="Positividade entre examinados"
                value={prevMedia != null ? pct(prevMedia) : "—"}
                detail="positivos / examinados × 100"
              />
              <MetricCard
                label="Indicador calculável"
                value={muniAcimaMeta}
                detail="municípios com positividade válida"
              />
            </div>
          </div>

          <div className="space-y-4">
            <SectionIntro
              title="Território e taxas"
              description="Mapa e tabela de positividade, detecção registrada e atividade de exames. Compare considerando o número de examinados e a completude."
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
                aria-label="Indicador do mapa de tracoma"
                onChange={(event) => setTaxaMetric(event.target.value as typeof taxaMetric)}
                className="h-8 rounded-md border bg-background px-2 text-xs font-medium"
              >
                <option value="prevalencia">Positividade entre examinados %</option>
                <option value="taxaDeteccao100k">Detecção registrada/100 mil</option>
                <option value="coberturaExame">Exames/população anual %</option>
              </select>
            </div>
            <RateMap
              title={`Mapa operacional de ${
                taxaMetric === "prevalencia"
                  ? "positividade"
                  : taxaMetric === "taxaDeteccao100k"
                    ? "taxa de detecção"
                    : "atividade de exames"
              } por ${taxaMapView === "municipio" ? "município" : "GVE"}${
                rates.data!.periodStart && rates.data!.periodEnd
                  ? ` - ${rates.data!.periodStart === rates.data!.periodEnd ? rates.data!.periodStart : `${rates.data!.periodStart} a ${rates.data!.periodEnd}`}`
                  : ""
              }`}
              description={
                rates.data!.isPeriod
                  ? `Positividade acumulada e indicadores médios anuais de ${rates.data!.periodStart}–${rates.data!.periodEnd}. População de todo o território selecionado no GVE; municípios sem registros limitam a interpretação.`
                  : `Positividade nos registros disponíveis. Pop. IBGE efetivamente usada: ${rates.data!.populationYear ?? "consultar anos no CSV"}.`
              }
              rows={taxaMapView === "municipio" ? rates.data!.byMunicipality ?? [] : rates.data!.byGve ?? []}
              valueKey={taxaMetric}
              valueLabel={taxaMetric === "taxaDeteccao100k" ? "por 100 mil hab." : "%"}
              direction="higher-risk"
              missingPopulation={false}
              tableColumns={
                taxaMapView === "municipio"
                  ? [
                      { key: "municipio", label: "Município" },
                      { key: "gve", label: "GVE" },
                      { key: "examinados", label: "Examinados", percentKey: "coberturaExame", percentDecimals: 2 },
                      { key: "positivos", label: "Positivos", percentKey: "prevalencia", percentDecimals: 2 },
                      { key: "prevalencia", label: "Positividade", decimals: 2, suffix: "%" },
                      { key: "taxaDeteccao100k", label: "Detecção/100 mil", decimals: 2 },
                      { key: "populacao", label: rates.data!.isPeriod ? `Pop. IBGE (média ${rates.data!.periodStart}–${rates.data!.periodEnd})` : `Pop. IBGE${rates.data!.populationYear ? ` ${rates.data!.populationYear}` : ""}` }
                    ]
                  : [
                      { key: "gve", label: "GVE" },
                      { key: "reportedMunicipalities", label: "Municípios com registros" },
                      { key: "territoryMunicipalities", label: "Municípios do território" },
                      { key: "examinados", label: "Examinados", percentKey: "coberturaExame", percentDecimals: 2 },
                      { key: "positivos", label: "Positivos", percentKey: "prevalencia", percentDecimals: 2 },
                      { key: "prevalencia", label: "Positividade", decimals: 2, suffix: "%" },
                      { key: "taxaDeteccao100k", label: "Detecção/100 mil", decimals: 2 },
                      { key: "populacao", label: rates.data!.isPeriod ? `Pop. IBGE (média ${rates.data!.periodStart}–${rates.data!.periodEnd})` : `Pop. IBGE${rates.data!.populationYear ? ` ${rates.data!.populationYear}` : ""}` }
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
      <div className="space-y-4">
        <SectionIntro title="Série histórica" description="Cada banco conserva sua própria contagem. Lacunas representam ausência de dados disponíveis." />
        <TracomaChartsView filters={{ gve: gve || undefined, municipio: municipio || undefined, yearStart: yearStart ? String(yearStart) : undefined, yearEnd: yearEnd ? String(yearEnd) : undefined }} />
      </div>
      <DemographicsPanel data={demographics.data} loading={demographics.isLoading} error={demographics.error} />
    </div>
  );
}
