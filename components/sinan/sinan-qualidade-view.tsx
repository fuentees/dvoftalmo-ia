"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, ClipboardList,
  Database, RefreshCw, XCircle, Activity,
  MapPin, Stethoscope, BarChart2
} from "lucide-react";
import { useState } from "react";
import {
  CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
  Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

// ── Aba: Divergências ─────────────────────────────────────────────────────────

type DivTab = "ano" | "gve" | "municipio";

function DivergenciasTab({ data }: { data: SinanAuditResult }) {
  const [tab, setTab] = useState<DivTab>("ano");
  const [busca, setBusca] = useState("");
  const [mostrarTodos, setMostrarTodos] = useState(false);

  const normalizedBusca = busca.trim().toLowerCase();
  const allMuni = data.comparisonsByMunicipalityYear?.length
    ? data.comparisonsByMunicipalityYear
    : data.crossBankDivergences;
  const filteredMuni = normalizedBusca
    ? allMuni.filter((d) =>
        `${d.municipio} ${d.municipioNome} ${d.gve} ${d.ano}`.toLowerCase().includes(normalizedBusca)
      )
    : allMuni;
  const visibleMuni = mostrarTodos ? filteredMuni : filteredMuni.slice(0, 50);

  const totalYear = sumRows(data.divergencesByYear ?? []);
  const totalGve  = sumRows(data.divergencesByGve ?? []);
  const totalMuni = sumRows(filteredMuni);

  const tabs: { id: DivTab; label: string; count: number }[] = [
    { id: "ano",       label: "Por Ano",       count: (data.divergencesByYear ?? []).length },
    { id: "gve",       label: "Por GVE",       count: (data.divergencesByGve ?? []).length },
    { id: "municipio", label: "Por Município",  count: allMuni.length }
  ];

  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

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
        <div className="flex gap-0 border-b bg-muted/20">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? "border-primary text-primary bg-background"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                tab === t.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>{t.count.toLocaleString("pt-BR")}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {tab === "ano" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className={thCls}>Ano</th>
                  <th className={`${thCls} text-right`}>Individuais (TRACONET)</th>
                  <th className={`${thCls} text-right`}>Positivos (NOTTRACONET)</th>
                  <th className={`${thCls} text-right`}>Diferença</th>
                  <th className={`${thCls} text-center`}>Risco</th>
                </tr>
              </thead>
              <tbody>
                {(data.divergencesByYear ?? []).map((d) => (
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

          {tab === "gve" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className={thCls}>GVE</th>
                  <th className={`${thCls} text-right`}>Individuais (TRACONET)</th>
                  <th className={`${thCls} text-right`}>Positivos (NOTTRACONET)</th>
                  <th className={`${thCls} text-right`}>Diferença</th>
                  <th className={`${thCls} text-center`}>Risco</th>
                </tr>
              </thead>
              <tbody>
                {(data.divergencesByGve ?? []).map((d, i) => (
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

          {tab === "municipio" && (
            <div>
              <div className="flex flex-wrap items-center gap-3 border-b bg-muted/10 px-4 py-3">
                <input
                  value={busca}
                  onChange={(e) => { setBusca(e.target.value); setMostrarTodos(false); }}
                  placeholder="Filtrar por município, GVE ou ano…"
                  className="h-8 min-w-60 flex-1 rounded-md border bg-background px-3 text-sm"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {visibleMuni.length.toLocaleString("pt-BR")} de {filteredMuni.length.toLocaleString("pt-BR")} registros
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className={thCls}>Município</th>
                    <th className={thCls}>GVE</th>
                    <th className={`${thCls} text-right`}>Ano</th>
                    <th className={`${thCls} text-right`}>Individuais</th>
                    <th className={`${thCls} text-right`}>Positivos</th>
                    <th className={`${thCls} text-right`}>Diferença</th>
                    <th className={`${thCls} text-center`}>Risco</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMuni.map((d, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium">
                        {d.municipioNome !== d.municipio ? d.municipioNome : d.municipio}
                        {d.municipioNome !== d.municipio && (
                          <span className="ml-1 text-[10px] text-muted-foreground">({d.municipio})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.gve || "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{d.ano}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{d.traconet.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{d.nottraconet.toLocaleString("pt-BR")}</td>
                      <DiffCell diff={d.diff} />
                      <RiscoCell risco={d.risco} />
                    </tr>
                  ))}
                  <TotalRow
                    label={busca ? "Total filtrado" : "Total"}
                    traconet={totalMuni.traconet}
                    nottraconet={totalMuni.nottraconet}
                    diff={totalMuni.diff}
                    colSpan={3}
                  />
                </tbody>
              </table>
              {!mostrarTodos && filteredMuni.length > visibleMuni.length && (
                <div className="border-t p-3 text-center">
                  <Button size="sm" variant="outline" onClick={() => setMostrarTodos(true)}>
                    Mostrar todos os {filteredMuni.length.toLocaleString("pt-BR")} registros
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Aba: Qualidade Clínica ────────────────────────────────────────────────────

type QualTab = "sem_forma" | "alertas";

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
  const [tab, setTab] = useState<QualTab>("sem_forma");

  const detalhe = data.semFormaClinicaDetalhe ?? [];
  const gveMap = new Map<string, number>();
  for (const d of detalhe) gveMap.set(d.gve, (gveMap.get(d.gve) ?? 0) + d.count);
  const byGve = Array.from(gveMap.entries()).map(([gve, count]) => ({ gve, count })).sort((a, b) => b.count - a.count);
  const maxMuni = Math.max(...detalhe.map((d) => d.count), 1);
  const maxGve  = Math.max(...byGve.map((d) => d.count), 1);

  type SFSubTab = "gve" | "municipio";
  const [sfTab, setSfTab] = useState<SFSubTab>("gve");

  const alertas = [
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
      label: "Sem tratamento registrado (geral)",
      detail: "Campo tratamento vazio — verificar se azitromicina ou outra conduta foi omitida no registro."
    },
    {
      count: data.semConclusao, tone: data.semConclusao > 0 ? "amber" : "green",
      label: "Sem conclusão / encerramento",
      detail: "Investigações sem encerramento dificultam o cálculo de prevalência real e o acompanhamento dos casos."
    },
    {
      count: data.anoImpossivel, tone: data.anoImpossivel > 0 ? "amber" : "green",
      label: "Ano impossível (< 1975 ou > ano atual)",
      detail: "Erro de digitação na data de notificação. Corrigir na fonte antes de analisar a série histórica."
    },
    {
      count: data.duplicateNotificationIds?.length ?? 0,
      tone: (data.duplicateNotificationIds?.length ?? 0) > 0 ? "red" : "green",
      label: "NU_NOTIFIC duplicado",
      detail: "O mesmo identificador de notificação aparece em mais de uma linha. Pode indicar duplicidade de importação."
    }
  ];

  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="flex gap-0 rounded-lg border overflow-hidden">
        {([
          { id: "sem_forma" as QualTab, label: "Sem Forma Clínica", count: data.semGraduacao },
          { id: "alertas"   as QualTab, label: "Alertas Clínicos",  count: alertas.reduce((s, a) => s + a.count, 0) }
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 px-6 py-3 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
              tab === t.id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-foreground"
            }`}>{t.count.toLocaleString("pt-BR")}</span>
          </button>
        ))}
      </div>

      {tab === "sem_forma" && (
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {clinicalMappingMissing
                    ? "Forma Clínica Não Mapeada — Revisar Importação"
                    : "Casos Sem Forma Clínica — Onde Corrigir"}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {clinicalMappingMissing
                    ? "O TRACONET foi importado, mas os campos TF/TI/TS/TT/CO não foram identificados nas colunas do arquivo. Verifique o mapeamento antes de tratar como erro de preenchimento."
                    : "Casos individuais (TRACONET) sem graduação clínica TF/TI/TS/TT/CO. Agrupados por GVE e município para direcionar a correção na fonte."}
                </p>
              </div>
              {clinicalMappingMissing && (
                <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                  Revisar mapeamento
                </span>
              )}
            </div>
            {!clinicalMappingMissing && detalhe.length > 0 && (
              <div className="mt-4 flex gap-0 border-b">
                {(["gve", "municipio"] as SFSubTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setSfTab(t)}
                    className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                      sfTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "gve" ? "Por GVE" : "Por Município"}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {clinicalMappingMissing ? (
              <div className="px-6 py-4 space-y-2 text-sm">
                <div className="flex gap-8">
                  <div>
                    <div className="text-xs text-muted-foreground">Casos importados</div>
                    <div className="text-xl font-semibold tabular-nums">{data.totalTraconet.toLocaleString("pt-BR")}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Formas clínicas mapeadas</div>
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
            ) : sfTab === "gve" ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className={thCls}>GVE</th>
                    <th className={`${thCls} text-right`}>Casos s/ forma clínica</th>
                    <th className={`${thCls} w-48`}>Proporção</th>
                  </tr>
                </thead>
                <tbody>
                  {byGve.map((d) => (
                    <tr key={d.gve} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{d.gve}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">
                        {d.count.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-amber-400"
                            style={{ width: `${Math.round((d.count / maxGve) * 100)}%` }} />
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
                    <th className={thCls}>Município</th>
                    <th className={thCls}>GVE</th>
                    <th className={`${thCls} text-right`}>Casos s/ forma clínica</th>
                    <th className={`${thCls} w-40`}>Proporção</th>
                  </tr>
                </thead>
                <tbody>
                  {detalhe.map((d, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium">
                        {d.municipioNome !== d.municipio ? d.municipioNome : d.municipio}
                        {d.municipioNome !== d.municipio && (
                          <span className="ml-1 text-[10px] text-muted-foreground">({d.municipio})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{d.gve}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">
                        {d.count.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-amber-400"
                            style={{ width: `${Math.round((d.count / maxMuni) * 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "alertas" && (
        <div className="grid gap-3 sm:grid-cols-2">
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
              <div key={a.label} className={`flex items-start gap-3 rounded-lg border p-4 ${border}`}>
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-2xl font-bold tabular-nums ${numColor}`}>
                      {a.count.toLocaleString("pt-BR")}
                    </span>
                    <span className="text-sm font-medium">{a.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{a.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Aba: Completude & Técnico ─────────────────────────────────────────────────

function CompletudeTecnicoTab({ data }: { data: SinanAuditResult }) {
  const thCls = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="space-y-6">
      {/* Completude dos campos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Completude dos Campos — TRACONET (Casos Individuais)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Percentual de registros com o campo preenchido. Abaixo de 70% indica problema de mapeamento ou subnotificação.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {Object.entries(data.fieldCompleteness).map(([field, stat]) => (
            <PctBar key={field} label={FIELD_LABELS[field] ?? field} pct={stat.pct} />
          ))}
        </CardContent>
      </Card>

      {/* Diagnóstico dos bancos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Diagnóstico de Importação</CardTitle>
          <p className="text-xs text-muted-foreground">
            Campos detectados, municípios e anos presentes em cada banco.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["traconet", "nottraconet"] as const).map((banco) => {
              const d = data.diagnostico[banco];
              const count = banco === "traconet" ? data.totalTraconet : data.totalNottraconetRows;
              return (
                <div key={banco} className="rounded-lg border bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">
                      {banco === "traconet" ? "TRACONET — Casos Individuais" : "NOTTRACONET — Consolidado"}
                    </span>
                    <span className="rounded-full bg-background border px-2 py-0.5 text-xs font-medium tabular-nums">
                      {count.toLocaleString("pt-BR")} linhas
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p><span className="font-medium text-foreground">Municípios:</span> {d.municipiosAmostra.join(", ") || "sem amostra"}</p>
                    <p><span className="font-medium text-foreground">Anos:</span> {d.anosAmostra.join(", ") || "sem amostra"}</p>
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
                    <details className="mt-1" open={banco === "nottraconet"}>
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Campos numéricos com exemplo ({d.camposNumericos.length})
                      </summary>
                      <div className="mt-2 max-h-44 overflow-auto rounded-md border bg-background">
                        <table className="w-full text-[11px]">
                          <tbody>
                            {d.camposNumericos.map((item) => (
                              <tr key={item.campo} className="border-b last:border-0">
                                <td className="px-2 py-1 font-mono">{item.campo}</td>
                                <td className="px-2 py-1 text-right tabular-nums">
                                  {item.exemplo.toLocaleString("pt-BR")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* IDs duplicados — só exibe se houver */}
      {(data.duplicateNotificationIds?.length ?? 0) > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-700">
              NU_NOTIFIC Duplicado — {data.duplicateNotificationIds.length.toLocaleString("pt-BR")} ocorrências
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              O mesmo identificador de notificação aparece em mais de uma linha do TRACONET.
              Pode indicar importação duplicada ou inconsistência na numeração.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className={thCls}>ID notificação</th>
                  <th className={thCls}>Município</th>
                  <th className={`${thCls} text-right`}>Ano</th>
                  <th className={`${thCls} text-right`}>Repetições</th>
                </tr>
              </thead>
              <tbody>
                {data.duplicateNotificationIds.slice(0, 30).map((item) => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs">{item.id}</td>
                    <td className="px-4 py-2.5">{item.municipio}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{item.ano || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-red-700">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Recomendações */}
      {data.recommendations.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-primary">Recomendações Prioritárias</CardTitle>
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
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

type PageTab = "divergencias" | "qualidade" | "completude";

export function SinanQualidadeView() {
  const [municipio, setMunicipio] = useState("");
  const [gve,       setGve]       = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd,   setYearEnd]   = useState("");
  const [filters,   setFilters]   = useState<Record<string, string>>({});
  const [pageTab,   setPageTab]   = useState<PageTab>("divergencias");

  const { data, error, isLoading, isFetching, refetch } = useQuery<SinanAuditResult, ApiError>({
    queryKey: ["sinan-auditoria", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.municipio) params.set("municipio", filters.municipio);
      if (filters.gve)       params.set("gve",       filters.gve);
      if (filters.yearStart) params.set("yearStart", filters.yearStart);
      if (filters.yearEnd)   params.set("yearEnd",   filters.yearEnd);
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
    (data?.semConclusao ?? 0) +
    (data?.duplicateNotificationIds?.length ?? 0) +
    (clinicalMappingMissing ? 0 : data?.semGraduacao ?? 0);

  const yearChartData = [...(data?.divergencesByYear ?? [])]
    .sort((a, b) => a.ano - b.ano)
    .map((r) => ({ ano: String(r.ano), individuais: r.traconet, positivos: r.nottraconet }));

  const pageTabs: { id: PageTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "divergencias", label: "Divergências",    icon: <Activity className="h-4 w-4" />,   badge: data?.crossBankDivergences.length },
    { id: "qualidade",    label: "Qualidade Clínica", icon: <Stethoscope className="h-4 w-4" />, badge: alertasCount + (data?.semGraduacao ?? 0) },
    { id: "completude",   label: "Completude & Técnico", icon: <BarChart2 className="h-4 w-4" /> }
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
            <h1 className="text-xl font-semibold">Qualidade SINAN — Tracoma</h1>
            <p className="text-sm text-muted-foreground">
              Auditoria automática: divergências entre bancos, completude clínica e consistência dos dados
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 rounded-xl border bg-card/95 px-5 py-4 shadow-sm backdrop-blur">
        {[
          { label: "Município",  value: municipio, set: setMunicipio, placeholder: "Ex.: Araçatuba",   w: "w-44" },
          { label: "GVE",        value: gve,       set: setGve,       placeholder: "Ex.: Osasco",       w: "w-36" },
          { label: "Ano início", value: yearStart, set: setYearStart, placeholder: "2018",              w: "w-24", type: "number" },
          { label: "Ano fim",    value: yearEnd,   set: setYearEnd,   placeholder: "2026",              w: "w-24", type: "number" }
        ].map((f) => (
          <div key={f.label} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
            <input
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
              type={f.type ?? "text"}
              className={`h-8 ${f.w} rounded-md border bg-background px-2.5 text-sm`}
            />
          </div>
        ))}
        <Button size="sm" onClick={() => setFilters({ municipio, gve, yearStart, yearEnd })} disabled={isFetching}>
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

          {/* ── KPIs ─────────────────────────────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Casos individuais (TRACONET)"
              value={data.totalTraconet}
              sub={`${(data.totalTraconetComparable ?? data.totalTraconet).toLocaleString("pt-BR")} com ano válido`}
              icon={<Database className="h-4 w-4" />}
            />
            <KpiCard
              label="Positivos consolidados (NOTTRACONET)"
              value={data.totalNottraconet}
              sub={`${(data.totalNottraconetRows ?? 0).toLocaleString("pt-BR")} linhas no consolidado`}
              icon={<MapPin className="h-4 w-4" />}
            />
            <KpiCard
              label="Divergências de alto risco"
              value={highRisk}
              sub={`${data.crossBankDivergences.length} município/ano com diferença`}
              tone={highRisk > 0 ? "red" : "green"}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <KpiCard
              label="Alertas clínicos"
              value={alertasCount}
              sub="TF s/tratamento + TT s/cirurgia + duplicidades"
              tone={alertasCount > 0 ? "amber" : "green"}
              icon={<Stethoscope className="h-4 w-4" />}
            />
          </div>

          {/* ── Gráfico temporal ─────────────────────────────────────────────── */}
          {yearChartData.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Série Histórica: Casos Individuais × Positivos Consolidados</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={yearChartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                    <XAxis dataKey="ano" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={48} />
                    <Tooltip
                      formatter={(v) => Number(v).toLocaleString("pt-BR")}
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="individuais" name="TRACONET" stroke="#0f766e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="positivos"   name="NOTTRACONET" stroke="#dc2626" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ── Abas principais ──────────────────────────────────────────────── */}
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
              {pageTab === "divergencias" && <DivergenciasTab data={data} />}
              {pageTab === "qualidade"    && <QualidadeClinicaTab data={data} clinicalMappingMissing={clinicalMappingMissing} />}
              {pageTab === "completude"   && <CompletudeTecnicoTab data={data} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
