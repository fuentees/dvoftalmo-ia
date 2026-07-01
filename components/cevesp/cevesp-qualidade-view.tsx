"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ClipboardCheck,
  Download, MapPin, RefreshCw, Users, XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PagedTable, type PagedColumn } from "@/components/ui/paged-table";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import type { InvalidRecord } from "@/services/cevesp-corrections";

type CevespTab = "registros" | "por_ano" | "por_gve" | "por_municipio" | "completude";

interface FieldCompletenessEntry { total: number; filled: number; pct: number; label: string }

interface QualidadeData {
  records: InvalidRecord[];
  byType: Record<string, number>;
  byGve: Array<{ gve: string; count: number }>;
  byAno: Array<{ ano: number; count: number }>;
  byMunicipio: Array<{ municipio: string; gve: string | null; count: number }>;
  total: number;
  filteredTotal: number;
  limit: number;
  offset: number;
}

interface CompletudeCevespData {
  fieldCompleteness: Record<string, FieldCompletenessEntry>;
  totalRows: number;
  byGve: Array<{ gve: string; totalRows: number; avgPct: number; criticalFields: number }>;
  byYear: Array<{ ano: number; totalRows: number; avgPct: number }>;
}

interface ApiError { error: string; message?: string }

const ISSUE_ICON: Record<string, React.ReactNode> = {
  "Data futura":             <AlertTriangle className="h-4 w-4 text-amber-500" />,
  "Ano impossível":          <XCircle       className="h-4 w-4 text-red-500"   />,
  "Dia impossível":          <XCircle       className="h-4 w-4 text-red-500"   />,
  "SE inválida":             <AlertCircle   className="h-4 w-4 text-red-500"   />,
  "SE futura":               <AlertTriangle className="h-4 w-4 text-amber-500" />,
  "Município ausente":       <MapPin        className="h-4 w-4 text-red-500"   />,
  "GVE ausente":             <MapPin        className="h-4 w-4 text-red-500"   />,
  "TotalCaso não informado": <AlertCircle   className="h-4 w-4 text-amber-500" />,
  "Nenhum caso confirmado":  <AlertCircle   className="h-4 w-4 text-amber-500" />,
  "Total de casos negativo": <XCircle       className="h-4 w-4 text-red-500"   />,
  "Faixa etária ausente":    <Users         className="h-4 w-4 text-amber-500" />,
  "Sexo diverge":            <Users         className="h-4 w-4 text-amber-500" />
};

function issueIcon(issue: string) {
  for (const [key, icon] of Object.entries(ISSUE_ICON)) {
    if (issue.startsWith(key)) return icon;
  }
  return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
}

function severity(r: InvalidRecord): "critical" | "warning" {
  if (r.issueType === "data_tempo") {
    if (r.issue.startsWith("Ano impossível") || r.issue.startsWith("Dia impossível") || r.issue.startsWith("SE inválida")) return "critical";
    return "warning";
  }
  if (r.issue.startsWith("Município ausente") || r.issue.startsWith("GVE ausente") || r.issue.startsWith("Total de casos negativo")) return "critical";
  return "warning";
}

type SortDir = "asc" | "desc";

function useSortedRows<T>(rows: T[], key: keyof T | null, dir: SortDir): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "pt-BR");
    return dir === "asc" ? cmp : -cmp;
  });
}

function SortTh({ label, sortKey, currentKey, dir, onSort, className }: {
  label: string; sortKey: string; currentKey: string | null;
  dir: SortDir; onSort: (k: string) => void; className?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th onClick={() => onSort(sortKey)} className={`cursor-pointer select-none ${className ?? ""} hover:text-foreground`}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[10px] text-muted-foreground/60">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </span>
    </th>
  );
}

function SummaryCard({ count, label, sev, detail }: {
  count: number; label: string; sev: "critical" | "warning" | "ok"; detail?: string;
}) {
  const styles = {
    critical: { border: "border-red-200 bg-red-50",     icon: <XCircle       className="h-5 w-5 text-red-500"   />, num: "text-red-700"   },
    warning:  { border: "border-amber-200 bg-amber-50", icon: <AlertTriangle className="h-5 w-5 text-amber-500" />, num: "text-amber-700" },
    ok:       { border: "border-green-200 bg-green-50", icon: <CheckCircle2  className="h-5 w-5 text-green-500" />, num: "text-green-700"  }
  }[sev];
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${styles.border}`}>
      <div className="mt-0.5 shrink-0">{styles.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-bold tabular-nums ${styles.num}`}>{count.toLocaleString("pt-BR")}</span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildCevespQualityReport(data: QualidadeData) {
  const lines = [
    "RELATÓRIO TÉCNICO - QUALIDADE CEVESP CONJUNTIVITES",
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    "",
    "1. Síntese",
    `Total de registros com inconsistência: ${data.total.toLocaleString("pt-BR")}`,
    `Registros filtrados na tela: ${(data.filteredTotal ?? data.total).toLocaleString("pt-BR")}`,
    "",
    "2. Principais tipos de inconsistência",
    ...Object.entries(data.byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([label, count]) => `- ${label}: ${count.toLocaleString("pt-BR")}`),
    "",
    "3. Territórios prioritários",
    ...data.byGve.slice(0, 10).map((item) => `- ${item.gve}: ${item.count.toLocaleString("pt-BR")} registro(s)`),
    "",
    "4. Municípios prioritários",
    ...data.byMunicipio.slice(0, 15).map((item) => `- ${item.municipio}${item.gve ? ` (${item.gve})` : ""}: ${item.count.toLocaleString("pt-BR")}`),
    "",
    "5. Interpretação epidemiológica",
    "Registros com erro de data, semana epidemiológica, município/GVE ausente ou inconsistência entre TotalCaso, sexo e faixa etária devem ser corrigidos antes de boletins, mapas e análises temporais.",
    "Notificação negativa não é tratada como erro quando TotalCaso = 0 e os campos de sexo/faixa etária também estão zerados.",
    "",
    "6. Recomendações",
    "- Priorizar erros críticos de data/SE e identificação territorial.",
    "- Exportar a lista filtrada e encaminhar aos municípios/GVEs responsáveis.",
    "- Usar a fila de correções para propostas com campo e valor sugeridos.",
    "- Reprocessar a qualidade após importação/correção para confirmar a redução das pendências."
  ];
  return lines.join("\n");
}

function TabsBar({ tab, setTab, counts }: {
  tab: CevespTab; setTab: (t: CevespTab) => void;
  counts: Record<CevespTab, number>;
}) {
  const items: Array<{ id: CevespTab; label: string }> = [
    { id: "registros",    label: "Registros"    },
    { id: "por_ano",      label: "Por Ano"      },
    { id: "por_gve",      label: "Por GVE"      },
    { id: "por_municipio",label: "Por Município" },
    { id: "completude",   label: "Completude"   }
  ];
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => setTab(item.id)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === item.id
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {item.label}
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
            tab === item.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}>
            {counts[item.id]}
          </span>
        </button>
      ))}
    </div>
  );
}

function PorAnoPanel({ data, onSelectAno }: { data: QualidadeData; onSelectAno?: (ano: number) => void }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const handleSort = (key: string) => {
    setSortDir((d) => sortKey === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKey(key);
  };
  const sortedRows = useSortedRows(data.byAno, sortKey as keyof (typeof data.byAno)[0] | null, sortDir);
  const thCls = "px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  if (!data.byAno.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro com ano informado.</p>;
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Problemas por Ano</CardTitle>
          {onSelectAno && <p className="text-xs text-muted-foreground">Clique em um ano para ver os registros</p>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <SortTh label="Ano" sortKey="ano" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={thCls} />
                <SortTh label="Registros com problema" sortKey="count" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={`${thCls} text-right`} />
                {onSelectAno && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(({ ano, count }) => (
                <tr key={ano} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium tabular-nums">{ano}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                      {count.toLocaleString("pt-BR")}
                    </span>
                  </td>
                  {onSelectAno && (
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => onSelectAno(ano)}
                        className="text-primary underline-offset-2 hover:underline text-[11px]"
                      >
                        ver registros →
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PorGvePanel({ data, onSelectGve }: { data: QualidadeData; onSelectGve?: (gve: string) => void }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const handleSort = (key: string) => {
    setSortDir((d) => sortKey === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKey(key);
  };
  const sortedRows = useSortedRows(data.byGve, sortKey as keyof (typeof data.byGve)[0] | null, sortDir);
  const thCls = "px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const maxCount = data.byGve[0]?.count ?? 1;

  if (!data.byGve.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro com GVE informado.</p>;
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Problemas por GVE</CardTitle>
          {onSelectGve && <p className="text-xs text-muted-foreground">Clique em um GVE para ver os municípios</p>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <SortTh label="GVE" sortKey="gve" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={thCls} />
                <SortTh label="Registros" sortKey="count" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={`${thCls} text-right`} />
                <th className={`${thCls} w-32`}>Proporção</th>
                {onSelectGve && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(({ gve, count }) => (
                <tr key={gve} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{gve}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    {count.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                      />
                    </div>
                  </td>
                  {onSelectGve && (
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => onSelectGve(gve)}
                        className="text-primary underline-offset-2 hover:underline text-[11px]"
                      >
                        ver municípios →
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PorMunicipioPanel({ data, externalGve, onClearGve }: { data: QualidadeData; externalGve?: string; onClearGve?: () => void }) {
  const [gveFilter, setGveFilter] = useState(externalGve ?? "todos");
  const [query, setQuery] = useState("");

  // sync external GVE cross-filter from Por GVE tab
  useEffect(() => {
    if (externalGve !== undefined) {
      setGveFilter(externalGve || "todos");
    }
  }, [externalGve]);

  const gves = useMemo(
    () => [...new Set(data.byMunicipio.map((item) => item.gve).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [data.byMunicipio]
  );
  const filteredRows = useMemo(() => {
    const q = normalizeSearch(query);
    return data.byMunicipio.filter((item) => {
      const matchGve = gveFilter === "todos" || item.gve === gveFilter;
      const matchText = !q || normalizeSearch(`${item.municipio} ${item.gve ?? ""}`).includes(q);
      return matchGve && matchText;
    });
  }, [data.byMunicipio, gveFilter, query]);
  const totalFiltered = filteredRows.reduce((sum, item) => sum + item.count, 0);

  const muniCols: PagedColumn<{ municipio: string; gve: string; count: number }>[] = [
    { key: "municipio", label: "Município", align: "left" },
    { key: "gve",       label: "GVE",       align: "left" },
    { key: "count",     label: "Registros", align: "right",
      render: (v) => Number(v).toLocaleString("pt-BR") }
  ];

  if (!data.byMunicipio.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro com município informado.</p>;
  }
  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Problemas por Município</CardTitle>
            {externalGve && gveFilter !== "todos" && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                filtrado: {gveFilter}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredRows.length.toLocaleString("pt-BR")} município(s), {totalFiltered.toLocaleString("pt-BR")} registro(s)
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-[220px_1fr_auto]">
          <select
            value={gveFilter}
            onChange={(event) => setGveFilter(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="todos">Todos os GVEs</option>
            {gves.map((gve) => (
              <option key={gve} value={gve}>{gve}</option>
            ))}
          </select>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar município ou GVE"
            className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setGveFilter("todos");
              setQuery("");
              onClearGve?.();
            }}
          >
            Limpar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <PagedTable
          rows={filteredRows.map((r) => ({ municipio: r.municipio, gve: r.gve ?? "—", count: r.count }))}
          columns={muniCols}
          defaultSortKey="count"
          defaultSortDir="desc"
          defaultPageSize={20}
          rowKey={(r) => r.municipio}
          emptyText="Nenhum município encontrado para os filtros aplicados."
        />
      </CardContent>
    </Card>
  );
}

type CevespCompView = "campos" | "gve" | "ano";

function downloadCsvCevesp(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function CompletudeCevespPanel({ data }: { data: CompletudeCevespData }) {
  const [view, setView] = useState<CevespCompView>("campos");

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const handleSort = (key: string) => {
    setSortDir((d) => sortKey === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKey(key);
  };

  const [sortKeyGve, setSortKeyGve] = useState<string | null>(null);
  const [sortDirGve, setSortDirGve] = useState<SortDir>("asc");
  const handleSortGve = (key: string) => {
    setSortDirGve((d) => sortKeyGve === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyGve(key);
  };

  const [sortKeyAno, setSortKeyAno] = useState<string | null>(null);
  const [sortDirAno, setSortDirAno] = useState<SortDir>("asc");
  const handleSortAno = (key: string) => {
    setSortDirAno((d) => sortKeyAno === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyAno(key);
  };

  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  const entries = Object.entries(data.fieldCompleteness ?? {});
  const fieldRows = entries.map(([field, s]) => ({ field, label: s.label, filled: s.filled, total: s.total, pct: s.pct }));
  const sortedFieldRows = useSortedRows(fieldRows, sortKey as keyof (typeof fieldRows)[0] | null, sortDir);

  const gveRows = data.byGve ?? [];
  const sortedGveRows = useSortedRows(gveRows, sortKeyGve as keyof (typeof gveRows)[0] | null, sortDirGve);

  const anoRows = data.byYear ?? [];
  const sortedAnoRows = useSortedRows(anoRows, sortKeyAno as keyof (typeof anoRows)[0] | null, sortDirAno);

  const critCount = fieldRows.filter((r) => r.pct < 70 && r.total > 0).length;
  const okCount   = fieldRows.filter((r) => r.pct >= 90).length;

  function exportCsv() {
    if (view === "campos") {
      downloadCsvCevesp("completude-cevesp-campos.csv", [
        ["Campo", "Preenchidos", "Total", "%", "Status"],
        ...fieldRows.map((r) => [r.label, String(r.filled), String(r.total), `${r.pct}%`, r.pct >= 90 ? "OK" : r.pct >= 70 ? "Atenção" : "Crítico"])
      ]);
    } else if (view === "gve") {
      downloadCsvCevesp("completude-cevesp-por-gve.csv", [
        ["GVE", "Linhas", "% médio", "Campos críticos"],
        ...gveRows.map((r) => [r.gve, String(r.totalRows), `${r.avgPct}%`, String(r.criticalFields)])
      ]);
    } else {
      downloadCsvCevesp("completude-cevesp-por-ano.csv", [
        ["Ano", "Linhas", "% médio"],
        ...anoRows.map((r) => [String(r.ano || "—"), String(r.totalRows), `${r.avgPct}%`])
      ]);
    }
  }

  if (!entries.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Completude indisponível — sem dados.</p>;
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Completude dos campos — CEVESP</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              % de registros com campo preenchido. Abaixo de 70% indica subnotificação ou problema de importação.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 rounded-lg border bg-muted/30 p-0.5 text-xs">
              {(["campos", "gve", "ano"] as CevespCompView[]).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 font-medium transition-colors ${view === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {v === "campos" ? "Campos" : v === "gve" ? "Por GVE" : "Por Ano"}
                </button>
              ))}
            </div>
            <button onClick={exportCsv} className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
              <Download className="h-3 w-3" /> CSV
            </button>
            {view === "campos" && (
              <div className="flex gap-2 text-xs">
                {critCount > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-700">{critCount} crítico{critCount > 1 ? "s" : ""}</span>}
                {okCount > 0 && <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 font-medium text-green-700">{okCount} ok</span>}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-0">
        <div className="overflow-x-auto">
          {view === "campos" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <SortTh label="Campo" sortKey="label" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={thCls} />
                <SortTh label="Preenchidos" sortKey="filled" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={`${thCls} text-right`} />
                <SortTh label="Total" sortKey="total" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={`${thCls} text-right`} />
                <SortTh label="%" sortKey="pct" currentKey={sortKey} dir={sortDir} onSort={handleSort} className={`${thCls} text-right`} />
                <th className={thCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedFieldRows.map((row) => {
                const badgeCls = row.pct >= 90 ? "border-green-200 bg-green-50 text-green-700" : row.pct >= 70 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-red-200 bg-red-50 text-red-700";
                const numCls   = row.pct >= 90 ? "text-green-700" : row.pct >= 70 ? "text-amber-700" : "text-red-700";
                const statusLabel = row.pct >= 90 ? "OK" : row.pct >= 70 ? "Atenção" : "Crítico";
                return (
                  <tr key={row.field} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{row.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.filled.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.total.toLocaleString("pt-BR")}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${numCls}`}>{row.pct.toFixed(0)}%</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badgeCls}`}>{statusLabel}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
          {view === "gve" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <SortTh label="GVE" sortKey="gve" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={thCls} />
                <SortTh label="Linhas" sortKey="totalRows" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={`${thCls} text-right`} />
                <SortTh label="% médio" sortKey="avgPct" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={`${thCls} text-right`} />
                <SortTh label="Campos críticos" sortKey="criticalFields" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={`${thCls} text-right`} />
              </tr>
            </thead>
            <tbody>
              {sortedGveRows.map((row) => {
                const numCls = row.avgPct >= 90 ? "text-green-700" : row.avgPct >= 70 ? "text-amber-700" : "text-red-700";
                return (
                  <tr key={row.gve} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{row.gve || <span className="italic text-muted-foreground">Não informado</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.totalRows.toLocaleString("pt-BR")}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${numCls}`}>{row.avgPct}%</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.criticalFields > 0 ? <span className="font-semibold text-red-600">{row.criticalFields}</span> : <span className="text-green-600">0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
          {view === "ano" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <SortTh label="Ano" sortKey="ano" currentKey={sortKeyAno} dir={sortDirAno} onSort={handleSortAno} className={thCls} />
                <SortTh label="Linhas" sortKey="totalRows" currentKey={sortKeyAno} dir={sortDirAno} onSort={handleSortAno} className={`${thCls} text-right`} />
                <SortTh label="% médio de preenchimento" sortKey="avgPct" currentKey={sortKeyAno} dir={sortDirAno} onSort={handleSortAno} className={`${thCls} text-right`} />
              </tr>
            </thead>
            <tbody>
              {sortedAnoRows.map((row) => {
                const numCls = row.avgPct >= 90 ? "text-green-700" : row.avgPct >= 70 ? "text-amber-700" : "text-red-700";
                return (
                  <tr key={row.ano} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium tabular-nums">{row.ano || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.totalRows.toLocaleString("pt-BR")}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${numCls}`}>{row.avgPct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type CevespQualidadeViewProps = {
  externalFilters?: {
    year?: number;
    yearEnd?: number;
    gve?: string;
    municipio?: string;
  };
};

export function CevespQualidadeView({ externalFilters }: CevespQualidadeViewProps = {}) {
  const qc = useQueryClient();
  const [tab, setTab]             = useState<CevespTab>("registros");
  const [filterType, setFilterType] = useState<string>("todos");
  const [recordQuery, setRecordQuery] = useState("");
  const [anoFilter, setAnoFilter] = useState("");
  const [anoFimFilter, setAnoFimFilter] = useState("");
  const [gveFilter, setGveFilter] = useState("");
  const [municipioFilter, setMunicipioFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [proposeMsg, setProposeMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [crossGve, setCrossGve]   = useState<string | undefined>(undefined);
  const [sortKeyRec, setSortKeyRec] = useState<string | null>(null);
  const [sortDirRec, setSortDirRec] = useState<SortDir>("asc");
  const handleSortRec = (key: string) => {
    setSortDirRec((d) => sortKeyRec === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyRec(key);
  };
  const pageSize = 100;
  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gveFilter), [gveFilter]);

  useEffect(() => {
    if (!externalFilters) return;
    setAnoFilter(externalFilters.year ? String(externalFilters.year) : "");
    setAnoFimFilter(externalFilters.yearEnd ? String(externalFilters.yearEnd) : "");
    setGveFilter(externalFilters.gve ?? "");
    setMunicipioFilter(externalFilters.municipio ?? "");
    setPage(0);
    setSelected(new Set());
  }, [externalFilters]);

  function handleSelectAno(ano: number) {
    setRecordQuery(String(ano));
    setAnoFilter(String(ano));
    setPage(0);
    setSelected(new Set());
    setTab("registros");
  }
  function handleSelectGve(gve: string) {
    setCrossGve(gve);
    setTab("por_municipio");
  }
  function handleClearGve() {
    setCrossGve(undefined);
  }

  const { data, isLoading, isError, error, refetch } = useQuery<QualidadeData, ApiError>({
    queryKey: ["cevesp-qualidade", filterType, recordQuery, anoFilter, anoFimFilter, gveFilter, municipioFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
        issue: filterType,
        q: recordQuery
      });
      if (anoFilter) params.set("ano", anoFilter);
      if (anoFimFilter && anoFimFilter !== anoFilter) params.set("anoFim", anoFimFilter);
      if (gveFilter) params.set("gve", gveFilter);
      if (municipioFilter) params.set("municipio", municipioFilter);
      const res  = await fetch(`/api/cevesp/qualidade?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw json as ApiError;
      return json as QualidadeData;
    },
    staleTime: 2 * 60 * 1000
  });

  const { data: completudeData } = useQuery<CompletudeCevespData>({
    queryKey: ["cevesp-qualidade-completude"],
    queryFn: async () => {
      const res  = await fetch("/api/cevesp/qualidade/completude");
      const json = await res.json();
      if (!res.ok) throw new Error((json as ApiError).message ?? (json as ApiError).error);
      return json as CompletudeCevespData;
    },
    staleTime: 10 * 60 * 1000
  });

  const proposeMutation = useMutation({
    mutationFn: async (recordIds: string[] | undefined) => {
      const res = await fetch("/api/cevesp/qualidade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recordIds ? { recordIds } : {})
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as ApiError).message ?? (json as ApiError).error);
      return json as { saved: number; skipped: number };
    },
    onSuccess: (result, recordIds) => {
      setProposeMsg({
        type: "ok",
        text: `${result.saved} correção(ões) proposta(s) na fila. ${result.skipped} já existiam.`
      });
      if (recordIds) setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["cevesp-qualidade"] });
    },
    onError: (err: Error) => { setProposeMsg({ type: "error", text: err.message }); }
  });

  const records = data?.records ?? [];
  const sortedRecords = useSortedRows(records, sortKeyRec as keyof (typeof records)[0] | null, sortDirRec);
  const visible = sortedRecords;

  const types = data ? Object.keys(data.byType) : [];

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function toggleAll() {
    setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((r) => r.recordId)));
  }
  function resetRecordFilters() {
    setFilterType("todos");
    setRecordQuery("");
    setAnoFilter("");
    setGveFilter("");
    setMunicipioFilter("");
    setPage(0);
    setSelected(new Set());
  }
  function downloadFilteredCsv() {
    const params = new URLSearchParams({
      issue: filterType,
      q: recordQuery,
      format: "csv"
    });
    if (anoFilter) params.set("ano", anoFilter);
    if (gveFilter) params.set("gve", gveFilter);
    if (municipioFilter) params.set("municipio", municipioFilter);
    window.location.href = `/api/cevesp/qualidade?${params.toString()}`;
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Analisando qualidade dos dados CEVESP...
      </div>
    );
  }

  if (isError) {
    const err = error as ApiError;
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold mb-1">Erro ao carregar dados</p>
          <p>{err.message ?? err.error}</p>
          {err.error === "conexao_falhou" && (
            <p className="mt-2 text-xs">Verifique as variáveis de ambiente NOTIFY_DB_* e a conectividade com o servidor MySQL.</p>
          )}
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  const total = data?.total ?? 0;
  const filteredTotal = data?.filteredTotal ?? total;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const byType = data?.byType ?? {};

  const dateTempoBased = records.filter((r) => r.issueType === "data_tempo").length;
  const conteudoBased  = records.filter((r) => r.issueType === "conteudo").length;

  const completudeCritica = Object.values(completudeData?.fieldCompleteness ?? {}).filter((e) => e.pct < 90 && e.total > 0).length;
  const tabCounts: Record<CevespTab, number> = {
    registros:    total,
    por_ano:      data?.byAno.length ?? 0,
    por_gve:      data?.byGve.length ?? 0,
    por_municipio: data?.byMunicipio.length ?? 0,
    completude:   completudeCritica
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Auditoria de dados
          </div>
          <h1 className="text-xl font-semibold">Qualidade CEVESP - Conjuntivites</h1>
          <p className="text-sm text-muted-foreground">
            Tela técnica para corrigir inconsistências detectadas na base CEVESP.
          </p>
          <Link href="/conjuntivite" className="mt-1 inline-flex text-xs font-medium text-primary underline">
            Voltar para Conjuntivite — CEVESP
          </Link>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
        {data && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadTextFile(`relatorio-qualidade-cevesp-${new Date().toISOString().slice(0, 10)}.txt`, buildCevespQualityReport(data))}
          >
            Relatório técnico
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Ano</label>
              <input
                type="number"
                value={anoFilter}
                onChange={(event) => { setAnoFilter(event.target.value); setPage(0); setSelected(new Set()); }}
                placeholder="Todos"
                className="h-9 w-28 rounded-md border bg-background px-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">GVE</label>
              <select
                value={gveFilter}
                onChange={(event) => {
                  setGveFilter(event.target.value);
                  setMunicipioFilter("");
                  setPage(0);
                  setSelected(new Set());
                }}
                className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Todos os GVEs</option>
                {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Município</label>
              <select
                value={municipioFilter}
                onChange={(event) => { setMunicipioFilter(event.target.value); setPage(0); setSelected(new Set()); }}
                className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Todos os municípios</option>
                {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
              </select>
            </div>
            {(anoFilter || gveFilter || municipioFilter) && (
              <Button variant="ghost" onClick={resetRecordFilters} className="text-muted-foreground">
                Limpar recorte
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          count={total}
          label="registros com problema"
          sev={total > 0 ? "warning" : "ok"}
          detail={total === 0 ? "Nenhuma inconsistência detectada" : "Ver abas abaixo"}
        />
        <SummaryCard
          count={dateTempoBased}
          label="problemas de data/SE"
          sev={dateTempoBased > 0 ? "critical" : "ok"}
          detail="Data futura, dia/ano impossível, SE inválida ou futura"
        />
        <SummaryCard
          count={conteudoBased}
          label="problemas de conteúdo"
          sev={conteudoBased > 0 ? "warning" : "ok"}
          detail="Município/GVE ausente, sem casos, faixa etária, sexo"
        />
      </div>

      {(data || completudeData) && <TabsBar tab={tab} setTab={setTab} counts={tabCounts} />}

      {total > 0 && (
        <>

          {tab === "registros" && (
            <div className="space-y-4">
              {/* Filter + actions bar */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                  value={filterType}
                  onChange={(e) => { setFilterType(e.target.value); setPage(0); setSelected(new Set()); }}
                >
                  <option value="todos">Todos os problemas ({total})</option>
                  {types.map((t) => (
                    <option key={t} value={t}>{t} ({byType[t]})</option>
                  ))}
                </select>
                <input
                  value={recordQuery}
                  onChange={(event) => {
                    setRecordQuery(event.target.value);
                    setPage(0);
                    setSelected(new Set());
                  }}
                  placeholder="Buscar ID, município, GVE ou problema"
                  className="h-8 min-w-[260px] rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={downloadFilteredCsv}
                >
                  Exportar CSV
                </Button>

                {/* Ação de propor — sempre explícito sobre o que será enviado */}
                {selected.size > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      disabled={proposeMutation.isPending}
                      onClick={() => { setProposeMsg(null); proposeMutation.mutate([...selected]); }}
                    >
                      <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                      {proposeMutation.isPending ? "Enviando..." : `Propor ${selected.size} selecionado(s)`}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={() => setSelected(new Set())}
                    >
                      Limpar seleção
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={proposeMutation.isPending}
                    onClick={() => { setProposeMsg(null); proposeMutation.mutate(undefined); }}
                    title="Envia todos os registros com problema para a fila de correção"
                  >
                    <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                    {proposeMutation.isPending ? "Enviando..." : `Propor todos (${filteredTotal.toLocaleString("pt-BR")})`}
                  </Button>
                )}

                <span className="text-xs text-muted-foreground">
                  {visible.length} de {filteredTotal.toLocaleString("pt-BR")} registros
                  {selected.size > 0 && (
                    <span className="ml-1 font-medium text-primary">· {selected.size} selecionado(s) via checkbox</span>
                  )}
                </span>
                {(filterType !== "todos" || recordQuery) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={resetRecordFilters}
                  >
                    Limpar filtros
                  </Button>
                )}
              </div>

              {proposeMsg && (
                <div className={`rounded-md border px-3 py-2 text-xs ${
                  proposeMsg.type === "ok"
                    ? "border-green-300 bg-green-50 text-green-800"
                    : "border-red-300 bg-red-50 text-red-800"
                }`}>
                  {proposeMsg.text}
                  {proposeMsg.type === "ok" && (
                    <span className="ml-2">
                      — Acesse{" "}
                      <a href="/correcoes" className="underline font-medium">Correções CEVESP</a>
                      {" "}para aprovar e aplicar.
                    </span>
                  )}
                </div>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Registros com inconsistência</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="px-3 py-2 text-left">
                            <input
                              type="checkbox"
                              checked={selected.size === visible.length && visible.length > 0}
                              onChange={toggleAll}
                              className="cursor-pointer"
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium">ID</th>
                          <th className="px-3 py-2 text-left text-xs font-medium">ControlaSubmit</th>
                          <SortTh label="Data" sortKey="dtNotificacao" currentKey={sortKeyRec} dir={sortDirRec} onSort={handleSortRec} className="px-3 py-2 text-left text-xs font-medium" />
                          <SortTh label="SE" sortKey="semEpidemio" currentKey={sortKeyRec} dir={sortDirRec} onSort={handleSortRec} className="px-3 py-2 text-left text-xs font-medium" />
                          <SortTh label="Município" sortKey="municipio" currentKey={sortKeyRec} dir={sortDirRec} onSort={handleSortRec} className="px-3 py-2 text-left text-xs font-medium" />
                          <SortTh label="GVE" sortKey="gve" currentKey={sortKeyRec} dir={sortDirRec} onSort={handleSortRec} className="px-3 py-2 text-left text-xs font-medium" />
                          <SortTh label="Total Casos" sortKey="totalCaso" currentKey={sortKeyRec} dir={sortDirRec} onSort={handleSortRec} className="px-3 py-2 text-left text-xs font-medium" />
                          <SortTh label="Problema" sortKey="issue" currentKey={sortKeyRec} dir={sortDirRec} onSort={handleSortRec} className="px-3 py-2 text-left text-xs font-medium" />
                          <th className="px-3 py-2 text-left text-xs font-medium">Sugestão</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((r) => {
                          const sev = severity(r);
                          return (
                            <tr
                              key={r.recordId}
                              className={`border-b last:border-0 transition-colors ${
                                selected.has(r.recordId) ? "bg-primary/5" : "hover:bg-muted/30"
                              }`}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={selected.has(r.recordId)}
                                  onChange={() => toggleSelect(r.recordId)}
                                  className="cursor-pointer"
                                />
                              </td>
                              <td className="px-3 py-2 font-mono font-medium whitespace-nowrap">{r.recordId}</td>
                              <td className="px-3 py-2 font-mono font-medium whitespace-nowrap text-primary">{r.controlaSubmit ?? "—"}</td>
                              <td className="px-3 py-2 tabular-nums">{r.dtNotificacao ?? "—"}</td>
                              <td className="px-3 py-2 tabular-nums">{r.semEpidemio ?? "—"}</td>
                              <td className="px-3 py-2 max-w-[120px] truncate" title={r.municipio ?? undefined}>
                                {r.municipio ?? <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-3 py-2 max-w-[100px] truncate text-muted-foreground" title={r.gve ?? undefined}>
                                {r.gve ?? "—"}
                              </td>
                              <td className="px-3 py-2 tabular-nums text-center">
                                {r.totalCaso != null ? r.totalCaso : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="shrink-0">{issueIcon(r.issue)}</span>
                                  <span className={sev === "critical" ? "text-red-700" : "text-amber-700"}>
                                    {r.issue}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {r.suggestedField ? (
                                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800 font-mono">
                                    {r.suggestedField} → {r.suggestedValue}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">Verificar manualmente</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Página {(page + 1).toLocaleString("pt-BR")} de {totalPages.toLocaleString("pt-BR")} · {filteredTotal.toLocaleString("pt-BR")} registro(s) filtrado(s)
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => { setPage((current) => Math.max(0, current - 1)); setSelected(new Set()); }}
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => { setPage((current) => current + 1); setSelected(new Set()); }}
                  >
                    Próxima
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Correções propostas ficam na fila de aprovação em{" "}
                <a href="/correcoes" className="underline">Correções CEVESP</a>.
                Após aprovação, são aplicadas no banco de dados.
              </p>
            </div>
          )}

          {tab === "por_ano"       && data && <PorAnoPanel       data={data} onSelectAno={handleSelectAno} />}
          {tab === "por_gve"       && data && <PorGvePanel       data={data} onSelectGve={handleSelectGve} />}
          {tab === "por_municipio" && data && <PorMunicipioPanel data={data} externalGve={crossGve} onClearGve={handleClearGve} />}
        </>
      )}

      {tab === "completude" && completudeData && <CompletudeCevespPanel data={completudeData} />}
      {tab === "completude" && !completudeData && (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Carregando completude...
        </div>
      )}

      {total === 0 && tab !== "completude" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center text-sm text-green-800">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
          <p className="font-medium">Nenhuma inconsistência detectada</p>
          <p className="mt-1 text-xs text-green-700">
            Todos os registros CEVESP verificados possuem dados válidos.
          </p>
        </div>
      )}
    </div>
  );
}
