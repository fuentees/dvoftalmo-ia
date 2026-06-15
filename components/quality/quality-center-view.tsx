"use client";

import Link from "next/link";
import { useMemo } from "react";
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
}

type QualityAction = {
  agravo: "CEVESP" | "SINAN";
  priority: "Critica" | "Alta" | "Media";
  problem: string;
  where: string;
  count: number;
  href: string;
};

function priorityClass(priority: QualityAction["priority"]) {
  if (priority === "Critica") return "border-red-200 bg-red-50 text-red-700";
  if (priority === "Alta") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function normalizePriority(value: string): QualityAction["priority"] {
  if (value === "Critica") return "Critica";
  if (value === "Media") return "Media";
  const normalized = normalizeText(value);
  if (normalized === "critica" || normalized === "critico") return "Critica";
  if (normalized === "alta" || normalized === "alto") return "Alta";
  return "Media";
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

function buildActions(cevesp?: CevespQuality, sinan?: SinanAuditResult): QualityAction[] {
  const actions: QualityAction[] = [];

  if (cevesp?.total) {
    const critical = cevesp.records.filter((record) => {
      const issue = normalizeText(record.issue);
      return (
        issue.startsWith("ano impossivel") ||
        issue.startsWith("dia impossivel") ||
        issue.startsWith("se invalida") ||
        issue.startsWith("municipio ausente") ||
        issue.startsWith("gve ausente") ||
        issue.startsWith("total de casos negativo")
      );
    }).length;
    actions.push({
      agravo: "CEVESP",
      priority: critical > 0 ? "Critica" : "Alta",
      problem: "Inconsistências em notificações CEVESP",
      where: cevesp.byGve[0]?.gve ?? cevesp.byMunicipio[0]?.municipio ?? "base completa",
      count: cevesp.total,
      href: "/cevesp-qualidade"
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
        href: "/sinan-qualidade"
      });
    }

    const divergences = sinan.crossBankDivergences?.filter((item) => item.risco === "alto").length ?? 0;
    if (divergences > 0) {
      actions.push({
        agravo: "SINAN",
        priority: "Alta",
        problem: "Divergências TRACONET x NOTTRACONET",
        where: sinan.crossBankDivergences?.[0]?.gve ?? "municipios/anos",
        count: divergences,
        href: "/sinan-qualidade"
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
        href: "/sinan-qualidade"
      });
    }
  }

  return actions.sort((a, b) => {
    const rank = { Critica: 0, Alta: 1, Media: 2 };
    return rank[a.priority] - rank[b.priority] || b.count - a.count;
  });
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
    queryFn: async () => {
      const response = await fetch("/api/cevesp/qualidade");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Erro ao carregar CEVESP.");
      return data;
    },
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const sinan = useQuery<SinanAuditResult>({
    queryKey: ["quality-center-sinan"],
    queryFn: async () => {
      const response = await fetch("/api/sinan/auditoria");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Erro ao carregar SINAN.");
      return data;
    },
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const actions = useMemo(() => buildActions(cevesp.data, sinan.data), [cevesp.data, sinan.data]);
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
              title="SINAN clinico"
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

          <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Plano de ação</CardTitle>
                  {sinanCorrections.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadCsv(`qualidade-sinan-correcoes-${new Date().toISOString().slice(0, 10)}.csv`, sinanCorrections)}
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

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">CEVESP por tipo de problema</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.entries(cevesp.data?.byType ?? {}).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem inconsistências carregadas.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(cevesp.data?.byType ?? {}).slice(0, 8).map(([label, count]) => (
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
                        <span className="font-mono text-xs text-muted-foreground">{item.notificationId ?? item.rowKey ?? "-"}</span>
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
