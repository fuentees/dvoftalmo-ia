"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, ClipboardList,
  Database, RefreshCw, XCircle
} from "lucide-react";
import { useState } from "react";
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
          <table className="w-full text-sm">
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

  const total = data.crossBankDivergences.length;
  const tabs: { id: DivTab; label: string }[] = [
    { id: "ano",      label: "Por Ano"       },
    { id: "gve",      label: "Por GVE"       },
    { id: "municipio", label: "Por Município" }
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Divergências: Individuais (TRACONET) × Consolidado (NOTTRACONET)
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {total} municípios/ano
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Diferença <span className="font-medium text-red-600">positiva</span> = consolidado tem mais registros que individuais (subregistro TRACONET).{" "}
          Diferença <span className="font-medium text-amber-600">negativa</span> = individuais têm mais que consolidado (possível duplicidade).
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
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Individuais (TRACONET)</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Consolidado (NOTTRACONET)</th>
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
            </tbody>
          </table>
        )}

        {/* ABA: Por GVE */}
        {tab === "gve" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">GVE</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Individuais (TRACONET)</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Consolidado (NOTTRACONET)</th>
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
            </tbody>
          </table>
        )}

        {/* ABA: Por Município */}
        {tab === "municipio" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Município</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">GVE</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Ano</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Individuais</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Consolidado</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Diferença</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground">Risco</th>
              </tr>
            </thead>
            <tbody>
              {data.crossBankDivergences.map((d, i) => (
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
            </tbody>
          </table>
        )}

      </CardContent>
    </Card>
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

  const totalRecords = (data?.totalTraconet ?? 0) + (data?.totalNottraconet ?? 0);
  const highRisk     = data?.crossBankDivergences.filter((d) => d.risco === "alto").length ?? 0;
  const criticalCount = (data?.tfSemTratamento ?? 0) + (data?.ttSemCircurgia ?? 0) + (data?.semGraduacao ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
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
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
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
      {!isLoading && !apiError && data && totalRecords === 0 && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border bg-card text-muted-foreground">
          <Database className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhum registro SINAN importado ainda.</p>
          <a href="/sincronizacao" className="text-sm underline text-primary">Ir para Sincronização</a>
        </div>
      )}

      {data && totalRecords > 0 && (
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
          {data.diagnostico && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(["traconet", "nottraconet"] as const).map((banco) => {
                const d = data.diagnostico[banco];
                const label = banco === "traconet" ? "TRACONET — Casos Individuais" : "NOTTRACONET — Consolidado";
                const count = banco === "traconet" ? data.totalTraconet : data.totalNottraconet;
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

          {/* Cards de resumo */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-muted-foreground mb-1">Total de registros</div>
                <div className="text-3xl font-bold tabular-nums">{totalRecords.toLocaleString("pt-BR")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Individuais (TRACONET): {data.totalTraconet.toLocaleString("pt-BR")} · Consolidado (NOTTRACONET): {data.totalNottraconet.toLocaleString("pt-BR")}
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
                  TF s/tratamento + TT s/cirurgia + s/graduação
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
                label="sem forma clínica (TF/TI/TS/TT/CO)"
                severity={data.semGraduacao > 0 ? "critical" : "ok"}
                detail="Casos individuais sem graduação clínica preenchida — campo essencial para definir conduta"
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
          {(data.semFormaClinicaDetalhe?.length ?? 0) > 0 && (
            <SemFormaClinicaPanel data={data} />
          )}

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
        </>
      )}
    </div>
  );
}
