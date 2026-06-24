"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, ClipboardList,
  Database, RefreshCw, XCircle, Activity,
  MapPin, Stethoscope, BarChart2, Download, Search, Target, ChevronDown
} from "lucide-react";
import { PagedTable, type PagedColumn } from "@/components/ui/paged-table";
import { useMemo, useState } from "react";
import {
  CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
  Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import type { SinanAuditResult } from "@/services/sinan-tracoma";

interface ApiError { error: string; message?: string }

// ── Helpers visuais ───────────────────────────────────────────────────────────

const RISK_LABEL: Record<string, string> = { alto: "Alto", medio: "Médio", baixo: "Baixo" };
const RISK_COLOR: Record<string, string> = {
  alto:  "bg-red-100 text-red-700 border-red-200",
  medio: "bg-amber-100 text-amber-700 border-amber-200",
  baixo: "bg-sky-100 text-sky-700 border-sky-200"
};

function DiffCell({ diff }: { diff: number }) {
  const cls = diff > 0
    ? "text-red-600"
    : diff < 0 ? "text-amber-600" : "text-muted-foreground";
  const title = diff > 0
    ? "Consolidado > individuais: possível subregistro no TRACONET"
    : diff < 0 ? "Individuais > consolidado: verificar duplicidade" : "";
  return (
    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${cls}`} title={title}>
      {diff > 0 ? "+" : ""}{diff.toLocaleString("pt-BR")}
    </td>
  );
}

function RiscoCell({ risco }: { risco: string }) {
  return (
    <td className="px-4 py-2 text-center">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_COLOR[risco] ?? ""}`}>
        {RISK_LABEL[risco] ?? risco}
      </span>
    </td>
  );
}

function TotalRow({ label, traconet, nottraconet, diff, colSpan = 1 }: {
  label: string; traconet: number; nottraconet: number; diff: number; colSpan?: number;
}) {
  return (
    <tr className="border-t-2 bg-muted/50 font-semibold">
      <td className="px-4 py-2" colSpan={colSpan}>{label}</td>
      <td className="px-4 py-2 text-right tabular-nums">{traconet.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-2 text-right tabular-nums">{nottraconet.toLocaleString("pt-BR")}</td>
      <DiffCell diff={diff} />
      <td className="px-4 py-2 text-center text-xs text-muted-foreground">—</td>
    </tr>
  );
}

function sumRows(rows: Array<{ traconet: number; nottraconet: number }>) {
  const tc = rows.reduce((s, r) => s + Number(r.traconet ?? 0), 0);
  const ntc = rows.reduce((s, r) => s + Number(r.nottraconet ?? 0), 0);
  return { traconet: tc, nottraconet: ntc, diff: ntc - tc };
}

function PctBar({ pct, label }: { pct: number; label: string }) {
  const color = pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-amber-400" : "bg-red-500";
  const textColor = pct >= 90 ? "text-green-700" : pct >= 70 ? "text-amber-700" : "text-red-700";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold tabular-nums ${textColor}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── KPI card no topo ──────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, tone = "neutral", icon
}: {
  label: string; value: string | number; sub?: string;
  tone?: "neutral" | "red" | "amber" | "green"; icon: React.ReactNode;
}) {
  const numColor = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-green-700" : "";
  const borderColor = tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : tone === "green" ? "border-green-200" : "";
  return (
    <Card className={borderColor}>
      <CardContent className="flex items-start gap-3 pt-5">
        <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-2xl font-bold tabular-nums leading-tight ${numColor}`}>
            {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
          </div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Collapsible ───────────────────────────────────────────────────────────────

function Collapsible({ title, badge, icon, defaultOpen = true, children }: {
  title: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/60"
      >
        {icon}
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {badge}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-3 space-y-4">{children}</div>}
    </div>
  );
}

// ── Tabelas ordenáveis ────────────────────────────────────────────────────────

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
  label: string;
  sortKey: string;
  currentKey: string | null;
  dir: SortDir;
  onSort: (k: string) => void;
  className?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none ${className ?? ""} hover:text-foreground`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[10px] text-muted-foreground/60">
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </span>
    </th>
  );
}

// ── Aba: Divergências ─────────────────────────────────────────────────────────

type ManagementRow = {
  key: string;
  municipio: string;
  municipioNome: string;
  gve: string;
  score: number;
  criticos: number;
  alertas: number;
  divergencia: number;
  acao: string;
};

type ActionPlanRow = {
  prioridade: "Urgente" | "Alta" | "Normal";
  problema: string;
  volume: number;
  onde: string;
  acao: string;
  tone: "red" | "amber" | "green";
};

function addManagementRow(map: Map<string, ManagementRow>, base: Partial<ManagementRow> & { municipio: string }, update: Partial<ManagementRow>) {
  const key = `${base.municipio}|${base.gve ?? ""}`;
  const row = map.get(key) ?? {
    key,
    municipio: base.municipio,
    municipioNome: base.municipioNome ?? base.municipio,
    gve: base.gve ?? "",
    score: 0,
    criticos: 0,
    alertas: 0,
    divergencia: 0,
    acao: ""
  };
  row.score += update.score ?? 0;
  row.criticos += update.criticos ?? 0;
  row.alertas += update.alertas ?? 0;
  row.divergencia += update.divergencia ?? 0;
  if (update.acao && (!row.acao || (update.score ?? 0) >= row.score / 2)) row.acao = update.acao;
  map.set(key, row);
}

function buildManagementRows(data: SinanAuditResult): ManagementRow[] {
  const map = new Map<string, ManagementRow>();

  for (const item of data.semFormaClinicaDetalhe ?? []) {
    addManagementRow(map, item, {
      score: item.count * 8,
      criticos: item.count,
      acao: "Corrigir a classificação clínica dos casos antes de analisar a prevalência."
    });
  }

  for (const item of data.ttSemTsDetalhe ?? []) {
    addManagementRow(map, item, {
      score: item.count * 10,
      criticos: item.count,
      acao: "Revisar a classificação clínica — trichiasis sem cicatriz associada sugere erro de digitação."
    });
  }

  for (const item of data.crossBankDivergences ?? []) {
    const peso = item.risco === "alto" ? 5 : item.risco === "medio" ? 2 : 1;
    addManagementRow(map, item, {
      score: Math.abs(item.diff) * peso,
      alertas: item.risco === "alto" ? 1 : 0,
      divergencia: item.diff,
      acao: item.diff > 0
        ? "Registro consolidado maior que o individual: verificar se há casos não registrados no sistema."
        : "Registro individual maior que o consolidado: verificar duplicidade ou ausência no consolidado."
    });
  }

  return Array.from(map.values())
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.criticos - a.criticos)
    .slice(0, 20);
}

function buildActionPlan(data: SinanAuditResult): ActionPlanRow[] {
  const rows: ActionPlanRow[] = [];
  const semForma = data.casosSemFormaPositiva ?? data.semGraduacao ?? 0;
  const ttSemTs = data.ttSemTs ?? 0;
  const altoRisco = (data.crossBankDivergences ?? []).filter((item) => item.risco === "alto").length;
  const duplicidades = data.duplicateNotificationIds?.length ?? 0;
  const examinados = data.consolidatedMetrics?.examinados?.value ?? 0;

  if (semForma > 0) rows.push({
    prioridade: "Urgente",
    problema: "Casos sem classificação clínica confirmada",
    volume: semForma,
    onde: `${(data.semFormaClinicaDetalhe ?? []).length.toLocaleString("pt-BR")} município(s)`,
    acao: "Revisar o preenchimento clínico no sistema ou excluir o registro se nenhuma forma for positiva.",
    tone: "red"
  });

  if (ttSemTs > 0) rows.push({
    prioridade: "Urgente",
    problema: "Casos graves de tracoma sem cicatriz associada — possível erro de digitação",
    volume: ttSemTs,
    onde: `${(data.ttSemTsDetalhe ?? []).length.toLocaleString("pt-BR")} território(s)`,
    acao: "Revisar a classificação clínica — caso grave sem cicatriz nos olhos associada sugere erro de digitação ou preenchimento incompleto.",
    tone: "red"
  });

  if (altoRisco > 0) rows.push({
    prioridade: "Alta",
    problema: "Grande diferença entre os dois registros de dados",
    volume: altoRisco,
    onde: "Município / ano",
    acao: "Verificar e corrigir a diferença entre os dois sistemas antes de divulgar os dados.",
    tone: "amber"
  });

  if (data.tfSemTratamento > 0) rows.push({
    prioridade: "Alta",
    problema: "Casos ativos de tracoma sem tratamento registrado",
    volume: data.tfSemTratamento,
    onde: "Casos ativos",
    acao: "Confirmar que o tratamento foi realizado e está registrado no sistema. Acionar o município se não houver registro.",
    tone: "amber"
  });

  if (data.ttSemCircurgia > 0) rows.push({
    prioridade: "Alta",
    problema: "Casos graves sem encaminhamento para cirurgia",
    volume: data.ttSemCircurgia,
    onde: "Casos graves de tracoma",
    acao: "Confirmar encaminhamento para avaliação com oftalmologista e registrar a conduta no sistema.",
    tone: "amber"
  });

  if (data.semConclusao > 0) rows.push({
    prioridade: "Normal",
    problema: "Casos em aberto sem conclusão registrada",
    volume: data.semConclusao,
    onde: "Sistema de notificação",
    acao: "Encerrar os casos no sistema para não distorcer os indicadores de acompanhamento.",
    tone: "amber"
  });

  if (duplicidades > 0) rows.push({
    prioridade: "Urgente",
    problema: "Possível registro duplicado do mesmo paciente",
    volume: duplicidades,
    onde: "Número de notificação + paciente + ano",
    acao: "Confirmar se é o mesmo paciente. Se forem anos diferentes, pode ser reinfecção — não é duplicidade.",
    tone: "red"
  });

  if (examinados === 0 && (data.totalNottraconetRows ?? 0) > 0) rows.push({
    prioridade: "Alta",
    problema: "Total de examinados não identificado no arquivo",
    volume: data.totalNottraconetRows ?? 0,
    onde: "Consolidado anual",
    acao: "Verificar o campo de examinados no arquivo importado — sem esse dado não é possível calcular prevalência ou cobertura.",
    tone: "amber"
  });

  if (!rows.length) rows.push({
    prioridade: "Normal",
    problema: "Nenhuma pendência crítica detectada",
    volume: 0,
    onde: "Base atual",
    acao: "Manter o monitoramento periódico e validar os indicadores antes de divulgar.",
    tone: "green"
  });

  return rows.sort((a, b) => {
    const weight = { Urgente: 3, Alta: 2, Normal: 1 };
    return weight[b.prioridade] - weight[a.prioridade] || b.volume - a.volume;
  }).slice(0, 7);
}

function buildCorrectionCsv(data: SinanAuditResult) {
  const rows = [["tipo", "prioridade", "banco", "nu_notific", "row_key", "municipio", "gve", "ano", "campo", "detalhe"]];

  for (const item of data.correctionRecords ?? []) {
    rows.push([
      item.problem,
      item.priority,
      item.sourceBank.toUpperCase(),
      item.notificationId ?? "",
      item.rowKey ?? "",
      item.municipioNome || item.municipio,
      item.gve,
      item.ano != null ? String(item.ano) : "",
      item.field,
      item.recommendation
    ]);
  }

  if (rows.length > 1) {
    return rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(";")).join("\n");
  }

  rows[0] = ["tipo", "prioridade", "banco", "nu_notific", "row_key", "municipio", "gve", "ano", "campo", "detalhe"];
  for (const item of data.crossBankDivergences ?? []) rows.push(["Divergencia bancos", item.risco, "TRACONET/NOTTRACONET", "", "", item.municipioNome, item.gve, String(item.ano), "NU_CASOPOS", `Diferenca ${item.diff}`]);
  for (const item of data.duplicateNotificationIds ?? []) rows.push(["Possivel duplicidade do mesmo caso", "Critico", "TRACONET", item.id, item.caseKey ?? "", item.municipio, "", String(item.ano || ""), "NU_NOTIFIC + iniciais + mae + nascimento + ano", `${item.count} repeticoes`]);

  return rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(";")).join("\n");
}

function downloadCorrections(data: SinanAuditResult) {
  const csv = buildCorrectionCsv(data);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sinan-tracoma-correcoes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

function buildSinanTechnicalReport(data: SinanAuditResult, filters: Record<string, string>) {
  const filterText = Object.entries(filters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ") || "base completa";
  const highRisk = (data.crossBankDivergences ?? []).filter((item) => item.risco === "alto").length;
  const lines = [
    "RELATÓRIO TÉCNICO - QUALIDADE SINAN TRACOMA",
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    `Filtros aplicados: ${filterText}`,
    "",
    "1. Síntese dos bancos",
    `TRACONET - casos individuais: ${data.totalTraconet.toLocaleString("pt-BR")}`,
    `NOTTRACONET/NTRACOMA - positivos consolidados: ${data.totalNottraconet.toLocaleString("pt-BR")}`,
    `NOTTRACONET/NTRACOMA - linhas consolidadas: ${(data.totalNottraconetRows ?? 0).toLocaleString("pt-BR")}`,
    `Examinados consolidados: ${(data.consolidatedMetrics?.examinados?.value ?? 0).toLocaleString("pt-BR")}`,
    "",
    "2. Qualidade clínica e completude",
    `Casos sem forma clínica positiva TF/TI/TS/TT/CO: ${(data.casosSemFormaPositiva ?? data.semGraduacao ?? 0).toLocaleString("pt-BR")}`,
    `TT sem TS associado: ${(data.ttSemTs ?? 0).toLocaleString("pt-BR")}`,
    `TF sem tratamento registrado: ${data.tfSemTratamento.toLocaleString("pt-BR")}`,
    `TT sem encaminhamento/cirurgia registrado: ${data.ttSemCircurgia.toLocaleString("pt-BR")}`,
    `Sem conclusão/encerramento: ${data.semConclusao.toLocaleString("pt-BR")}`,
    `Possíveis duplicidades por chave composta: ${(data.duplicateNotificationIds?.length ?? 0).toLocaleString("pt-BR")}`,
    "",
    "3. Comparação TRACONET x NOTTRACONET",
    `Divergências totais município/ano: ${(data.crossBankDivergences?.length ?? 0).toLocaleString("pt-BR")}`,
    `Divergências de alto risco: ${highRisk.toLocaleString("pt-BR")}`,
    ...data.crossBankDivergences.slice(0, 10).map((item) =>
      `- ${item.municipioNome || item.municipio} ${item.ano}: individuais=${item.traconet}; consolidados=${item.nottraconet}; diferença=${item.diff}; risco=${item.risco}`
    ),
    "",
    "4. Recomendações técnicas",
    ...(data.recommendations?.length ? data.recommendations : [
      "Manter monitoramento periódico da completude, consistência clínica e comparação entre bancos."
    ]),
    "",
    "5. Encaminhamento",
    "Priorizar correções que impactam indicador: forma clínica, tratamento, conclusão, duplicidade e divergência entre bancos.",
    "Exportar a lista de correções e encaminhar ao município/GVE responsável com identificação do registro sempre que disponível."
  ];
  return lines.join("\n");
}

function GestaoTab({ data }: { data: SinanAuditResult }) {
  const priorities = buildManagementRows(data);
  const actionPlan = buildActionPlan(data);
  const examinados = data.consolidatedMetrics?.examinados?.value ?? 0;
  const positivos = data.consolidatedMetrics?.positivos?.value ?? data.totalNottraconet ?? 0;
  const tratamentoRegistrado = Math.max(data.totalTraconet - data.semTratamento, 0);
  const encerrados = Math.max(data.totalTraconet - data.semConclusao, 0);
  const funnel = [
    { label: "Examinados", value: examinados, tone: "neutral" },
    { label: "Confirmados com tracoma", value: positivos, tone: "neutral" },
    { label: "Registros no sistema", value: data.totalTraconet, tone: "neutral" },
    { label: "Forma clínica confirmada", value: data.casosComFormaClinica ?? data.totalTraconetPositive ?? 0, tone: "green" },
    { label: "Tratamento registrado", value: tratamentoRegistrado, tone: "amber" },
    { label: "Encerrados", value: encerrados, tone: "green" }
  ];
  const maxFunnel = Math.max(...funnel.map((item) => item.value), 1);
  const criticos =
    (data.casosSemFormaPositiva ?? data.semGraduacao ?? 0) +
    (data.ttSemTs ?? 0) +
    (data.duplicateNotificationIds?.length ?? 0);
  const altoRisco = (data.crossBankDivergences ?? []).filter((item) => item.risco === "alto").length;
  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  // Sort state — "O que fazer primeiro"
  const [sortKeyA, setSortKeyA] = useState<keyof ActionPlanRow | null>(null);
  const [sortDirA, setSortDirA] = useState<SortDir>("asc");
  const handleSortA = (key: string) => {
    const k = key as keyof ActionPlanRow;
    setSortDirA((d) => sortKeyA === k ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyA(k);
  };
  const sortedActionPlan = useSortedRows(actionPlan, sortKeyA, sortDirA);

  // Sort state — "Municípios que precisam de atenção"
  const [sortKeyP, setSortKeyP] = useState<keyof ManagementRow | null>(null);
  const [sortDirP, setSortDirP] = useState<SortDir>("asc");
  const handleSortP = (key: string) => {
    const k = key as keyof ManagementRow;
    setSortDirP((d) => sortKeyP === k ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyP(k);
  };
  const sortedPriorities = useSortedRows(priorities, sortKeyP, sortDirP);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">O que precisa ser resolvido</h2>
          <p className="text-xs text-muted-foreground">
            Municípios e problemas prioritários para corrigir os dados e fechar os casos em aberto.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => downloadCorrections(data)}>
          <Download className="mr-2 h-4 w-4" />
          Exportar correções
        </Button>
      </div>

      <Collapsible title="O que fazer primeiro" icon={<Target className="h-4 w-4 text-muted-foreground" />} defaultOpen={true}>
        <Card>
          <CardHeader className="pb-3">
            <p className="text-xs text-muted-foreground">
              Corrija estes problemas em ordem de urgência para garantir dados confiáveis.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <SortTh label="Urgência" sortKey="prioridade" currentKey={sortKeyA as string | null} dir={sortDirA} onSort={handleSortA} className={thCls} />
                    <SortTh label="Problema" sortKey="problema" currentKey={sortKeyA as string | null} dir={sortDirA} onSort={handleSortA} className={thCls} />
                    <SortTh label="Qtd." sortKey="volume" currentKey={sortKeyA as string | null} dir={sortDirA} onSort={handleSortA} className={`${thCls} text-right`} />
                    <th className={thCls}>Onde</th>
                    <th className={thCls}>O que fazer</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedActionPlan.map((row) => {
                    const badge = row.tone === "red"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : row.tone === "amber"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-green-200 bg-green-50 text-green-700";
                    return (
                      <tr key={`${row.prioridade}-${row.problema}`} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${badge}`}>
                            {row.prioridade}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium">{row.problema}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                          {row.volume > 0 ? row.volume.toLocaleString("pt-BR") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.onde}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.acao}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </Collapsible>

      <Collapsible title="Municípios que precisam de atenção" icon={<MapPin className="h-4 w-4 text-muted-foreground" />} defaultOpen={true}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader className="pb-3">
              <p className="text-xs text-muted-foreground">
                Ordenados pela quantidade de problemas encontrados nos dados.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {sortedPriorities.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className={thCls}>#</th>
                      <SortTh label="Município" sortKey="municipioNome" currentKey={sortKeyP as string | null} dir={sortDirP} onSort={handleSortP} className={thCls} />
                      <SortTh label="GVE" sortKey="gve" currentKey={sortKeyP as string | null} dir={sortDirP} onSort={handleSortP} className={thCls} />
                      <SortTh label="Problemas" sortKey="criticos" currentKey={sortKeyP as string | null} dir={sortDirP} onSort={handleSortP} className={`${thCls} text-right`} />
                      <SortTh label="Diferença" sortKey="divergencia" currentKey={sortKeyP as string | null} dir={sortDirP} onSort={handleSortP} className={`${thCls} text-right`} />
                      <th className={thCls}>O que fazer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPriorities.map((row, index) => (
                      <tr key={row.key} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            {index + 1}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium">
                          {row.municipioNome !== row.municipio ? row.municipioNome : row.municipio}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.gve || "-"}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-red-700">{row.criticos.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{row.divergencia.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.acao}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  Nenhum município com pendência crítica nos filtros atuais.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Fluxo de atendimento</CardTitle>
              <p className="text-xs text-muted-foreground">
                Quantas pessoas passaram por cada etapa do atendimento.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {funnel.map((item) => {
                const color = item.tone === "green" ? "bg-green-500" : item.tone === "amber" ? "bg-amber-400" : "bg-primary";
                return (
                  <div key={item.label}>
                    <div className="mb-1 flex justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-semibold tabular-nums">{item.value.toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(3, Math.round((item.value / maxFunnel) * 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </Collapsible>
    </div>
  );
}

type DivView = "ano" | "gve" | "municipio";

function DivergenciasTab({ data }: { data: SinanAuditResult }) {
  const [view, setView] = useState<DivView>("ano");
  const [busca, setBusca] = useState("");

  // Sort state for "Por Ano" table
  const [sortKeyAno, setSortKeyAno] = useState<string | null>(null);
  const [sortDirAno, setSortDirAno] = useState<SortDir>("asc");
  const handleSortAno = (key: string) => {
    setSortDirAno((d) => sortKeyAno === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyAno(key);
  };

  // Sort state for "Por GVE" table
  const [sortKeyGve, setSortKeyGve] = useState<string | null>(null);
  const [sortDirGve, setSortDirGve] = useState<SortDir>("asc");
  const handleSortGve = (key: string) => {
    setSortDirGve((d) => sortKeyGve === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyGve(key);
  };

  const normalizedBusca = busca.trim().toLowerCase();
  const allMuni = data.comparisonsByMunicipalityYear?.length
    ? data.comparisonsByMunicipalityYear
    : data.crossBankDivergences;
  const filteredMuni = normalizedBusca
    ? allMuni.filter((d) =>
        `${d.municipio} ${d.municipioNome} ${d.gve} ${d.ano}`.toLowerCase().includes(normalizedBusca)
      )
    : allMuni;

  const totalYear = sumRows(data.divergencesByYear ?? []);
  const totalGve  = sumRows(data.divergencesByGve ?? []);
  const totalMuni = sumRows(filteredMuni);

  const sortedByYear = useSortedRows(data.divergencesByYear ?? [], sortKeyAno as keyof (typeof data.divergencesByYear)[0] | null, sortDirAno);
  const sortedByGve  = useSortedRows(data.divergencesByGve ?? [], sortKeyGve as keyof (typeof data.divergencesByGve)[0] | null, sortDirGve);

  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  const views: { id: DivView; label: string; count: number }[] = [
    { id: "ano",       label: "Por Ano",      count: (data.divergencesByYear ?? []).length },
    { id: "gve",       label: "Por GVE",      count: (data.divergencesByGve ?? []).length },
    { id: "municipio", label: "Por Município", count: allMuni.length },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Como interpretar:</span>{" "}
        cada linha do TRACONET conta como <span className="font-medium">1 caso individual</span>; no NOTTRACONET é
        usada a variável <code className="rounded bg-background px-1 text-xs">NU_CASOPOS</code>{" "}
        (casos positivos consolidados). Diferença{" "}
        <span className="font-semibold text-red-600">positiva</span> = consolidado maior que individual (subregistro no TRACONET).{" "}
        Diferença <span className="font-semibold text-amber-600">negativa</span> = individual maior que consolidado (possível duplicidade).
      </div>

      <Card>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">Agrupar por</span>
          <div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
            {views.map((v) => (
              <button
                key={v.id}
                onClick={() => { setView(v.id); setBusca(""); }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === v.id
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
                <span className={`tabular-nums ${view === v.id ? "text-foreground" : "text-muted-foreground"}`}>
                  ({v.count.toLocaleString("pt-BR")})
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          {view === "ano" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <SortTh label="Ano" sortKey="ano" currentKey={sortKeyAno} dir={sortDirAno} onSort={handleSortAno} className={thCls} />
                  <SortTh label="Individuais (TRACONET)" sortKey="traconet" currentKey={sortKeyAno} dir={sortDirAno} onSort={handleSortAno} className={`${thCls} text-right`} />
                  <SortTh label="Positivos (NOTTRACONET)" sortKey="nottraconet" currentKey={sortKeyAno} dir={sortDirAno} onSort={handleSortAno} className={`${thCls} text-right`} />
                  <SortTh label="Diferença" sortKey="diff" currentKey={sortKeyAno} dir={sortDirAno} onSort={handleSortAno} className={`${thCls} text-right`} />
                  <th className={`${thCls} text-center`}>Risco</th>
                </tr>
              </thead>
              <tbody>
                {sortedByYear.map((d) => (
                  <tr key={d.ano} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium tabular-nums">{d.ano}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{d.traconet.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{d.nottraconet.toLocaleString("pt-BR")}</td>
                    <DiffCell diff={d.diff} />
                    <RiscoCell risco={d.risco} />
                  </tr>
                ))}
                <TotalRow label="Total" traconet={totalYear.traconet} nottraconet={totalYear.nottraconet} diff={totalYear.diff} />
              </tbody>
            </table>
          )}

          {view === "gve" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <SortTh label="GVE" sortKey="gve" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={thCls} />
                  <SortTh label="Individuais (TRACONET)" sortKey="traconet" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={`${thCls} text-right`} />
                  <SortTh label="Positivos (NOTTRACONET)" sortKey="nottraconet" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={`${thCls} text-right`} />
                  <SortTh label="Diferença" sortKey="diff" currentKey={sortKeyGve} dir={sortDirGve} onSort={handleSortGve} className={`${thCls} text-right`} />
                  <th className={`${thCls} text-center`}>Risco</th>
                </tr>
              </thead>
              <tbody>
                {sortedByGve.map((d, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">
                      {d.gve || <span className="italic text-muted-foreground">Não informado</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{d.traconet.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{d.nottraconet.toLocaleString("pt-BR")}</td>
                    <DiffCell diff={d.diff} />
                    <RiscoCell risco={d.risco} />
                  </tr>
                ))}
                <TotalRow label="Total" traconet={totalGve.traconet} nottraconet={totalGve.nottraconet} diff={totalGve.diff} />
              </tbody>
            </table>
          )}

          {view === "municipio" && (
            <div>
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/10 px-4 py-3">
                <div className="relative min-w-52 flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Filtrar por município, GVE ou ano…"
                    className="h-8 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                {busca && (
                  <button onClick={() => setBusca("")} className="text-xs text-muted-foreground hover:text-foreground">
                    Limpar
                  </button>
                )}
              </div>
              <PagedTable
                rows={filteredMuni.map((d) => ({
                  municipioNome: d.municipioNome !== d.municipio ? d.municipioNome : d.municipio,
                  gve: d.gve || "—",
                  ano: d.ano,
                  traconet: d.traconet,
                  nottraconet: d.nottraconet,
                  diff: d.diff,
                  risco: d.risco ?? "baixo"
                }))}
                columns={[
                  { key: "municipioNome", label: "Município",   align: "left"  },
                  { key: "gve",          label: "GVE",          align: "left"  },
                  { key: "ano",          label: "Ano",          align: "right" },
                  { key: "traconet",     label: "Individuais",  align: "right",
                    render: (v) => Number(v).toLocaleString("pt-BR") },
                  { key: "nottraconet",  label: "Positivos",    align: "right",
                    render: (v) => Number(v).toLocaleString("pt-BR") },
                  { key: "diff",         label: "Diferença",    align: "right",
                    render: (v) => {
                      const n = Number(v);
                      return (
                        <span className={n > 0 ? "font-semibold text-red-600" : n < 0 ? "font-semibold text-amber-600" : "text-muted-foreground"}>
                          {n > 0 ? "+" : ""}{n.toLocaleString("pt-BR")}
                        </span>
                      );
                    }
                  },
                  { key: "risco", label: "Risco", align: "center",
                    render: (v) => (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_COLOR[String(v)] ?? ""}`}>
                        {RISK_LABEL[String(v)] ?? String(v)}
                      </span>
                    )
                  }
                ]}
                defaultSortKey="diff"
                defaultSortDir="desc"
                defaultPageSize={20}
                rowKey={(_, i) => String(i)}
                emptyText="Nenhum município com divergência para os filtros aplicados."
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Aba: Qualidade Clínica ────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  agravo: "Agravo", ano: "Ano", dt_notificacao: "Data notificação",
  municipio: "Município", ibge: "Cód. IBGE", gve: "GVE", drs: "DRS",
  unidade: "Unidade notificadora", classificacao: "Classificação (TF/TT)",
  criterio: "Critério diagnóstico", evolucao: "Evolução",
  tratamento: "Tratamento", conclusao: "Conclusão/encerramento"
};

function QualidadeClinicaTab({ data, clinicalMappingMissing }: {
  data: SinanAuditResult; clinicalMappingMissing: boolean;
}) {
  const detalhe = data.semFormaClinicaDetalhe ?? [];
  const gveMap = new Map<string, number>();
  for (const d of detalhe) gveMap.set(d.gve, (gveMap.get(d.gve) ?? 0) + d.count);
  const byGve = Array.from(gveMap.entries()).map(([gve, count]) => ({ gve, count })).sort((a, b) => b.count - a.count);
  const maxMuni = Math.max(...detalhe.map((d) => d.count), 1);
  const maxGve  = Math.max(...byGve.map((d) => d.count), 1);
  const formaResumo = data.formaClinicaResumo ?? [];
  const formaTotal = formaResumo.reduce((sum, item) => sum + item.count, 0);
  const ttSemTsDetalhe = data.ttSemTsDetalhe ?? [];
  const casosComForma = data.casosComFormaClinica ?? data.totalTraconetPositive ?? 0;
  const casosSemForma = data.casosSemFormaPositiva ?? data.semGraduacao ?? 0;
  const correctionRecords = data.correctionRecords ?? [];

  // Toggle dentro da seção de forma clínica (GVE ou Município)
  const [formaView, setFormaView] = useState<"gve" | "municipio">("gve");

  // Sort state — forma clínica por GVE
  const [sortKeyFGve, setSortKeyFGve] = useState<string | null>(null);
  const [sortDirFGve, setSortDirFGve] = useState<SortDir>("asc");
  const handleSortFGve = (key: string) => {
    setSortDirFGve((d) => sortKeyFGve === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyFGve(key);
  };

  // Sort state — forma clínica por Município
  const [sortKeyFMun, setSortKeyFMun] = useState<string | null>(null);
  const [sortDirFMun, setSortDirFMun] = useState<SortDir>("asc");
  const handleSortFMun = (key: string) => {
    setSortDirFMun((d) => sortKeyFMun === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyFMun(key);
  };

  // Sort state — notificações para corrigir
  const [sortKeyCorr, setSortKeyCorr] = useState<string | null>(null);
  const [sortDirCorr, setSortDirCorr] = useState<SortDir>("asc");
  const handleSortCorr = (key: string) => {
    setSortDirCorr((d) => sortKeyCorr === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyCorr(key);
  };

  // Sort state — TT sem TS
  const [sortKeyTT, setSortKeyTT] = useState<string | null>(null);
  const [sortDirTT, setSortDirTT] = useState<SortDir>("asc");
  const handleSortTT = (key: string) => {
    setSortDirTT((d) => sortKeyTT === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyTT(key);
  };

  const sortedByGve = useSortedRows(byGve, sortKeyFGve as keyof (typeof byGve)[0] | null, sortDirFGve);
  const sortedDetalhe = useSortedRows(detalhe, sortKeyFMun as keyof (typeof detalhe)[0] | null, sortDirFMun);
  const sortedCorrectionRecords = useSortedRows(correctionRecords, sortKeyCorr as keyof (typeof correctionRecords)[0] | null, sortDirCorr);
  const sortedTtSemTs = useSortedRows(ttSemTsDetalhe, sortKeyTT as keyof (typeof ttSemTsDetalhe)[0] | null, sortDirTT);

  const alertas = [
    {
      count: data.ttSemTs ?? 0, tone: (data.ttSemTs ?? 0) > 0 ? "red" : "green",
      label: "TT sem TS associado",
      detail: "TT isolado deve ser revisado como possível erro de classificação ou digitação clínica."
    },
    {
      count: data.tfSemTratamento, tone: data.tfSemTratamento > 0 ? "red" : "green",
      label: "TF sem tratamento registrado",
      detail: "TF ativo exige azitromicina. Ausência de registro é inconsistência grave que impede controle epidemiológico."
    },
    {
      count: data.ttSemCircurgia, tone: data.ttSemCircurgia > 0 ? "red" : "green",
      label: "TT sem encaminhamento para cirurgia",
      detail: "Triquíase tracomatosa requer referência oftalmológica. Sem encaminhamento há risco de progressão para cegueira."
    },
    {
      count: data.semTratamento, tone: data.semTratamento > 0 ? "amber" : "green",
      label: "Sem tratamento (geral)",
      detail: "Campo tratamento vazio — verificar se azitromicina ou outra conduta foi omitida no registro."
    },
    {
      count: data.semConclusao, tone: data.semConclusao > 0 ? "amber" : "green",
      label: "Sem conclusão / encerramento",
      detail: "Investigações sem encerramento dificultam o cálculo de prevalência real."
    },
    {
      count: data.anoImpossivel, tone: data.anoImpossivel > 0 ? "amber" : "green",
      label: "Ano impossível",
      detail: "Erro de digitação na data. Corrigir na fonte antes de analisar a série histórica."
    },
    {
      count: data.duplicateNotificationIds?.length ?? 0,
      tone: (data.duplicateNotificationIds?.length ?? 0) > 0 ? "red" : "green",
      label: "Possível duplicidade",
      detail: "Detectado quando coincidem NU_NOTIFIC, iniciais, nome da mãe, data de nascimento e ano."
    }
  ];

  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="space-y-6">

      {/* ── Resumo de KPIs ── */}
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard
          label="Casos com forma compatível"
          value={casosComForma.toLocaleString("pt-BR")}
          sub="TF, TI, TS, TT ou CO marcados no TRACONET"
          tone="green"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <KpiCard
          label="Sem forma positiva"
          value={casosSemForma.toLocaleString("pt-BR")}
          sub="Casos sem TF/TI/TS/TT/CO — devem ser revisados"
          tone={casosSemForma > 0 ? "red" : "green"}
          icon={<XCircle className="h-4 w-4" />}
        />
        <KpiCard
          label="TT sem TS"
          value={(data.ttSemTs ?? 0).toLocaleString("pt-BR")}
          sub="TT isolado — revisar classificação clínica"
          tone={(data.ttSemTs ?? 0) > 0 ? "red" : "green"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {/* ── Seção 1: Forma clínica ── */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Stethoscope className="h-4 w-4 text-primary" />
          Forma clínica — onde corrigir
        </h3>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    {clinicalMappingMissing ? "Forma clínica não mapeada — revisar importação" : "Casos sem forma clínica positiva"}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {clinicalMappingMissing
                      ? "O TRACONET foi importado, mas os campos TF/TI/TS/TT/CO não foram identificados. Verifique o mapeamento antes de tratar como erro de preenchimento."
                      : "Casos individuais (TRACONET) sem nenhuma forma clínica positiva. Agrupar por GVE ou Município para direcionar a correção na fonte."}
                  </p>
                </div>
                {clinicalMappingMissing && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">Revisar mapeamento</span>
                )}
              </div>
              {!clinicalMappingMissing && detalhe.length > 0 && (
                <div className="mt-3 flex gap-1 rounded-lg bg-muted/50 p-0.5 self-start">
                  {(["gve", "municipio"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFormaView(v)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        formaView === v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {v === "gve" ? "Por GVE" : "Por Município"}
                    </button>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto p-0 pt-2">
              {clinicalMappingMissing ? (
                <div className="px-6 py-4 space-y-2 text-sm">
                  <div className="flex gap-8">
                    <div>
                      <div className="text-xs text-muted-foreground">Casos importados</div>
                      <div className="text-xl font-semibold tabular-nums">{data.totalTraconet.toLocaleString("pt-BR")}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Formas mapeadas</div>
                      <div className="text-xl font-semibold tabular-nums text-amber-700">{(data.totalTraconetPositive ?? 0).toLocaleString("pt-BR")}</div>
                    </div>
                  </div>
                  {(data.diagnostico?.traconet?.colunas?.length ?? 0) > 0 && (
                    <details className="mt-2 rounded-md border p-3">
                      <summary className="cursor-pointer text-xs font-medium">Ver colunas detectadas no TRACONET</summary>
                      <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                        {data.diagnostico.traconet.colunas.join(", ")}
                      </p>
                    </details>
                  )}
                </div>
              ) : !detalhe.length ? (
                <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  Nenhum caso sem forma clínica
                </div>
              ) : formaView === "gve" ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <SortTh label="GVE" sortKey="gve" currentKey={sortKeyFGve} dir={sortDirFGve} onSort={handleSortFGve} className={thCls} />
                      <SortTh label="Casos s/ forma" sortKey="count" currentKey={sortKeyFGve} dir={sortDirFGve} onSort={handleSortFGve} className={`${thCls} text-right`} />
                      <th className={`${thCls} w-48`}>Proporção</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedByGve.map((d) => (
                      <tr key={d.gve} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{d.gve}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{d.count.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2.5">
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round((d.count / maxGve) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <SortTh label="Município" sortKey="municipioNome" currentKey={sortKeyFMun} dir={sortDirFMun} onSort={handleSortFMun} className={thCls} />
                      <SortTh label="GVE" sortKey="gve" currentKey={sortKeyFMun} dir={sortDirFMun} onSort={handleSortFMun} className={thCls} />
                      <SortTh label="Casos s/ forma" sortKey="count" currentKey={sortKeyFMun} dir={sortDirFMun} onSort={handleSortFMun} className={`${thCls} text-right`} />
                      <th className={`${thCls} w-40`}>Proporção</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDetalhe.map((d, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-medium">
                          {d.municipioNome !== d.municipio ? d.municipioNome : d.municipio}
                          {d.municipioNome !== d.municipio && (
                            <span className="ml-1 text-[10px] text-muted-foreground">({d.municipio})</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.gve}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{d.count.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2.5">
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round((d.count / maxMuni) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distribuição das formas clínicas</CardTitle>
              <p className="text-xs text-muted-foreground">Um registro pode ter mais de uma forma combinada.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {formaResumo.length ? formaResumo.map((item) => (
                <div key={item.forma}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium">{item.forma}</span>
                    <span className="tabular-nums text-muted-foreground">{item.count.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(4, Math.round((item.count / Math.max(formaTotal, 1)) * 100))}%` }} />
                  </div>
                </div>
              )) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  Nenhuma forma clínica positiva identificada no TRACONET importado.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Seção 2: Alertas clínicos ── */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Alertas clínicos
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {alertas.map((a) => {
            const icon = a.tone === "red"
              ? <XCircle className="h-5 w-5 text-red-500" />
              : a.tone === "amber"
                ? <AlertTriangle className="h-5 w-5 text-amber-500" />
                : <CheckCircle2 className="h-5 w-5 text-green-500" />;
            const border = a.tone === "red" ? "border-red-200 bg-red-50"
              : a.tone === "amber" ? "border-amber-200 bg-amber-50"
              : "border-green-200 bg-green-50";
            const numColor = a.tone === "red" ? "text-red-700"
              : a.tone === "amber" ? "text-amber-700" : "text-green-700";
            return (
              <div key={a.label} className={`flex items-start gap-3 rounded-lg border p-3 ${border}`}>
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`text-xl font-bold tabular-nums ${numColor}`}>{a.count.toLocaleString("pt-BR")}</span>
                    <span className="text-xs font-semibold leading-tight">{a.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-snug">{a.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Seção 3: Notificações para corrigir ── */}
      {correctionRecords.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <ClipboardList className="h-4 w-4 text-primary" />
            Notificações para solicitar correção
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              {correctionRecords.length.toLocaleString("pt-BR")}
            </span>
          </h3>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <SortTh label="Prioridade" sortKey="priority" currentKey={sortKeyCorr} dir={sortDirCorr} onSort={handleSortCorr} className={thCls} />
                    <SortTh label="Problema" sortKey="problem" currentKey={sortKeyCorr} dir={sortDirCorr} onSort={handleSortCorr} className={thCls} />
                    <th className={thCls}>NU_NOTIFIC / row_key</th>
                    <SortTh label="Município" sortKey="municipio" currentKey={sortKeyCorr} dir={sortDirCorr} onSort={handleSortCorr} className={thCls} />
                    <SortTh label="GVE" sortKey="gve" currentKey={sortKeyCorr} dir={sortDirCorr} onSort={handleSortCorr} className={thCls} />
                    <SortTh label="Ano" sortKey="ano" currentKey={sortKeyCorr} dir={sortDirCorr} onSort={handleSortCorr} className={`${thCls} text-right`} />
                    <th className={thCls}>Campo</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCorrectionRecords.slice(0, 80).map((item, index) => (
                    <tr key={`${item.problem}-${item.notificationId ?? item.rowKey ?? index}`} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          item.priority === "Critica" ? "border-red-200 bg-red-50 text-red-700"
                            : item.priority === "Alta" ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-sky-200 bg-sky-50 text-sky-700"
                        }`}>{item.priority}</span>
                      </td>
                      <td className="px-4 py-2.5 font-medium">{item.problem}</td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-xs" title={item.notificationId ?? item.rowKey ?? ""}>
                        {item.notificationId ?? item.rowKey ?? "Sem identificador"}
                      </td>
                      <td className="px-4 py-2.5">{item.municipioNome || item.municipio}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.gve}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{item.ano ?? "-"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{item.field}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {correctionRecords.length > 80 && (
                <div className="border-t px-4 py-3 text-xs text-muted-foreground">
                  Exibindo 80 de {correctionRecords.length.toLocaleString("pt-BR")}. Use "Exportar correções" para baixar a lista completa.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Seção 4: TT sem TS detalhado ── */}
      {ttSemTsDetalhe.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <MapPin className="h-4 w-4 text-red-500" />
            TT sem TS — onde revisar
          </h3>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <SortTh label="Município" sortKey="municipioNome" currentKey={sortKeyTT} dir={sortDirTT} onSort={handleSortTT} className={thCls} />
                    <SortTh label="GVE" sortKey="gve" currentKey={sortKeyTT} dir={sortDirTT} onSort={handleSortTT} className={thCls} />
                    <SortTh label="Casos" sortKey="count" currentKey={sortKeyTT} dir={sortDirTT} onSort={handleSortTT} className={`${thCls} text-right`} />
                  </tr>
                </thead>
                <tbody>
                  {sortedTtSemTs.slice(0, 50).map((d, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">
                        {d.municipioNome !== d.municipio ? d.municipioNome : d.municipio}
                        {d.municipioNome !== d.municipio && (
                          <span className="ml-1 text-[10px] text-muted-foreground">({d.municipio})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.gve}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-red-700">{d.count.toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}

// ── Aba: Completude & Técnico ─────────────────────────────────────────────────

function CompletudeTecnicoTab({ data }: { data: SinanAuditResult }) {
  const [showAllFields, setShowAllFields] = useState(false);
  const [showBancoDetail, setShowBancoDetail] = useState<"traconet" | "nottraconet" | null>(null);

  // Sort state — duplicidades
  const [sortKeyDup, setSortKeyDup] = useState<string | null>(null);
  const [sortDirDup, setSortDirDup] = useState<SortDir>("asc");
  const handleSortDup = (key: string) => {
    setSortDirDup((d) => sortKeyDup === key ? (d === "asc" ? "desc" : "asc") : "asc");
    setSortKeyDup(key);
  };
  const sortedDuplicates = useSortedRows(
    data.duplicateNotificationIds ?? [],
    sortKeyDup as keyof (typeof data.duplicateNotificationIds)[0] | null,
    sortDirDup
  );

  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  const allFields = Object.entries(data.fieldCompleteness);
  const criticalFields = allFields.filter(([, s]) => s.pct < 50 && s.total > 0);
  const warnFields     = allFields.filter(([, s]) => s.pct >= 50 && s.pct < 70 && s.total > 0);
  const okFields       = allFields.filter(([, s]) => s.pct >= 70);
  const sortedFields   = [...criticalFields, ...warnFields, ...okFields];
  const visibleFields  = showAllFields ? sortedFields : sortedFields.slice(0, 6);

  return (
    <div className="space-y-5">

      {/* Recomendações — no topo pois são o item mais acionável */}
      {data.recommendations.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-semibold text-primary">
              Recomendações prioritárias ({data.recommendations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ol className="space-y-1.5">
              {data.recommendations.map((rec, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <span>{rec}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Completude dos campos */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Completude dos campos — TRACONET</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                % de registros com campo preenchido. Abaixo de 70% indica problema de mapeamento ou subnotificação.
              </p>
            </div>
            <div className="flex shrink-0 gap-2 text-xs">
              {criticalFields.length > 0 && (
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-700">
                  {criticalFields.length} crítico{criticalFields.length > 1 ? "s" : ""}
                </span>
              )}
              {warnFields.length > 0 && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                  {warnFields.length} atenção
                </span>
              )}
              {okFields.length > 0 && (
                <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 font-medium text-green-700">
                  {okFields.length} ok
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visibleFields.map(([field, stat]) => (
              <PctBar key={field} label={FIELD_LABELS[field] ?? field} pct={stat.pct} />
            ))}
          </div>
          {sortedFields.length > 6 && (
            <button
              onClick={() => setShowAllFields(!showAllFields)}
              className="mt-3 w-full rounded-md border border-dashed py-1.5 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
            >
              {showAllFields
                ? "Mostrar menos"
                : `Ver todos os ${sortedFields.length} campos`}
            </button>
          )}
        </CardContent>
      </Card>

      {/* Diagnóstico de importação — compacto */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-base">Diagnóstico de importação</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Resumo do que foi detectado em cada banco ao importar o arquivo.
          </p>
        </CardHeader>
        <CardContent className="pb-4 space-y-3">
          {(["traconet", "nottraconet"] as const).map((banco) => {
            const d = data.diagnostico[banco];
            const count = banco === "traconet" ? data.totalTraconet : data.totalNottraconetRows;
            const isOpen = showBancoDetail === banco;
            return (
              <div key={banco} className="rounded-lg border bg-muted/20">
                <button
                  onClick={() => setShowBancoDetail(isOpen ? null : banco)}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-semibold text-sm">
                      {banco === "traconet" ? "TRACONET" : "NOTTRACONET"}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {banco === "traconet" ? "Casos individuais" : "Consolidado"} · {count.toLocaleString("pt-BR")} linhas
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>{d.anosAmostra.join(", ") || "sem anos"}</span>
                    <span className="text-muted-foreground/40">|</span>
                    <span>{d.municipiosAmostra.length} munic.</span>
                    <span className={`ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t px-3 pb-3 pt-2 space-y-2">
                    <div className="text-xs space-y-1 text-muted-foreground">
                      <p><span className="font-medium text-foreground">Municípios:</span> {d.municipiosAmostra.join(", ") || "—"}</p>
                      <p><span className="font-medium text-foreground">Campos reconhecidos:</span> {d.camposPreenchidos.join(", ") || "nenhum"}</p>
                    </div>
                    {d.colunas.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          Colunas originais do arquivo ({d.colunas.length})
                        </summary>
                        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{d.colunas.join(", ")}</p>
                      </details>
                    )}
                    {d.camposNumericos.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          Campos numéricos com exemplo ({d.camposNumericos.length})
                        </summary>
                        <div className="mt-2 max-h-40 overflow-auto rounded-md border bg-background">
                          <table className="w-full text-[11px]">
                            <tbody>
                              {d.camposNumericos.map((item) => (
                                <tr key={item.campo} className="border-b last:border-0">
                                  <td className="px-2 py-1 font-mono">{item.campo}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{item.exemplo.toLocaleString("pt-BR")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Possíveis duplicidades — só exibe se houver */}
      {(data.duplicateNotificationIds?.length ?? 0) > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-base text-red-700">
              Possíveis duplicidades — {data.duplicateNotificationIds.length.toLocaleString("pt-BR")} chaves
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Coincidem NU_NOTIFIC, iniciais, data de nascimento e ano. Casos diferentes com mesmo número não são contados.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <SortTh label="NU_NOTIFIC" sortKey="id" currentKey={sortKeyDup} dir={sortDirDup} onSort={handleSortDup} className={thCls} />
                  <th className={thCls}>Iniciais</th>
                  <th className={thCls}>Nascimento</th>
                  <SortTh label="Município" sortKey="municipio" currentKey={sortKeyDup} dir={sortDirDup} onSort={handleSortDup} className={thCls} />
                  <SortTh label="Ano" sortKey="ano" currentKey={sortKeyDup} dir={sortDirDup} onSort={handleSortDup} className={`${thCls} text-right`} />
                  <SortTh label="Repetições" sortKey="count" currentKey={sortKeyDup} dir={sortDirDup} onSort={handleSortDup} className={`${thCls} text-right`} />
                </tr>
              </thead>
              <tbody>
                {sortedDuplicates.slice(0, 30).map((item) => (
                  <tr key={item.caseKey ?? item.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 font-mono text-xs">{item.id}</td>
                    <td className="px-4 py-2 font-mono text-xs">{item.iniciais || "-"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{item.dataNascimento || "-"}</td>
                    <td className="px-4 py-2">{item.municipio}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{item.ano || "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-red-700">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.duplicateNotificationIds.length > 30 && (
              <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                Exibindo 30 de {data.duplicateNotificationIds.length.toLocaleString("pt-BR")} duplicidades.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Aba: Qualidade dos dados (fusão Divergências + Clínica + Completude) ──────

function QualidadeDadosTab({ data, clinicalMappingMissing, yearChartData }: {
  data: SinanAuditResult;
  clinicalMappingMissing: boolean;
  yearChartData: { ano: string; individuais: number; positivos: number }[];
}) {
  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        Esta seção é voltada para analistas e equipes técnicas responsáveis pela qualidade dos dados.
      </div>

      {yearChartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Série histórica — casos registrados por ano</CardTitle>
            <p className="text-xs text-muted-foreground">
              Comparação entre os casos individuais e o consolidado anual. Divergências persistentes ao longo dos anos indicam problema estrutural nos bancos.
            </p>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearChartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                <XAxis dataKey="ano" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={48} />
                <Tooltip formatter={(v) => Number(v).toLocaleString("pt-BR")} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="individuais" name="Casos individuais" stroke="#0f766e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="positivos"   name="Positivos consolidados" stroke="#dc2626" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Collapsible
        title="Divergências entre os dois bancos"
        icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
        defaultOpen={true}
      >
        <p className="text-sm text-muted-foreground">
          Comparação entre os casos registrados individualmente e o consolidado anual.
          Diferenças grandes precisam ser investigadas antes de publicar indicadores.
        </p>
        <DivergenciasTab data={data} />
      </Collapsible>
      <Collapsible
        title="Alertas e problemas clínicos"
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        defaultOpen={true}
      >
        <p className="text-sm text-muted-foreground">
          Registros com inconsistências que precisam de revisão direta no sistema ou junto ao município.
        </p>
        <QualidadeClinicaTab data={data} clinicalMappingMissing={clinicalMappingMissing} />
      </Collapsible>
      <Collapsible
        title="Completude dos campos"
        icon={<ClipboardList className="h-4 w-4 text-muted-foreground" />}
        defaultOpen={false}
      >
        <p className="text-sm text-muted-foreground">
          Percentual de preenchimento de cada campo e diagnóstico técnico da importação.
        </p>
        <CompletudeTecnicoTab data={data} />
      </Collapsible>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

type PageTab = "situacao" | "auditoria";

export function SinanQualidadeView() {
  const [municipio, setMunicipio] = useState("");
  const [gve,       setGve]       = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd,   setYearEnd]   = useState("");
  const [filters,   setFilters]   = useState<Record<string, string>>({});
  const [pageTab,   setPageTab]   = useState<PageTab>("situacao");
  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gve), [gve]);

  const buildFilterParams = (source: Record<string, string>) => {
    const params = new URLSearchParams();
    if (source.municipio) params.set("municipio", source.municipio);
    if (source.gve)       params.set("gve",       source.gve);
    if (source.yearStart) params.set("yearStart", source.yearStart);
    if (source.yearEnd)   params.set("yearEnd",   source.yearEnd);
    return params;
  };

  const { data, error, isLoading, isFetching, refetch } = useQuery<SinanAuditResult, ApiError>({
    queryKey: ["sinan-auditoria", filters],
    queryFn: async () => {
      const params = buildFilterParams(filters);
      const res = await fetch(`/api/sinan/auditoria?${params}`);
      if (!res.ok) throw await res.json().catch(() => ({})) as ApiError;
      return res.json() as Promise<SinanAuditResult>;
    },
    retry: false
  });

  const apiError = error as ApiError | null;

  const hasData = Boolean(data && (data.totalTraconet > 0 || (data.totalNottraconetRows ?? 0) > 0));
  const highRisk = data?.crossBankDivergences.filter((d) => d.risco === "alto").length ?? 0;
  const clinicalMappingMissing = Boolean(
    data && data.totalTraconet > 0 &&
    (data.totalTraconetPositive ?? 0) === 0 &&
    data.semGraduacao === data.totalTraconet
  );
  const alertasCount =
    (data?.tfSemTratamento ?? 0) +
    (data?.ttSemCircurgia ?? 0) +
    (data?.ttSemTs ?? 0) +
    (data?.semConclusao ?? 0) +
    (data?.duplicateNotificationIds?.length ?? 0) +
    (clinicalMappingMissing ? 0 : data?.semGraduacao ?? 0);
  const criticosCount =
    (data?.casosSemFormaPositiva ?? data?.semGraduacao ?? 0) +
    (data?.ttSemTs ?? 0) +
    (data?.duplicateNotificationIds?.length ?? 0);

  const yearChartData = [...(data?.divergencesByYear ?? [])]
    .sort((a, b) => a.ano - b.ano)
    .map((r) => ({ ano: String(r.ano), individuais: r.traconet, positivos: r.nottraconet }));

  const priorities = data ? buildManagementRows(data) : [];

  const pageTabs: { id: PageTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "situacao",  label: "Situação atual",      icon: <Target className="h-4 w-4" />,  badge: priorities.length > 0 ? priorities.length : undefined },
    { id: "auditoria", label: "Auditoria", icon: <Activity className="h-4 w-4" />, badge: highRisk > 0 ? highRisk : undefined },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">

      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Tracoma</h1>
            <p className="text-sm text-muted-foreground">
              Situação atual e auditoria dos dados do tracoma.
            </p>
            <Link href="/dashboard" className="mt-1 inline-flex text-xs font-medium text-primary underline">
              Voltar para a Sala de Situação
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const params = new URLSearchParams({ ...filters, format: "csv" });
                  window.location.href = `/api/sinan/auditoria?${params.toString()}`;
                }}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Exportar CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadTextFile(`relatorio-sinan-tracoma-${new Date().toISOString().slice(0, 10)}.txt`, buildSinanTechnicalReport(data, filters))}
              >
                Relatório técnico
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => { refetch(); }} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 rounded-xl border bg-card/95 px-5 py-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Região de Saúde (GVE)</label>
          <select
            value={gve}
            onChange={(e) => {
              setGve(e.target.value);
              setMunicipio("");
            }}
            className="h-8 w-56 rounded-md border bg-background px-2.5 text-sm"
          >
            <option value="">Todos os GVE</option>
            {gveOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Município</label>
          <select
            value={municipio}
            onChange={(e) => setMunicipio(e.target.value)}
            className="h-8 w-64 rounded-md border bg-background px-2.5 text-sm"
          >
            <option value="">Todos os municípios</option>
            {municipioOptions.map((item) => (
              <option key={item.codigo} value={item.codigo}>{item.nome}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Ano — de</label>
          <input
            value={yearStart}
            onChange={(e) => setYearStart(e.target.value)}
            placeholder="2020"
            type="number"
            className="h-8 w-24 rounded-md border bg-background px-2.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">até</label>
          <input
            value={yearEnd}
            onChange={(e) => setYearEnd(e.target.value)}
            placeholder="2024"
            type="number"
            className="h-8 w-24 rounded-md border bg-background px-2.5 text-sm"
          />
        </div>
        <Button size="sm" onClick={() => setFilters({ municipio, gve, yearStart, yearEnd })} disabled={isFetching}>
          Aplicar
        </Button>
        {Object.values(filters).some(Boolean) && (
          <Button size="sm" variant="ghost" onClick={() => {
            setMunicipio(""); setGve(""); setYearStart(""); setYearEnd("");
            setFilters({});
          }}>
            Limpar
          </Button>
        )}
      </div>

      {/* ── Estados de carregamento / erro / sem dados ───────────────────── */}
      {isLoading && (
        <div className="flex h-48 items-center justify-center gap-3 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Analisando dados SINAN…</span>
        </div>
      )}
      {apiError?.error === "tabela_ausente" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Migration não aplicada</p>
              <p className="mt-1 text-sm text-amber-800">
                A tabela <code className="rounded bg-amber-100 px-1">sinan_tracoma_rows</code> ainda não existe.
                Execute a migration e depois importe os dados em{" "}
                <a href="/sincronizacao" className="font-medium underline">Sincronização</a>.
              </p>
            </div>
          </div>
        </div>
      )}
      {apiError && apiError.error !== "tabela_ausente" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Erro ao carregar auditoria: {apiError.message ?? apiError.error}
        </div>
      )}
      {!isLoading && !apiError && data && !hasData && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border bg-card text-muted-foreground">
          <Database className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum registro SINAN importado ainda.</p>
          <a href="/sincronizacao" className="text-sm font-medium text-primary underline">Ir para Sincronização</a>
        </div>
      )}

      {data && hasData && (
        <>
          {/* ── Aviso banco invertido ───────────────────────────────────────── */}
          {data.diagnostico?.aviso && (
            <div className="rounded-xl border-2 border-red-400 bg-red-50 p-4">
              <div className="flex gap-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div className="space-y-2">
                  <p className="font-bold text-red-900">Bancos importados invertidos!</p>
                  <p className="text-sm text-red-800">{data.diagnostico.aviso}</p>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-red-700">SQL para corrigir no Supabase ▼</summary>
                    <pre className="mt-2 overflow-x-auto rounded bg-red-100 p-3 text-xs font-mono text-red-900">{
`UPDATE public.sinan_tracoma_rows SET source_bank = CASE
  WHEN source_bank = 'traconet'    THEN 'nottraconet'
  WHEN source_bank = 'nottraconet' THEN 'traconet'
END;`}</pre>
                  </details>
                </div>
              </div>
            </div>
          )}

          {/* ── Navegação principal ──────────────────────────────────────────── */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex gap-0 border-b overflow-x-auto">
              {pageTabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setPageTab(t.id)}
                  className={`flex items-center gap-2 whitespace-nowrap px-6 py-3.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    pageTab === t.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {t.badge !== undefined && t.badge > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                      pageTab === t.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}>{t.badge.toLocaleString("pt-BR")}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="p-5">

              {/* ── Aba: Situação atual ──────────────────────────────────────── */}
              {pageTab === "situacao" && (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <KpiCard
                      label="Pessoas examinadas"
                      value={data.consolidatedMetrics?.examinados?.value ?? 0}
                      sub="No período e região selecionados"
                      tone={(data.consolidatedMetrics?.examinados?.value ?? 0) > 0 ? "neutral" : "amber"}
                      icon={<ClipboardList className="h-4 w-4" />}
                    />
                    <KpiCard
                      label="Casos confirmados de tracoma"
                      value={data.totalNottraconet}
                      sub="Positivos no consolidado"
                      icon={<Activity className="h-4 w-4" />}
                    />
                    <KpiCard
                      label="Municípios com pendências"
                      value={priorities.length}
                      sub={priorities.length > 0 ? "Precisam de atenção" : "Nenhuma pendência detectada"}
                      tone={priorities.length > 0 ? "amber" : "green"}
                      icon={<Target className="h-4 w-4" />}
                    />
                    <KpiCard
                      label="Situação dos dados"
                      value={criticosCount > 0 ? "Atenção" : "Em ordem"}
                      sub={criticosCount > 0 ? `${criticosCount} registro(s) crítico(s) a corrigir` : "Sem pendências críticas detectadas"}
                      tone={criticosCount > 0 ? "red" : "green"}
                      icon={criticosCount > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    />
                  </div>

                  <GestaoTab data={data} />
                </div>
              )}

              {/* ── Aba: Qualidade dos dados ─────────────────────────────────── */}
              {pageTab === "auditoria" && (
                <QualidadeDadosTab data={data} clinicalMappingMissing={clinicalMappingMissing} yearChartData={yearChartData} />
              )}

            </div>
          </div>
        </>
      )}
    </div>
  );
}
