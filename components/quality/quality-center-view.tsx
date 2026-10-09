"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  RefreshCw,
  ShieldAlert,
  Stethoscope
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { QUALITY_BUCKETS, type QualityBucket } from "@/lib/cevesp-quality-buckets";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import type { InvalidRecord } from "@/services/cevesp-corrections";
import type { SinanAuditResult } from "@/services/sinan-tracoma";

interface CevespQuality {
  records: InvalidRecord[];
  byType: Record<string, number>;
  byGve: Array<{ gve: string; count: number }>;
  byAno: Array<{ ano: number; count: number }>;
  byMunicipio: Array<{ municipio: string; gve: string | null; count: number }>;
  total: number;
  byBucket?: Record<QualityBucket, number>;
  byBucketType?: Record<QualityBucket, Record<string, number>>;
  filteredTotal?: number;
  source?: string;
}

type Priority = "Critica" | "Alta" | "Media";

type QualityAction = {
  agravo: "CEVESP" | "SINAN";
  priority: Priority;
  problem: string;
  where: string;
  count: number;
  href: string;
};

type TerritoryRow = {
  municipio: string;
  gve: string;
  cevesp: number;
  sinan: number;
  divergencias: number;
  problems: string[];
  priority: Priority;
  href: string;
};

type QualityFilters = {
  yearStart: string;
  yearEnd: string;
  gve: string;
  municipio: string;
  agravo: "todos" | "conjuntivite" | "tracoma";
};

function priorityClass(priority: Priority) {
  if (priority === "Critica") return "border-red-200 bg-red-50 text-red-700";
  if (priority === "Alta") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function normalizePriority(value: string): Priority {
  if (value === "Critica") return "Critica";
  if (value === "Media") return "Media";
  const normalized = normalizeText(value);
  if (normalized === "critica" || normalized === "critico") return "Critica";
  if (normalized === "alta" || normalized === "alto") return "Alta";
  return "Media";
}

function priorityRank(priority: Priority) {
  return priority === "Critica" ? 0 : priority === "Alta" ? 1 : 2;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(";"),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`)
        .join(";")
    )
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? data.error ?? "Erro ao carregar dados.");
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("A consulta demorou demais. Verifique a sincronização/cache e tente atualizar.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function isCriticalCevespIssue(issue: string) {
  const normalized = normalizeText(issue);
  return (
    normalized.startsWith("ano impossivel") ||
    normalized.startsWith("dia impossivel") ||
    normalized.startsWith("se invalida") ||
    normalized.startsWith("municipio ausente") ||
    normalized.startsWith("gve ausente") ||
    normalized.startsWith("total de casos negativo")
  );
}

function groupCevespIssueLabel(label: string) {
  return label
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s*-\s*.+$/g, "")
    .trim() || label;
}

function groupedCevespTypes(byType?: Record<string, number>) {
  const grouped = new Map<string, number>();
  for (const [label, count] of Object.entries(byType ?? {})) {
    const key = groupCevespIssueLabel(label);
    grouped.set(key, (grouped.get(key) ?? 0) + count);
  }
  return Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
}

function buildActions(filters: QualityFilters, cevesp?: CevespQuality, sinan?: SinanAuditResult): QualityAction[] {
  const actions: QualityAction[] = [];

  if (cevesp?.total) {
    const criticalByType = Object.entries(cevesp.byType ?? {}).reduce(
      (sum, [issue, count]) => sum + (isCriticalCevespIssue(issue) ? count : 0),
      0
    );
    const criticalSample = cevesp.records.filter((record) => isCriticalCevespIssue(record.issue)).length;
    const critical = criticalByType || criticalSample;
    actions.push({
      agravo: "CEVESP",
      priority: critical > 0 ? "Critica" : "Alta",
      problem: "Inconsistências em notificações CEVESP",
      where: cevesp.byGve[0]?.gve ?? cevesp.byMunicipio[0]?.municipio ?? "base completa",
      count: cevesp.total,
      href: appendFilters("/conjuntivite", filters)
    });
  }

  if (sinan) {
    const critical = (sinan.ttSemTs ?? 0) + (sinan.tfSemTratamento ?? 0) + (sinan.ttSemCircurgia ?? 0);
    if (critical > 0) {
      actions.push({
        agravo: "SINAN",
        priority: "Critica",
        problem: "Inconsistências clínicas do tracoma",
        where: "TRACONET",
        count: critical,
        href: appendFilters("/tracoma", filters)
      });
    }

    const divergences = sinan.crossBankDivergences?.filter((item) => item.risco === "alto").length ?? 0;
    if (divergences > 0) {
      actions.push({
        agravo: "SINAN",
        priority: "Alta",
        problem: "Divergências TRACONET x NOTTRACONET",
        where: sinan.crossBankDivergences?.[0]?.gve ?? "municípios/anos",
        count: divergences,
        href: appendFilters("/tracoma", filters)
      });
    }

    const missing = (sinan.semConclusao ?? 0) + (sinan.semGraduacao ?? 0) + (sinan.missingNotificationId ?? 0);
    if (missing > 0) {
      actions.push({
        agravo: "SINAN",
        priority: "Media",
        problem: "Completude pendente no SINAN Tracoma",
        where: "campos de encerramento, forma clínica ou identificador",
        count: missing,
        href: appendFilters("/tracoma", filters)
      });
    }
  }

  return actions.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.count - a.count);
}

function buildTerritoryRows(filters: QualityFilters, cevesp?: CevespQuality, sinan?: SinanAuditResult): TerritoryRow[] {
  const map = new Map<string, TerritoryRow>();

  function ensure(municipio: string | null | undefined, gve: string | null | undefined, href: string) {
    const safeMunicipio = municipio?.trim() || "Município não informado";
    const safeGve = gve?.trim() || "GVE não informada";
    const key = `${normalizeText(safeMunicipio)}|${normalizeText(safeGve)}`;
    const current = map.get(key);
    if (current) return current;
    const row: TerritoryRow = {
      municipio: safeMunicipio,
      gve: safeGve,
      cevesp: 0,
      sinan: 0,
      divergencias: 0,
      problems: [],
      priority: "Media",
      href
    };
    map.set(key, row);
    return row;
  }

  function addProblem(row: TerritoryRow, problem: string, priority: Priority) {
    if (!row.problems.includes(problem)) row.problems.push(problem);
    if (priorityRank(priority) < priorityRank(row.priority)) row.priority = priority;
  }

  for (const item of cevesp?.byMunicipio ?? []) {
    const row = ensure(item.municipio, item.gve, appendFilters("/conjuntivite", { ...filters, municipio: item.municipio, gve: item.gve ?? filters.gve }));
    row.cevesp += item.count;
    addProblem(row, "qualidade CEVESP", item.count >= 20 ? "Alta" : "Media");
  }

  for (const item of sinan?.correctionRecords ?? []) {
    const row = ensure(item.municipioNome || item.municipio, item.gve, appendFilters("/tracoma", { ...filters, municipio: item.municipioNome || item.municipio, gve: item.gve ?? filters.gve }));
    row.sinan += 1;
    addProblem(row, item.problem, normalizePriority(item.priority));
  }

  for (const item of sinan?.crossBankDivergences ?? []) {
    if (item.risco !== "alto") continue;
    const row = ensure(item.municipioNome || item.municipio, item.gve, appendFilters("/tracoma", { ...filters, municipio: item.municipioNome || item.municipio, gve: item.gve ?? filters.gve }));
    row.divergencias += Math.abs(item.diff);
    addProblem(row, "divergência entre bancos", "Alta");
  }

  return Array.from(map.values())
    .sort((a, b) => {
      const aScore = a.cevesp + a.sinan * 3 + a.divergencias;
      const bScore = b.cevesp + b.sinan * 3 + b.divergencias;
      return priorityRank(a.priority) - priorityRank(b.priority) || bScore - aScore;
    });
}

function appendFilters(path: string, filters: QualityFilters, tab = "qualidade") {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (filters.yearStart) params.set("yearStart", filters.yearStart);
  if (filters.yearEnd) params.set("yearEnd", filters.yearEnd);
  if (filters.gve) params.set("gve", filters.gve);
  if (filters.municipio) params.set("municipio", filters.municipio);
  return `${path}?${params.toString()}`;
}

function qualityParams(filters: QualityFilters, source: "cevesp" | "sinan") {
  const params = new URLSearchParams();
  if (source === "cevesp") {
    params.set("source", "cache");
    if (filters.yearStart) params.set("ano", filters.yearStart);
    if (filters.yearEnd) params.set("anoFim", filters.yearEnd);
  } else {
    if (filters.yearStart) params.set("yearStart", filters.yearStart);
    if (filters.yearEnd) params.set("yearEnd", filters.yearEnd);
  }
  if (filters.gve) params.set("gve", filters.gve);
  if (filters.municipio) params.set("municipio", filters.municipio);
  return params;
}

const BUCKET_COLUNAS: Array<{
  id: QualityBucket;
  titulo: string;
  descricao: string;
  acao: string;
  href: (filters: QualityFilters) => string;
  cor: string;
  icon: typeof ClipboardCheck;
}> = [
  {
    id: "pronta",
    titulo: "Central resolve",
    descricao: "A auditoria já sabe o valor certo (semana trocada, SE em branco, ano errado, SE futura). Basta aprovar.",
    acao: "Revisar e aprovar",
    href: (filters) => `${appendFilters("/conjuntivite", filters)}&bucket=pronta`,
    cor: "bg-teal-700",
    icon: ClipboardCheck
  },
  {
    id: "decisao",
    titulo: "Central decide",
    descricao: "Registros repetidos da mesma unidade e semana. Alguém escolhe qual registro vale.",
    acao: "Revisar grupos",
    href: (filters) => `${appendFilters("/conjuntivite", filters)}&bucket=decisao`,
    cor: "bg-amber-500",
    icon: ShieldAlert
  },
  {
    id: "unidade",
    titulo: "GVE e unidade corrigem",
    descricao: "Só quem notificou sabe o valor certo: faixa etária, sexo, datas, contagens.",
    acao: "Ver lista para cobrança",
    href: (filters) => `${appendFilters("/conjuntivite", filters)}&bucket=unidade`,
    cor: "bg-slate-400",
    icon: Stethoscope
  }
];

function fmt(value: number) {
  return value.toLocaleString("pt-BR");
}

function BucketColumn({
  coluna,
  count,
  types,
  filters,
  loading
}: {
  coluna: (typeof BUCKET_COLUNAS)[number];
  count: number;
  types: Array<[string, number]>;
  filters: QualityFilters;
  loading: boolean;
}) {
  const Icon = coluna.icon;
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${coluna.cor}`} aria-hidden="true" />
        <h3 className="text-[15px] font-semibold">{coluna.titulo}</h3>
        <Icon className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <span className="num text-[32px] font-semibold leading-none">{loading ? "…" : fmt(count)}</span>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{coluna.descricao}</p>
      {types.length > 0 && (
        <ul className="divide-y rounded-lg border text-[13px]">
          {types.slice(0, 5).map(([label, value]) => (
            <li key={label} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate">{label}</span>
              <span className="num font-semibold">{fmt(value)}</span>
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant={coluna.id === "pronta" ? "default" : "outline"} className="mt-auto h-11">
        <Link href={coluna.href(filters)}>
          {coluna.acao}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </section>
  );
}

function SourceCard({
  titulo,
  fonte,
  children,
  href,
  linkLabel
}: {
  titulo: string;
  fonte: string;
  children: React.ReactNode;
  href: string;
  linkLabel: string;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">{titulo}</h2>
        <span className="text-xs text-muted-foreground">{fonte}</span>
      </div>
      {children}
      <Link href={href} className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        {linkLabel}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "danger" | "warn" }) {
  const cor = value === 0 ? "text-foreground" : tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-foreground";
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num mt-0.5 text-[22px] font-semibold leading-tight ${cor}`}>{fmt(value)}</p>
    </div>
  );
}

export function QualityCenterView() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<QualityFilters>({
    yearStart: searchParams.get("yearStart") ?? searchParams.get("ano") ?? "",
    yearEnd: searchParams.get("yearEnd") ?? searchParams.get("anoFim") ?? "",
    gve: searchParams.get("gve") ?? "",
    municipio: searchParams.get("municipio") ?? "",
    agravo: (searchParams.get("agravo") as QualityFilters["agravo"] | null) ?? "todos"
  });
  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(filters.gve), [filters.gve]);
  const showCevesp = filters.agravo === "todos" || filters.agravo === "conjuntivite";
  const showSinan = filters.agravo === "todos" || filters.agravo === "tracoma";

  const cevesp = useQuery<CevespQuality>({
    queryKey: ["quality-center-cevesp", filters],
    queryFn: () => fetchJsonWithTimeout<CevespQuality>(`/api/cevesp/qualidade?${qualityParams(filters, "cevesp")}`, 25000),
    enabled: showCevesp,
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const sinan = useQuery<SinanAuditResult>({
    queryKey: ["quality-center-sinan", filters],
    queryFn: () => fetchJsonWithTimeout<SinanAuditResult>(`/api/sinan/auditoria?${qualityParams(filters, "sinan")}`),
    enabled: showSinan,
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const actions = useMemo(() => buildActions(filters, showCevesp ? cevesp.data : undefined, showSinan ? sinan.data : undefined), [cevesp.data, filters, showCevesp, showSinan, sinan.data]);
  const territoryRows = useMemo(() => buildTerritoryRows(filters, showCevesp ? cevesp.data : undefined, showSinan ? sinan.data : undefined), [cevesp.data, filters, showCevesp, showSinan, sinan.data]);
  const bucketTypes = useMemo(() => {
    const result = {} as Record<QualityBucket, Array<[string, number]>>;
    for (const id of QUALITY_BUCKETS) result[id] = groupedCevespTypes(cevesp.data?.byBucketType?.[id]);
    return result;
  }, [cevesp.data?.byBucketType]);
  const sinanCorrections = showSinan ? sinan.data?.correctionRecords ?? [] : [];
  const byBucket = cevesp.data?.byBucket ?? { pronta: 0, decisao: 0, unidade: 0 };
  const bucketTotal = byBucket.pronta + byBucket.decisao + byBucket.unidade;
  const sinanCritical = (sinan.data?.ttSemTs ?? 0) + (sinan.data?.tfSemTratamento ?? 0) + (sinan.data?.ttSemCircurgia ?? 0);
  const sinanDivergences = sinan.data?.crossBankDivergences?.filter((item) => item.risco === "alto").length ?? 0;
  const filtrosAtivos = Boolean(filters.yearStart || filters.yearEnd || filters.gve || filters.municipio || filters.agravo !== "todos");

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <PageHeader
        title="Qualidade dos dados"
        description="Pendências dos dois bancos separadas por quem resolve. O detalhe de cada registro fica na análise do agravo."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={() => { cevesp.refetch(); sinan.refetch(); }}>
              <RefreshCw className={`h-4 w-4 ${cevesp.isFetching || sinan.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => downloadCsv(`qualidade-plano-acao-${new Date().toISOString().slice(0, 10)}.csv`, actions.map((item) => ({ ...item })))}
              disabled={!actions.length}
            >
              <Download className="h-4 w-4" />
              Exportar plano
            </Button>
            <Button className="h-11" asChild>
              <Link href="/correcoes">Abrir fila de correções</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Agravo
          <select
            value={filters.agravo}
            onChange={(event) => setFilters((current) => ({ ...current, agravo: event.target.value as QualityFilters["agravo"] }))}
            className="h-10 rounded-lg border bg-background px-2.5 text-sm text-foreground"
          >
            <option value="todos">Todos</option>
            <option value="conjuntivite">Conjuntivites</option>
            <option value="tracoma">Tracoma</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Ano
          <input
            type="number"
            value={filters.yearStart}
            placeholder="Atual"
            onChange={(event) => setFilters((current) => ({ ...current, yearStart: event.target.value }))}
            className="h-10 w-24 rounded-lg border bg-background px-2.5 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          até
          <input
            type="number"
            value={filters.yearEnd}
            onChange={(event) => setFilters((current) => ({ ...current, yearEnd: event.target.value }))}
            className="h-10 w-24 rounded-lg border bg-background px-2.5 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          GVE
          <select
            value={filters.gve}
            onChange={(event) => setFilters((current) => ({ ...current, gve: event.target.value, municipio: "" }))}
            className="h-10 min-w-44 rounded-lg border bg-background px-2.5 text-sm text-foreground"
          >
            <option value="">Todos os GVEs</option>
            {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Município
          <select
            value={filters.municipio}
            onChange={(event) => setFilters((current) => ({ ...current, municipio: event.target.value }))}
            className="h-10 min-w-48 rounded-lg border bg-background px-2.5 text-sm text-foreground"
          >
            <option value="">Todos os municípios</option>
            {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
          </select>
        </label>
        {filtrosAtivos && (
          <Button variant="ghost" className="h-10" onClick={() => setFilters({ yearStart: "", yearEnd: "", gve: "", municipio: "", agravo: "todos" })}>
            Limpar
          </Button>
        )}
      </div>

      {(cevesp.isError || sinan.isError) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {cevesp.isError && (
            <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              CEVESP indisponível nesta consulta: {cevesp.error.message}
            </p>
          )}
          {sinan.isError && (
            <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              SINAN indisponível nesta consulta: {sinan.error.message}
            </p>
          )}
        </div>
      )}

      <div className={`grid gap-4 ${showCevesp && showSinan ? "lg:grid-cols-2" : ""}`}>
        {showCevesp && (
          <SourceCard titulo="Conjuntivites (CEVESP)" fonte="cache do banco CEVESP" href={appendFilters("/conjuntivite", filters)} linkLabel="Abrir qualidade das conjuntivites">
            {cevesp.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="num text-[32px] font-semibold leading-none">{fmt(cevesp.data?.total ?? 0)}</span>
                  <span className="text-sm text-muted-foreground">pendências</span>
                </div>
                {bucketTotal > 0 ? (
                  <>
                    <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Pendências por quem resolve">
                      {BUCKET_COLUNAS.map((coluna) => (
                        <span key={coluna.id} className={coluna.cor} style={{ width: `${(byBucket[coluna.id] / bucketTotal) * 100}%` }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                      {BUCKET_COLUNAS.map((coluna) => (
                        <span key={coluna.id} className="inline-flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 rounded-sm ${coluna.cor}`} />
                          {coluna.titulo} <span className="num font-semibold text-foreground">{fmt(byBucket[coluna.id])}</span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-teal-600" /> Nenhuma pendência no recorte.
                  </p>
                )}
              </>
            )}
          </SourceCard>
        )}
        {showSinan && (
          <SourceCard titulo="Tracoma (SINAN)" fonte="TRACONET e NOTTRACONET importados" href={appendFilters("/tracoma", filters)} linkLabel="Abrir qualidade do tracoma">
            {sinan.isLoading ? (
              <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
            ) : sinan.data ? (
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Inconsistência clínica" value={sinanCritical} tone="danger" />
                <Metric label="Divergência entre bancos" value={sinanDivergences} tone="danger" />
                <Metric label="Sem conclusão" value={sinan.data.semConclusao ?? 0} tone="warn" />
                <Metric label="Registros para cobrança" value={sinanCorrections.length} tone="warn" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Importe TRACONET e NOTTRACONET para auditar.</p>
            )}
          </SourceCard>
        )}
      </div>

      {showCevesp && (
        <section className="space-y-3">
          <div>
            <h2 className="text-[20px] font-bold tracking-tight">Quem resolve</h2>
            <p className="text-[14px] text-muted-foreground">Pendências das conjuntivites separadas pelo tipo de ação necessária.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {BUCKET_COLUNAS.map((coluna) => (
              <BucketColumn
                key={coluna.id}
                coluna={coluna}
                count={byBucket[coluna.id]}
                types={bucketTypes[coluna.id]}
                filters={filters}
                loading={cevesp.isLoading}
              />
            ))}
          </div>
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-semibold">Territórios com mais pendências</h2>
            <span className="num text-[13px] text-muted-foreground">{fmt(territoryRows.length)}</span>
          </div>
          {territoryRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem território com pendência nos dados carregados.</p>
          ) : (
            <ul className="divide-y">
              {territoryRows.slice(0, 6).map((row) => (
                <li key={`${row.municipio}-${row.gve}`}>
                  <Link href={row.href} className="flex items-center gap-3 py-2.5 hover:bg-muted/40">
                    <Badge className={priorityClass(row.priority)}>{row.priority === "Critica" ? "Crítica" : row.priority === "Media" ? "Média" : row.priority}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{row.municipio}</span>
                      <span className="block truncate text-xs text-muted-foreground">{row.gve} · {row.problems[0] ?? "revisar"}</span>
                    </span>
                    <span className="num text-sm">{fmt(row.cevesp + row.sinan)}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/territorios" className="text-sm font-semibold text-primary hover:underline">Abrir priorização territorial</Link>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-semibold">Tracoma: onde agir primeiro</h2>
            {sinanCorrections.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCsv(`qualidade-sinan-correcoes-${new Date().toISOString().slice(0, 10)}.csv`, sinanCorrections.map((item) => ({ ...item })))}
              >
                <Download className="h-4 w-4" />
                Exportar
              </Button>
            )}
          </div>
          {sinanCorrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem registro do SINAN para corrigir no recorte.</p>
          ) : (
            <ul className="divide-y">
              {sinanCorrections.slice(0, 6).map((item, index) => (
                <li key={`${item.rowKey}-${index}`} className="flex items-center gap-3 py-2.5 text-sm">
                  <Badge className={priorityClass(normalizePriority(item.priority))}>{normalizePriority(item.priority) === "Critica" ? "Crítica" : normalizePriority(item.priority) === "Media" ? "Média" : "Alta"}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.problem}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.municipioNome || item.municipio} · {item.gve}</span>
                  </span>
                  <span className="num max-w-[130px] truncate text-xs text-muted-foreground">{item.notificationId ?? item.rowKey ?? "-"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
