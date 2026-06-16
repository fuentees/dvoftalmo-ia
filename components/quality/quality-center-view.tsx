"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  Eye,
  RefreshCw,
  ShieldAlert,
  Stethoscope
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InvalidRecord } from "@/services/cevesp-corrections";
import type { SinanAuditResult } from "@/services/sinan-tracoma";

interface CevespQuality {
  records: InvalidRecord[];
  byType: Record<string, number>;
  byGve: Array<{ gve: string; count: number }>;
  byAno: Array<{ ano: number; count: number }>;
  byMunicipio: Array<{ municipio: string; gve: string | null; count: number }>;
  total: number;
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

function buildActions(cevesp?: CevespQuality, sinan?: SinanAuditResult): QualityAction[] {
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
      href: "/conjuntivite"
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
        href: "/tracoma"
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
        href: "/tracoma"
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
        href: "/tracoma"
      });
    }
  }

  return actions.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.count - a.count);
}

function buildTerritoryRows(cevesp?: CevespQuality, sinan?: SinanAuditResult): TerritoryRow[] {
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
    const row = ensure(item.municipio, item.gve, "/cevesp-qualidade");
    row.cevesp += item.count;
    addProblem(row, "qualidade CEVESP", item.count >= 20 ? "Alta" : "Media");
  }

  for (const item of sinan?.correctionRecords ?? []) {
    const row = ensure(item.municipioNome || item.municipio, item.gve, "/sinan-qualidade");
    row.sinan += 1;
    addProblem(row, item.problem, normalizePriority(item.priority));
  }

  for (const item of sinan?.crossBankDivergences ?? []) {
    if (item.risco !== "alto") continue;
    const row = ensure(item.municipioNome || item.municipio, item.gve, "/sinan-qualidade");
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

const TERRITORY_PAGE = 12;

function TerritoryTable({ rows }: { rows: TerritoryRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, TERRITORY_PAGE);
  const hidden = rows.length - TERRITORY_PAGE;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Pendências por território</CardTitle>
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground">{rows.length.toLocaleString("pt-BR")} território(s)</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem território priorizado com os dados carregados.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Município</th>
                    <th className="px-3 py-2 text-left font-medium">GVE</th>
                    <th className="px-3 py-2 text-right font-medium">CEVESP</th>
                    <th className="px-3 py-2 text-right font-medium">SINAN</th>
                    <th className="px-3 py-2 text-right font-medium">Divergência</th>
                    <th className="px-3 py-2 text-left font-medium">Prioridade</th>
                    <th className="px-3 py-2 text-left font-medium">Principal achado</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={`${row.municipio}-${row.gve}`} className="border-t hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium">{row.municipio}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.gve}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.cevesp.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.sinan.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.divergencias.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2"><Badge className={priorityClass(row.priority)}>{row.priority}</Badge></td>
                      <td className="px-3 py-2">
                        <Link href={row.href} className="inline-flex max-w-[340px] items-center gap-1 truncate text-primary hover:underline">
                          {row.problems[0] ?? "revisar território"}
                          <ArrowRight className="h-3 w-3 shrink-0" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!showAll && hidden > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="mt-2 w-full rounded-md border border-dashed py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                + {hidden.toLocaleString("pt-BR")} território(s) com menor prioridade — clique para ver todos
              </button>
            )}
            {showAll && rows.length > TERRITORY_PAGE && (
              <button
                onClick={() => setShowAll(false)}
                className="mt-2 w-full rounded-md border border-dashed py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                Recolher — exibir apenas os {TERRITORY_PAGE} prioritários
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  detail,
  tone
}: {
  title: string;
  value: number | string;
  detail: string;
  tone: "ok" | "warn" | "danger";
}) {
  const style = {
    ok: "border-teal-200 bg-teal-50 text-teal-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700"
  }[tone];
  return (
    <Card className={style}>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide opacity-80">{title}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</p>
        <p className="mt-1 text-xs opacity-80">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function QualityCenterView() {
  const cevesp = useQuery<CevespQuality>({
    queryKey: ["quality-center-cevesp"],
    queryFn: () => fetchJsonWithTimeout<CevespQuality>("/api/cevesp/qualidade"),
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const sinan = useQuery<SinanAuditResult>({
    queryKey: ["quality-center-sinan"],
    queryFn: () => fetchJsonWithTimeout<SinanAuditResult>("/api/sinan/auditoria"),
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const actions = useMemo(() => buildActions(cevesp.data, sinan.data), [cevesp.data, sinan.data]);
  const territoryRows = useMemo(() => buildTerritoryRows(cevesp.data, sinan.data), [cevesp.data, sinan.data]);
  const cevespTypeRows = useMemo(() => groupedCevespTypes(cevesp.data?.byType), [cevesp.data?.byType]);
  const sinanCorrections = sinan.data?.correctionRecords ?? [];
  const loading = cevesp.isLoading || sinan.isLoading;
  const cevespTotal = cevesp.data?.total ?? 0;
  const sinanCritical =
    (sinan.data?.ttSemTs ?? 0) +
    (sinan.data?.tfSemTratamento ?? 0) +
    (sinan.data?.ttSemCircurgia ?? 0);
  const sinanDivergences = sinan.data?.crossBankDivergences?.filter((item) => item.risco === "alto").length ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="border-primary/30 bg-primary/10 text-primary">Central de Qualidade</Badge>
            {actions.length > 0 ? (
              <Badge className="border-red-200 bg-red-50 text-red-700">{actions.length} frentes de ação</Badge>
            ) : (
              <Badge className="border-teal-200 bg-teal-50 text-teal-700">sem prioridade crítica carregada</Badge>
            )}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Qualidade dos dados epidemiológicos</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Visão única para acompanhar inconsistências, divergências, campos incompletos e a fila de correção dos bancos CEVESP e SINAN Tracoma.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { cevesp.refetch(); sinan.refetch(); }}>
            <RefreshCw className={`h-4 w-4 ${cevesp.isFetching || sinan.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" asChild>
            <Link href="/correcoes">Abrir fila</Link>
          </Button>
        </div>
      </div>

      {(cevesp.isError || sinan.isError) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {cevesp.isError && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex gap-3 pt-5 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-medium">CEVESP indisponível nesta consulta</p>
                  <p className="text-amber-800">{cevesp.error.message}</p>
                </div>
              </CardContent>
            </Card>
          )}
          {sinan.isError && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex gap-3 pt-5 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-medium">SINAN indisponível nesta consulta</p>
                  <p className="text-amber-800">{sinan.error.message}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-md border bg-card text-sm text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Consolidando qualidade dos bancos...
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="CEVESP"
              value={cevespTotal}
              detail="registros com inconsistência"
              tone={cevespTotal > 0 ? "warn" : "ok"}
            />
            <StatCard
              title="SINAN clínico"
              value={sinanCritical}
              detail="TF/TT/tratamento/cirurgia para revisar"
              tone={sinanCritical > 0 ? "danger" : "ok"}
            />
            <StatCard
              title="Divergências"
              value={sinanDivergences}
              detail="comparações de alto risco entre bancos"
              tone={sinanDivergences > 0 ? "danger" : "ok"}
            />
            <StatCard
              title="Correções exportáveis"
              value={sinanCorrections.length}
              detail="registros SINAN com identificação para cobrança"
              tone={sinanCorrections.length > 0 ? "warn" : "ok"}
            />
          </div>

          <Card>
            <CardContent className="grid gap-3 pt-5 md:grid-cols-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fonte CEVESP</p>
                <p className="mt-1 text-sm font-semibold">{cevesp.data?.source === "cevesp_quality_audit" ? "Auditoria com fallback para cache" : "Não carregada"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {cevesp.data ? `${cevesp.data.total.toLocaleString("pt-BR")} pendências totais` : "Sem resposta da API"}
                </p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fonte SINAN</p>
                <p className="mt-1 text-sm font-semibold">{sinan.data ? "Cache Supabase dos DBF importados" : "Não carregada"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sinan.data ? `${sinan.data.totalTraconet.toLocaleString("pt-BR")} TRACONET e ${sinan.data.totalNottraconet.toLocaleString("pt-BR")} NOTTRACONET` : "Importe TRACONET/NOTTRACONET"}
                </p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cobertura operacional</p>
                <p className="mt-1 text-sm font-semibold">{territoryRows.length.toLocaleString("pt-BR")} territórios priorizados</p>
                <p className="mt-1 text-xs text-muted-foreground">Lista consolidada por município/GVE para orientar cobrança.</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Plano de ação</CardTitle>
                  {sinanCorrections.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadCsv(`qualidade-sinan-correcoes-${new Date().toISOString().slice(0, 10)}.csv`, sinanCorrections.map((item) => ({ ...item })))}
                    >
                      <Download className="h-4 w-4" />
                      Exportar SINAN
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {actions.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                    <CheckCircle2 className="mb-2 h-8 w-8 text-teal-600" />
                    Nenhuma prioridade crítica identificada com os dados carregados.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {actions.map((action, index) => (
                      <Link
                        key={`${action.agravo}-${action.problem}-${index}`}
                        href={action.href}
                        className="group grid gap-3 rounded-md border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5 md:grid-cols-[120px_1fr_auto]"
                      >
                        <div className="flex items-center gap-2">
                          {action.agravo === "CEVESP" ? <Eye className="h-4 w-4 text-primary" /> : <Stethoscope className="h-4 w-4 text-primary" />}
                          <span className="text-sm font-semibold">{action.agravo}</span>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={priorityClass(action.priority)}>{action.priority}</Badge>
                            <span className="text-sm font-medium">{action.problem}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{action.where}</p>
                        </div>
                        <div className="flex items-center justify-between gap-3 md:justify-end">
                          <span className="text-lg font-semibold tabular-nums">{action.count.toLocaleString("pt-BR")}</span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Caminho de trabalho</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { icon: Database, title: "1. Importar/validar bases", text: "Confirme DBF, cache CEVESP e população IBGE.", href: "/sincronizacao" },
                  { icon: ShieldAlert, title: "2. Auditar qualidade", text: "Revise CEVESP e SINAN por prioridade.", href: "/qualidade-dados" },
                  { icon: ClipboardCheck, title: "3. Corrigir e cobrar", text: "Exporte registros ou aplique fila CEVESP.", href: "/correcoes" }
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.title} href={item.href} className="flex gap-3 rounded-md border p-3 hover:bg-muted/50">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold">{item.title}</span>
                        <span className="block text-xs text-muted-foreground">{item.text}</span>
                      </span>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <TerritoryTable rows={territoryRows} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">CEVESP por tipo de problema</CardTitle>
              </CardHeader>
              <CardContent>
                {cevespTypeRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem inconsistências carregadas.</p>
                ) : (
                  <div className="space-y-2">
                    {cevespTypeRows.slice(0, 8).map(([label, count]) => (
                      <div key={label} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                        <span className="truncate">{label}</span>
                        <span className="font-semibold tabular-nums">{count.toLocaleString("pt-BR")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">SINAN onde agir primeiro</CardTitle>
              </CardHeader>
              <CardContent>
                {sinanCorrections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem lista de correção SINAN carregada.</p>
                ) : (
                  <div className="space-y-2">
                    {sinanCorrections.slice(0, 8).map((item, index) => (
                      <div key={`${item.rowKey}-${index}`} className="grid grid-cols-[70px_1fr_auto] gap-3 rounded-md border px-3 py-2 text-sm">
                        <Badge className={priorityClass(normalizePriority(item.priority))}>{normalizePriority(item.priority)}</Badge>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{item.problem}</span>
                          <span className="block truncate text-xs text-muted-foreground">{item.municipioNome || item.municipio} - {item.gve}</span>
                        </span>
                        <span className="max-w-[150px] truncate font-mono text-xs text-muted-foreground">{item.notificationId ?? item.rowKey ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
