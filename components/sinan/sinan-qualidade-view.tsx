"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, ClipboardList,
  Database, RefreshCw, XCircle
} from "lucide-react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SinanAuditResult } from "@/services/sinan-tracoma";

interface ApiError { error: string; message?: string }

const RISK_LABEL: Record<string, string> = { alto: "Alto", medio: "Médio", baixo: "Baixo" };
const RISK_COLOR: Record<string, string> = {
  alto:  "bg-red-100 text-red-700 border-red-200",
  medio: "bg-amber-100 text-amber-700 border-amber-200",
  baixo: "bg-blue-100 text-blue-700 border-blue-200"
};

function PctBar({ pct, label }: { pct: number; label: string }) {
  const color = pct >= 90 ? "bg-green-500" : pct >= 70 ? "bg-amber-400" : "bg-red-500";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${pct >= 90 ? "text-green-700" : pct >= 70 ? "text-amber-700" : "text-red-700"}`}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AlertCard({ count, label, severity, detail }: {
  count: number; label: string; severity: "critical" | "warning" | "ok"; detail?: string;
}) {
  const styles = {
    critical: { border: "border-red-200 bg-red-50",   icon: <XCircle    className="h-5 w-5 text-red-500" />,   num: "text-red-700" },
    warning:  { border: "border-amber-200 bg-amber-50", icon: <AlertTriangle className="h-5 w-5 text-amber-500" />, num: "text-amber-700" },
    ok:       { border: "border-green-200 bg-green-50", icon: <CheckCircle2  className="h-5 w-5 text-green-500" />, num: "text-green-700" }
  }[severity];
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

function NotificationIdPanel({ data }: { data: SinanAuditResult }) {
  if (!data.missingNotificationId && !data.duplicateNotificationIds?.length) return null;

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Identificador da Notificacao - TRACONET</CardTitle>
        <p className="text-xs text-muted-foreground">
          Verifica NU_NOTIFIC e variacoes no banco individual. Duplicidade desse identificador sugere caso repetido ou importacao duplicada.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <AlertCard
            count={data.missingNotificationId ?? 0}
            label="sem ID de notificacao"
            severity={data.missingNotificationId > 0 ? "warning" : "ok"}
            detail="Sem esse campo, a tela nao consegue rastrear duplicidades com seguranca."
          />
          <AlertCard
            count={data.duplicateNotificationIds?.length ?? 0}
            label="IDs duplicados"
            severity={(data.duplicateNotificationIds?.length ?? 0) > 0 ? "critical" : "ok"}
            detail="O mesmo NU_NOTIFIC aparece em mais de uma linha do TRACONET."
          />
        </div>

        {(data.duplicateNotificationIds?.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">ID notificacao</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Municipio</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Ano</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Repeticoes</th>
                </tr>
              </thead>
              <tbody>
                {data.duplicateNotificationIds.slice(0, 20).map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{item.id}</td>
                    <td className="px-4 py-2">{item.municipio}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{item.ano || "-"}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-red-700">{item.count}</td>
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

const CONSOLIDATED_METRIC_LABELS: Record<string, string> = {
  examinados: "Examinados",
  positivos: "Positivos",
  casosInformados: "Casos informados",
  negativos: "Negativos",
  tratados: "Tratados",
  comunicantes: "Comunicantes",
  tf: "TF",
  ti: "TI",
  ts: "TS",
  tt: "TT",
  co: "CO"
};

function ConsolidatedMetricsPanel({ data }: { data: SinanAuditResult }) {
  const entries = Object.entries(data.consolidatedMetrics ?? {})
    .filter(([, item]) => item.value > 0 || item.field);

  if (!entries.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Indicadores do Consolidado (NOTTRACONET/NTRACOMA)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Estes campos existem no consolidado e não devem ser confundidos com número de linhas do arquivo.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {entries.map(([key, item]) => (
          <div key={key} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{CONSOLIDATED_METRIC_LABELS[key] ?? key}</div>
            <div className="text-lg font-semibold tabular-nums">{Number(item.value ?? 0).toLocaleString("pt-BR")}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Campo: {item.field ?? "não identificado"}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ClinicalMappingNotice({ data }: { data: SinanAuditResult }) {
  const rawColumns = data.diagnostico?.traconet?.colunas ?? [];
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-amber-900">Forma clinica nao mapeada no TRACONET</CardTitle>
        <p className="text-xs text-amber-800">
          O TRACONET foi importado, mas a pagina nao identificou campos TF/TI/TS/TT/CO nos nomes esperados. Por isso nao vou listar todos os casos como sem forma clinica; isso parece problema de mapeamento, nao necessariamente erro de preenchimento.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-amber-900">
        <div>Casos individuais importados: <span className="font-semibold">{data.totalTraconet.toLocaleString("pt-BR")}</span></div>
        <div>Formas clinicas positivas mapeadas: <span className="font-semibold">{data.totalTraconetPositive.toLocaleString("pt-BR")}</span></div>
        {rawColumns.length > 0 && (
          <details>
            <summary className="cursor-pointer font-medium">Ver colunas detectadas no TRACONET</summary>
            <p className="mt-2 break-all font-mono text-[11px]">{rawColumns.join(", ")}</p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

type DivTab = "ano" | "gve" | "municipio";
type SFTab  = "gve" | "municipio";

function SemFormaClinicaPanel({ data }: { data: SinanAuditResult }) {
  const [tab, setTab] = useState<SFTab>("gve");
  const detalhe = data.semFormaClinicaDetalhe ?? [];
  if (detalhe.length === 0) return null;

  // Aggregate by GVE
  const gveMap = new Map<string, number>();
  for (const d of detalhe) {
    gveMap.set(d.gve, (gveMap.get(d.gve) ?? 0) + d.count);
  }
  const byGve = Array.from(gveMap.entries())
    .map(([gve, count]) => ({ gve, count }))
    .sort((a, b) => b.count - a.count);

  const maxCount = Math.max(...detalhe.map((d) => d.count), 1);

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="text-amber-700">Sem Forma Clínica — Onde Corrigir</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {data.semGraduacao.toLocaleString("pt-BR")} casos
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Casos individuais (TRACONET) sem TF/TI/TS/TT/CO preenchido, agrupados por GVE e município.
          Use para direcionar a correção na fonte.
        </p>
        <div className="mt-3 flex gap-1 border-b">
          {(["gve", "municipio"] as SFTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "gve" ? "Por GVE" : "Por Município"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {tab === "gve" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">GVE</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Casos s/ forma clínica</th>
                <th className="px-4 py-2 text-muted-foreground" />
              </tr>
            </thead>
            <tbody>
              {byGve.map((d) => {
                const maxGve = Math.max(...byGve.map((x) => x.count), 1);
                const pct = Math.round((d.count / maxGve) * 100);
                return (
                  <tr key={d.gve} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{d.gve}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-700">
                      {d.count.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-2 w-40">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === "municipio" && (
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Município</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">GVE</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Casos s/ forma clínica</th>
                <th className="px-4 py-2 text-muted-foreground" />
              </tr>
            </thead>
            <tbody>
              {detalhe.map((d, i) => {
                const pct = Math.round((d.count / maxCount) * 100);
                return (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">
                      {d.municipioNome !== d.municipio ? d.municipioNome : d.municipio}
                      {d.municipioNome !== d.municipio && (
                        <span className="ml-1 text-[10px] text-muted-foreground">({d.municipio})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{d.gve}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-700">
                      {d.count.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-2 w-40">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function DiffCell({ diff }: { diff: number }) {
  return (
    <td
      className={`px-4 py-2 text-right tabular-nums font-semibold ${diff > 0 ? "text-red-600" : diff < 0 ? "text-amber-600" : "text-muted-foreground"}`}
      title={diff > 0 ? "Consolidado > individuais: possível subregistro" : diff < 0 ? "Individuais > consolidado: verificar duplicidade" : ""}
    >
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

function DivergenciasPanel({ data }: { data: SinanAuditResult }) {
  const [tab, setTab] = useState<DivTab>("ano");
  const [municipioBusca, setMunicipioBusca] = useState("");
  const [mostrarTodosMunicipios, setMostrarTodosMunicipios] = useState(false);

  const total = data.crossBankDivergences.length;
  const municipalityRows = data.comparisonsByMunicipalityYear?.length
    ? data.comparisonsByMunicipalityYear
    : data.crossBankDivergences;
  const normalizedBusca = municipioBusca.trim().toLowerCase();
  const filteredMunicipalityRows = normalizedBusca
    ? municipalityRows.filter((d) =>
        `${d.municipio} ${d.municipioNome} ${d.gve} ${d.ano}`.toLowerCase().includes(normalizedBusca)
      )
    : municipalityRows;
  const visibleMunicipalityRows = mostrarTodosMunicipios ? filteredMunicipalityRows : filteredMunicipalityRows.slice(0, 50);
  const totalYear = sumRows(data.divergencesByYear ?? []);
  const totalGve = sumRows(data.divergencesByGve ?? []);
  const totalMunicipio = sumRows(filteredMunicipalityRows);
  const tabs: { id: DivTab; label: string }[] = [
    { id: "ano",      label: "Por Ano"       },
    { id: "gve",      label: "Por GVE"       },
    { id: "municipio", label: "Por Município" }
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Divergências: Casos Individuais (TRACONET) × Positivos Consolidados (NOTTRACONET)
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {total} municípios/ano
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A comparação usa 1 linha do TRACONET como 1 caso individual e compara com a variável de positivos do consolidado. Anos inválidos ficam fora desta tabela e aparecem como alerta de qualidade.
        </p>
        {/* Tabs */}
        <div className="mt-3 flex gap-1 border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">

        {/* ABA: Por Ano */}
        {tab === "ano" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Ano</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Casos individuais</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Positivos consolidados</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Diferença</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground">Risco</th>
              </tr>
            </thead>
            <tbody>
              {(data.divergencesByYear ?? []).map((d) => (
                <tr key={d.ano} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium tabular-nums">{d.ano}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.traconet.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.nottraconet.toLocaleString("pt-BR")}</td>
                  <DiffCell diff={d.diff} />
                  <RiscoCell risco={d.risco} />
                </tr>
              ))}
              <TotalRow label="Total" traconet={totalYear.traconet} nottraconet={totalYear.nottraconet} diff={totalYear.diff} colSpan={1} />
            </tbody>
          </table>
        )}

        {/* ABA: Por GVE */}
        {tab === "gve" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">GVE</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Casos individuais</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Positivos consolidados</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Diferença</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground">Risco</th>
              </tr>
            </thead>
            <tbody>
              {(data.divergencesByGve ?? []).map((d, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{d.gve || <span className="text-muted-foreground italic">Não informado</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.traconet.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.nottraconet.toLocaleString("pt-BR")}</td>
                  <DiffCell diff={d.diff} />
                  <RiscoCell risco={d.risco} />
                </tr>
              ))}
              <TotalRow label="Total" traconet={totalGve.traconet} nottraconet={totalGve.nottraconet} diff={totalGve.diff} colSpan={1} />
            </tbody>
          </table>
        )}

        {/* ABA: Por Município */}
        {tab === "municipio" && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
              <input
                value={municipioBusca}
                onChange={(event) => {
                  setMunicipioBusca(event.target.value);
                  setMostrarTodosMunicipios(false);
                }}
                placeholder="Filtrar municipio, GVE ou ano nesta tabela"
                className="h-8 min-w-64 flex-1 rounded-md border bg-background px-2 text-sm"
              />
              <div className="text-xs text-muted-foreground">
                Exibindo {visibleMunicipalityRows.length.toLocaleString("pt-BR")} de {filteredMunicipalityRows.length.toLocaleString("pt-BR")}
              </div>
            </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Município</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">GVE</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Ano</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Casos individuais</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Positivos consolidados</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Diferença</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground">Risco</th>
              </tr>
            </thead>
            <tbody>
              {visibleMunicipalityRows.map((d, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">
                    {d.municipioNome !== d.municipio ? d.municipioNome : d.municipio}
                    {d.municipioNome !== d.municipio && (
                      <span className="ml-1 text-[10px] text-muted-foreground">({d.municipio})</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{d.gve || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.ano}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.traconet.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.nottraconet.toLocaleString("pt-BR")}</td>
                  <DiffCell diff={d.diff} />
                  <RiscoCell risco={d.risco} />
                </tr>
              ))}
              <TotalRow label={municipioBusca ? "Total filtrado" : "Total"} traconet={totalMunicipio.traconet} nottraconet={totalMunicipio.nottraconet} diff={totalMunicipio.diff} colSpan={3} />
            </tbody>
          </table>
          {!mostrarTodosMunicipios && filteredMunicipalityRows.length > visibleMunicipalityRows.length && (
            <div className="border-t p-3 text-center">
              <Button size="sm" variant="outline" onClick={() => setMostrarTodosMunicipios(true)}>
                Mostrar todos os {filteredMunicipalityRows.length.toLocaleString("pt-BR")} registros
              </Button>
            </div>
          )}
          </div>
        )}

      </CardContent>
    </Card>
  );
}

function sumRows(rows: Array<{ traconet: number; nottraconet: number }>) {
  const traconet = rows.reduce((sum, row) => sum + Number(row.traconet ?? 0), 0);
  const nottraconet = rows.reduce((sum, row) => sum + Number(row.nottraconet ?? 0), 0);
  return { traconet, nottraconet, diff: nottraconet - traconet };
}

function TotalRow({ label, traconet, nottraconet, diff, colSpan }: {
  label: string;
  traconet: number;
  nottraconet: number;
  diff: number;
  colSpan: number;
}) {
  return (
    <tr className="border-t-2 bg-muted/50 font-semibold">
      <td className="px-4 py-2" colSpan={colSpan}>{label}</td>
      <td className="px-4 py-2 text-right tabular-nums">{traconet.toLocaleString("pt-BR")}</td>
      <td className="px-4 py-2 text-right tabular-nums">{nottraconet.toLocaleString("pt-BR")}</td>
      <DiffCell diff={diff} />
      <td className="px-4 py-2 text-center text-xs text-muted-foreground">-</td>
    </tr>
  );
}

const FIELD_LABELS: Record<string, string> = {
  source_bank: "Banco (TRACONET/NOTTRACONET)",
  agravo: "Agravo",
  ano: "Ano",
  dt_notificacao: "Data de notificação",
  municipio: "Município",
  ibge: "Código IBGE",
  gve: "GVE",
  drs: "DRS",
  unidade: "Unidade notificadora",
  classificacao: "Classificação (TF/TT)",
  criterio: "Critério diagnóstico",
  evolucao: "Evolução",
  tratamento: "Tratamento",
  conclusao: "Conclusão/encerramento"
};

const CHART_COLORS = ["#0f766e", "#dc2626", "#2563eb", "#d97706", "#64748b"];

function statusText(count: number, clinicalMappingMissing = false) {
  if (clinicalMappingMissing) return "Revisar mapeamento";
  if (count === 0) return "Sem pendencia";
  if (count >= 100) return "Prioridade alta";
  if (count >= 10) return "Prioridade media";
  return "Verificar";
}

function QualityCommandCenter({
  data,
  clinicalMappingMissing,
  criticalCount,
  highRisk
}: {
  data: SinanAuditResult;
  clinicalMappingMissing: boolean;
  criticalCount: number;
  highRisk: number;
}) {
  const yearChartData = [...(data.divergencesByYear ?? [])]
    .sort((a, b) => a.ano - b.ano)
    .map((row) => ({
      ano: String(row.ano),
      individuais: row.traconet,
      consolidados: row.nottraconet
    }));

  const topGveData = [...(data.divergencesByGve ?? [])]
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 8)
    .map((row) => ({
      gve: row.gve || "Nao informado",
      diferenca: Math.abs(row.diff),
      sinal: row.diff
    }));

  const completenessValues = Object.values(data.fieldCompleteness);
  const avgCompleteness = completenessValues.length
    ? Math.round(completenessValues.reduce((sum, stat) => sum + stat.pct, 0) / completenessValues.length)
    : 0;

  const lowCompleteness = Object.entries(data.fieldCompleteness)
    .map(([field, stat]) => ({
      campo: FIELD_LABELS[field] ?? field,
      pct: stat.pct
    }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 8);

  const priorityItems = [
    {
      label: clinicalMappingMissing ? "Forma clinica nao mapeada" : "Sem forma clinica",
      count: data.semGraduacao,
      tone: clinicalMappingMissing ? "amber" : data.semGraduacao > 0 ? "red" : "green",
      detail: clinicalMappingMissing ? "Mapear colunas TF/TI/TS/TT/CO antes de tratar como erro." : "Revisar classificacao clinica no TRACONET."
    },
    {
      label: "Divergencias de alto risco",
      count: highRisk,
      tone: highRisk > 0 ? "red" : "green",
      detail: "Municipio/ano com diferenca relevante entre individual e consolidado."
    },
    {
      label: "TF sem tratamento",
      count: data.tfSemTratamento,
      tone: data.tfSemTratamento > 0 ? "red" : "green",
      detail: "TF ativo exige registro de tratamento."
    },
    {
      label: "TT sem cirurgia",
      count: data.ttSemCircurgia,
      tone: data.ttSemCircurgia > 0 ? "red" : "green",
      detail: "TT deve ter encaminhamento ou referencia registrada."
    },
    {
      label: "Sem conclusao",
      count: data.semConclusao,
      tone: data.semConclusao > 0 ? "amber" : "green",
      detail: "Encerrar investigacoes pendentes."
    },
    {
      label: "IDs duplicados",
      count: data.duplicateNotificationIds?.length ?? 0,
      tone: (data.duplicateNotificationIds?.length ?? 0) > 0 ? "red" : "green",
      detail: "NU_NOTIFIC repetido sugere duplicidade."
    }
  ].sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prioridades de Correcao</CardTitle>
            <p className="text-xs text-muted-foreground">O que merece revisao primeiro na base importada.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {priorityItems.slice(0, 5).map((item) => (
              <div key={item.label} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
                </div>
                <div className="text-right">
                  <div className={`text-xl font-semibold tabular-nums ${
                    item.tone === "red" ? "text-red-700" : item.tone === "amber" ? "text-amber-700" : "text-green-700"
                  }`}>
                    {item.count.toLocaleString("pt-BR")}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{statusText(item.count, item.label.includes("mapeada"))}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Serie Anual: Individual x Consolidado</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yearChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="ano" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={48} />
                  <Tooltip formatter={(value) => Number(value).toLocaleString("pt-BR")} />
                  <Line type="monotone" dataKey="individuais" name="TRACONET" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="consolidados" name="Consolidado" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Top GVE com Divergencia</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topGveData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis type="category" dataKey="gve" tickLine={false} axisLine={false} fontSize={11} width={112} />
                  <Tooltip formatter={(value) => Number(value).toLocaleString("pt-BR")} />
                  <Bar dataKey="diferenca" name="Diferenca absoluta" radius={[0, 4, 4, 0]}>
                    {topGveData.map((row, index) => (
                      <Cell key={`${row.gve}-${index}`} fill={row.sinal > 0 ? CHART_COLORS[1] : CHART_COLORS[3]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className={criticalCount > 0 ? "border-amber-300" : "border-green-200"}>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Alertas acionaveis</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{criticalCount.toLocaleString("pt-BR")}</div>
          </CardContent>
        </Card>
        <Card className={highRisk > 0 ? "border-red-300" : "border-green-200"}>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Alto risco banco x banco</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{highRisk.toLocaleString("pt-BR")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Completude media</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{avgCompleteness.toLocaleString("pt-BR")}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Casos positivos consolidados</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{data.totalNottraconet.toLocaleString("pt-BR")}</div>
          </CardContent>
        </Card>
      </div>

      {lowCompleteness.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Campos com Menor Completude</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lowCompleteness} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} />
                <YAxis type="category" dataKey="campo" tickLine={false} axisLine={false} fontSize={11} width={150} />
                <Tooltip formatter={(value) => `${Number(value).toLocaleString("pt-BR")}%`} />
                <Bar dataKey="pct" name="% preenchido" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TechnicalDetailsPanel({ data }: { data: SinanAuditResult }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Detalhes Tecnicos da Importacao</CardTitle>
        <p className="text-xs text-muted-foreground">
          Mapeamento, colunas originais e indicadores agregados ficam recolhidos aqui para auditoria tecnica.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Bancos, colunas e campos reconhecidos</summary>
          {data.diagnostico && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {(["traconet", "nottraconet"] as const).map((banco) => {
                const d = data.diagnostico[banco];
                const label = banco === "traconet" ? "TRACONET - Casos Individuais" : "NOTTRACONET - Consolidado";
                const count = banco === "traconet" ? data.totalTraconet : data.totalNottraconetRows;
                return (
                  <div key={banco} className="rounded-md border bg-muted/20 p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-semibold">{label}</span>
                      <span className="rounded-full bg-background px-2 py-0.5 font-medium">{count.toLocaleString("pt-BR")} registros</span>
                    </div>
                    <p><span className="font-medium">Municipios:</span> {d.municipiosAmostra.join(", ") || "sem amostra"}</p>
                    <p><span className="font-medium">Anos:</span> {d.anosAmostra.join(", ") || "sem amostra"}</p>
                    <p><span className="font-medium">Campos reconhecidos:</span> {d.camposPreenchidos.join(", ") || "nenhum"}</p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground">Colunas originais</summary>
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{d.colunas.join(", ")}</p>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </details>

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Mapeamento do consolidado</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">Campo usado para positivos</div>
              <div className="font-medium">{data.consolidatedPositiveField ?? "nao identificado"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Casos positivos consolidados</div>
              <div className="font-medium tabular-nums">{data.totalNottraconet.toLocaleString("pt-BR")}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Linhas sem positivo mapeado</div>
              <div className={`font-medium tabular-nums ${data.consolidatedRowsWithoutPositiveField > 0 ? "text-red-700" : "text-green-700"}`}>
                {data.consolidatedRowsWithoutPositiveField.toLocaleString("pt-BR")}
              </div>
            </div>
          </div>
        </details>

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Indicadores agregados do consolidado</summary>
          <div className="mt-3">
            <ConsolidatedMetricsPanel data={data} />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

export function SinanQualidadeView() {
  const [municipio, setMunicipio] = useState("");
  const [gve,       setGve]       = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd,   setYearEnd]   = useState("");
  const [filters,   setFilters]   = useState<Record<string, string>>({});

  const { data, error, isLoading, isFetching, refetch } = useQuery<SinanAuditResult, ApiError>({
    queryKey: ["sinan-auditoria", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.municipio)  params.set("municipio",  filters.municipio);
      if (filters.gve)        params.set("gve",        filters.gve);
      if (filters.yearStart)  params.set("yearStart",  filters.yearStart);
      if (filters.yearEnd)    params.set("yearEnd",    filters.yearEnd);
      const res = await fetch(`/api/sinan/auditoria?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as ApiError;
        throw body;
      }
      return res.json() as Promise<SinanAuditResult>;
    },
    retry: false
  });

  const apiError = error as ApiError | null;

  function applyFilters() {
    setFilters({ municipio, gve, yearStart, yearEnd });
  }

  const hasImportedData = Boolean(data && (data.totalTraconet > 0 || data.totalNottraconetRows > 0));
  const highRisk     = data?.crossBankDivergences.filter((d) => d.risco === "alto").length ?? 0;
  const clinicalMappingMissing = Boolean(
    data &&
    data.totalTraconet > 0 &&
    data.totalTraconetPositive === 0 &&
    data.semGraduacao === data.totalTraconet
  );
  const criticalCount =
    (data?.tfSemTratamento ?? 0) +
    (data?.ttSemCircurgia ?? 0) +
    (data?.semTratamento ?? 0) +
    (data?.semConclusao ?? 0) +
    (data?.anoImpossivel ?? 0) +
    (data?.missingNotificationId ?? 0) +
    (data?.duplicateNotificationIds?.length ?? 0) +
    (clinicalMappingMissing ? 0 : data?.semGraduacao ?? 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Qualidade SINAN Tracoma</h1>
            <p className="text-sm text-muted-foreground">
              Auditoria automática — divergências, campos vazios e inconsistências
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 rounded-lg border bg-card/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Município</label>
          <input
            value={municipio}
            onChange={(e) => setMunicipio(e.target.value)}
            placeholder="Ex.: Araçatuba"
            className="h-8 w-44 rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">GVE</label>
          <input
            value={gve}
            onChange={(e) => setGve(e.target.value)}
            placeholder="Ex.: Osasco"
            className="h-8 w-36 rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Ano início</label>
          <input
            value={yearStart}
            onChange={(e) => setYearStart(e.target.value)}
            placeholder="2020"
            type="number"
            className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Ano fim</label>
          <input
            value={yearEnd}
            onChange={(e) => setYearEnd(e.target.value)}
            placeholder="2026"
            type="number"
            className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <Button size="sm" onClick={applyFilters} disabled={isFetching}>
          Filtrar
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

      {/* Estado de carregamento */}
      {isLoading && (
        <div className="flex h-48 items-center justify-center gap-3 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Analisando dados SINAN...</span>
        </div>
      )}

      {/* Erro: tabela ausente */}
      {apiError?.error === "tabela_ausente" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-2">
              <p className="font-semibold text-amber-900">Migration não aplicada</p>
              <p className="text-sm text-amber-800">
                A tabela <code className="rounded bg-amber-100 px-1">sinan_tracoma_rows</code> ainda não existe no Supabase.
                Execute o SQL da migration e depois importe os dados em{" "}
                <a href="/sincronizacao" className="underline font-medium">Sincronização</a>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Erro genérico */}
      {apiError && apiError.error !== "tabela_ausente" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Erro ao carregar auditoria: {apiError.message ?? apiError.error}
        </div>
      )}

      {/* Sem dados */}
      {!isLoading && !apiError && data && !hasImportedData && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border bg-card text-muted-foreground">
          <Database className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum registro SINAN importado ainda.</p>
          <a href="/sincronizacao" className="text-sm underline text-primary">Ir para Sincronização</a>
        </div>
      )}

      {data && hasImportedData && (
        <>
          {/* Aviso de inversão de bancos */}
          {data.diagnostico?.aviso && (
            <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4">
              <div className="flex gap-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div className="space-y-2">
                  <p className="font-bold text-red-900">Bancos importados invertidos!</p>
                  <p className="text-sm text-red-800">{data.diagnostico.aviso}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-red-700">Ver SQL para corrigir no Supabase ▼</summary>
                    <pre className="mt-2 overflow-x-auto rounded bg-red-100 p-3 text-xs font-mono text-red-900">{`-- Cole no Supabase SQL Editor para trocar os labels:
UPDATE public.sinan_tracoma_rows
SET source_bank = CASE
  WHEN source_bank = 'traconet'    THEN 'nottraconet'
  WHEN source_bank = 'nottraconet' THEN 'traconet'
END;

UPDATE public.sinan_tracoma_import_log
SET source_bank = CASE
  WHEN source_bank = 'traconet'    THEN 'nottraconet'
  WHEN source_bank = 'nottraconet' THEN 'traconet'
END;`}</pre>
                  </details>
                </div>
              </div>
            </div>
          )}

          {/* Painel de diagnóstico — o que tem em cada banco */}
          {false && data!.diagnostico && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(["traconet", "nottraconet"] as const).map((banco) => {
                const d = data!.diagnostico[banco];
                const label = banco === "traconet" ? "TRACONET — Casos Individuais" : "NOTTRACONET — Consolidado";
                const count = banco === "traconet" ? data!.totalTraconet : data!.totalNottraconetRows;
                return (
                  <div key={banco} className="rounded-lg border bg-card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{label}</p>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {count.toLocaleString("pt-BR")} registros
                      </span>
                    </div>
                    {d.municipiosAmostra.length > 0 ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Municípios:</span> {d.municipiosAmostra.join(", ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Anos:</span> {d.anosAmostra.join(", ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Campos normalizados preenchidos:</span>{" "}
                          {d.camposPreenchidos.length > 0 ? d.camposPreenchidos.join(", ") : "nenhum"}
                        </p>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            Colunas do arquivo original ▼
                          </summary>
                          <p className="mt-1 text-xs font-mono text-muted-foreground break-all">
                            {d.colunas.join(", ")}
                          </p>
                        </details>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Sem dados importados neste banco.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Card className={`hidden ${!data.consolidatedPositiveField && data.totalNottraconet === 0 ? "border-red-300 bg-red-50" : ""}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Mapeamento do Consolidado (NOTTRACONET/NTRACOMA)</CardTitle>
              <p className="text-xs text-muted-foreground">
                O consolidado nao e contado por linha. A comparacao usa a soma da variavel de casos positivos.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Campo usado para positivos</div>
                <div className="font-medium">{data.consolidatedPositiveField ?? "nao identificado"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Casos positivos consolidados</div>
                <div className="font-medium tabular-nums">{data.totalNottraconet.toLocaleString("pt-BR")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Linhas sem positivo mapeado</div>
                <div className={`font-medium tabular-nums ${data.consolidatedRowsWithoutPositiveField > 0 ? "text-red-700" : "text-green-700"}`}>
                  {data.consolidatedRowsWithoutPositiveField.toLocaleString("pt-BR")}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="hidden">
            <ConsolidatedMetricsPanel data={data} />
          </div>

          {/* Cards de resumo */}
          <QualityCommandCenter
            data={data}
            clinicalMappingMissing={clinicalMappingMissing}
            criticalCount={criticalCount}
            highRisk={highRisk}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-muted-foreground mb-1">TRACONET importado</div>
                <div className="text-3xl font-bold tabular-nums">{data.totalTraconet.toLocaleString("pt-BR")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Casos individuais comparáveis: {data.totalTraconetComparable.toLocaleString("pt-BR")}. Formas clínicas positivas mapeadas: {data.totalTraconetPositive.toLocaleString("pt-BR")}. Anos inválidos: {data.totalTraconetInvalidYear.toLocaleString("pt-BR")}.
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-muted-foreground mb-1">NOTTRACONET/NTRACOMA importado</div>
                <div className="text-3xl font-bold tabular-nums">{data.totalNottraconetRows.toLocaleString("pt-BR")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Positivos consolidados: {data.totalNottraconet.toLocaleString("pt-BR")}. Anos inválidos: {data.totalNottraconetInvalidYear.toLocaleString("pt-BR")}.
                </div>
              </CardContent>
            </Card>
            <Card className={highRisk > 0 ? "border-red-300" : ""}>
              <CardContent className="pt-5">
                <div className="text-xs text-muted-foreground mb-1">Divergências de alto risco</div>
                <div className={`text-3xl font-bold tabular-nums ${highRisk > 0 ? "text-red-700" : "text-green-700"}`}>
                  {highRisk}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Total de divergências: {data.crossBankDivergences.length}
                </div>
              </CardContent>
            </Card>
            <Card className={criticalCount > 0 ? "border-amber-300" : ""}>
              <CardContent className="pt-5">
                <div className="text-xs text-muted-foreground mb-1">Alertas críticos de qualidade</div>
                <div className={`text-3xl font-bold tabular-nums ${criticalCount > 0 ? "text-amber-700" : "text-green-700"}`}>
                  {criticalCount.toLocaleString("pt-BR")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Soma de pendencias de preenchimento, duplicidade e encerramento
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Alertas de qualidade — baseados nos casos individuais TRACONET */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Alertas de Qualidade — Casos Individuais (TRACONET)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Verificações clínicas aplicadas aos registros individuais. O NOTTRACONET (consolidado) não possui esses campos.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <AlertCard
                count={data.semGraduacao}
                label={clinicalMappingMissing ? "forma clínica não mapeada" : "sem forma clínica (TF/TI/TS/TT/CO)"}
                severity={clinicalMappingMissing ? "warning" : data.semGraduacao > 0 ? "critical" : "ok"}
                detail={clinicalMappingMissing ? "Campo clínico não identificado no import; revisar nomes das colunas do TRACONET." : "Casos individuais sem graduação clínica preenchida — campo essencial para definir conduta"}
              />
              <AlertCard
                count={data.tfSemTratamento}
                label="TF confirmado sem tratamento"
                severity={data.tfSemTratamento > 0 ? "critical" : "ok"}
                detail="TF ativo exige azitromicina — ausência de tratamento registrado é inconsistência grave"
              />
              <AlertCard
                count={data.ttSemCircurgia}
                label="TT sem encaminhamento p/ cirurgia"
                severity={data.ttSemCircurgia > 0 ? "critical" : "ok"}
                detail="TT (triquíase tracomatosa) requer referência oftalmológica — risco de progressão para cegueira"
              />
              <AlertCard
                count={data.semTratamento}
                label="sem tratamento registrado"
                severity={data.semTratamento > 0 ? "warning" : "ok"}
                detail="Campo tratamento vazio — verificar se azitromicina ou outra conduta foi omitida"
              />
              <AlertCard
                count={data.semConclusao}
                label="sem conclusão/encerramento"
                severity={data.semConclusao > 0 ? "warning" : "ok"}
                detail="Investigações sem encerramento dificultam o cálculo de prevalência real"
              />
              <AlertCard
                count={data.anoImpossivel}
                label="com ano impossível"
                severity={data.anoImpossivel > 0 ? "warning" : "ok"}
                detail="Ano anterior a 1975 ou maior que o ano atual — erro de digitação na fonte"
              />
            </CardContent>
          </Card>

          {/* Sem Forma Clínica: onde corrigir */}
          {clinicalMappingMissing ? (
            <ClinicalMappingNotice data={data} />
          ) : (data.semFormaClinicaDetalhe?.length ?? 0) > 0 && (
            <SemFormaClinicaPanel data={data} />
          )}

          <NotificationIdPanel data={data} />

          {/* Divergências entre bancos — 3 abas */}
          {(data.crossBankDivergences.length > 0 || data.divergencesByYear?.length > 0) && (
            <DivergenciasPanel data={data} />
          )}

          {/* Completude de campos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Completude dos Campos — Casos Individuais (TRACONET)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Percentual de registros individuais com o campo preenchido. Abaixo de 70% = crítico.
                O NOTTRACONET (consolidado) possui estrutura diferente (nº examinados/positivos) e não é avaliado aqui.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {Object.entries(data.fieldCompleteness).map(([field, stat]) => (
                <PctBar
                  key={field}
                  label={FIELD_LABELS[field] ?? field}
                  pct={stat.pct}
                />
              ))}
            </CardContent>
          </Card>

          {/* Recomendações */}
          {data.recommendations.length > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-primary">Recomendações Prioritárias</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {data.recommendations.map((rec, i) => (
                    <li key={i} className="flex gap-3 text-sm">
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

          <TechnicalDetailsPanel data={data} />
        </>
      )}
    </div>
  );
}
