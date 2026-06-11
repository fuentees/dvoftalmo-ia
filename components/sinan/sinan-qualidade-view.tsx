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
          {/* Cards de resumo */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-muted-foreground mb-1">Total de registros</div>
                <div className="text-3xl font-bold tabular-nums">{totalRecords.toLocaleString("pt-BR")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  TRACONET: {data.totalTraconet.toLocaleString("pt-BR")} · NOTTRACONET: {data.totalNottraconet.toLocaleString("pt-BR")}
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

          {/* Alertas de qualidade */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Alertas de Qualidade</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <AlertCard
                count={data.semGraduacao}
                label="sem graduação TF/TT"
                severity={data.semGraduacao > 0 ? "critical" : "ok"}
                detail="Casos confirmados sem classificação TF (folicular) ou TT (tracomatoso trichiasis)"
              />
              <AlertCard
                count={data.tfSemTratamento}
                label="TF confirmado sem tratamento"
                severity={data.tfSemTratamento > 0 ? "critical" : "ok"}
                detail="TF ativo exige azitromicina — ausência de tratamento é inconsistência grave"
              />
              <AlertCard
                count={data.ttSemCircurgia}
                label="TT sem cirurgia/epilation registrada"
                severity={data.ttSemCircurgia > 0 ? "critical" : "ok"}
                detail="TT requer cirurgia ou epilation — ausência indica subregistro de conduta"
              />
              <AlertCard
                count={data.semTratamento}
                label="sem qualquer tratamento"
                severity={data.semTratamento > 0 ? "warning" : "ok"}
                detail="Campo tratamento vazio — pode ser dado faltante ou caso encerrado sem conduta"
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

          {/* Divergências entre bancos */}
          {data.crossBankDivergences.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Divergências TRACONET × NOTTRACONET
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    {data.crossBankDivergences.length}
                  </span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Município/ano onde o consolidado (TRACONET) difere dos casos individuais (NOTTRACONET).
                  Diferença positiva = subnotificação de casos individuais.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">Município</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">Ano</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">TRACONET</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">NOTTRACONET</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">Diferença</th>
                      <th className="px-4 py-2 text-center font-medium text-muted-foreground">Risco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.crossBankDivergences.map((d, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2 font-medium">{d.municipio}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.ano}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.traconet.toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.nottraconet.toLocaleString("pt-BR")}</td>
                        <td className={`px-4 py-2 text-right tabular-nums font-semibold ${d.diff > 0 ? "text-red-600" : "text-amber-600"}`}>
                          {d.diff > 0 ? "+" : ""}{d.diff.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_COLOR[d.risco]}`}>
                            {RISK_LABEL[d.risco]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Completude de campos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Completude dos Campos</CardTitle>
              <p className="text-xs text-muted-foreground">
                Percentual de registros com o campo preenchido. Abaixo de 70% = crítico.
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
