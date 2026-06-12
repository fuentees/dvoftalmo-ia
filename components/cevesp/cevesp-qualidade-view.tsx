"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ClipboardCheck,
  MapPin, RefreshCw, Users, XCircle
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InvalidRecord } from "@/services/cevesp-corrections";

type CevespTab = "registros" | "por_ano" | "por_gve" | "por_municipio";

interface QualidadeData {
  records: InvalidRecord[];
  byType: Record<string, number>;
  byGve: Array<{ gve: string; count: number }>;
  byAno: Array<{ ano: number; count: number }>;
  byMunicipio: Array<{ municipio: string; gve: string | null; count: number }>;
  total: number;
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

function TabsBar({ tab, setTab, counts }: {
  tab: CevespTab; setTab: (t: CevespTab) => void;
  counts: Record<CevespTab, number>;
}) {
  const items: Array<{ id: CevespTab; label: string }> = [
    { id: "registros",    label: "Registros"    },
    { id: "por_ano",      label: "Por Ano"      },
    { id: "por_gve",      label: "Por GVE"      },
    { id: "por_municipio",label: "Por Município" }
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

function PorAnoPanel({ data }: { data: QualidadeData }) {
  if (!data.byAno.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro com ano informado.</p>;
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Problemas por Ano</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium">Ano</th>
                <th className="px-4 py-2 text-right font-medium">Registros com problema</th>
              </tr>
            </thead>
            <tbody>
              {data.byAno.map(({ ano, count }) => (
                <tr key={ano} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium tabular-nums">{ano}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                      {count.toLocaleString("pt-BR")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PorGvePanel({ data }: { data: QualidadeData }) {
  if (!data.byGve.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro com GVE informado.</p>;
  }
  const maxCount = data.byGve[0]?.count ?? 1;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Problemas por GVE</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium">GVE</th>
                <th className="px-4 py-2 text-right font-medium">Registros</th>
                <th className="px-4 py-2 text-left font-medium w-32">Proporção</th>
              </tr>
            </thead>
            <tbody>
              {data.byGve.map(({ gve, count }) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PorMunicipioPanel({ data }: { data: QualidadeData }) {
  if (!data.byMunicipio.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro com município informado.</p>;
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Problemas por Município</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2 text-left font-medium">Município</th>
                <th className="px-4 py-2 text-left font-medium">GVE</th>
                <th className="px-4 py-2 text-right font-medium">Registros</th>
              </tr>
            </thead>
            <tbody>
              {data.byMunicipio.map(({ municipio, gve, count }) => (
                <tr key={municipio} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{municipio}</td>
                  <td className="px-4 py-2 text-muted-foreground">{gve ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    {count.toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function CevespQualidadeView() {
  const qc = useQueryClient();
  const [tab, setTab]             = useState<CevespTab>("registros");
  const [filterType, setFilterType] = useState<string>("todos");
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [proposeMsg, setProposeMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<QualidadeData, ApiError>({
    queryKey: ["cevesp-qualidade"],
    queryFn: async () => {
      const res  = await fetch("/api/cevesp/qualidade");
      const json = await res.json();
      if (!res.ok) throw json as ApiError;
      return json as QualidadeData;
    },
    staleTime: 2 * 60 * 1000
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
  const visible = filterType === "todos"
    ? records
    : records.filter((r) => r.issue.startsWith(filterType));

  const types = data ? Object.keys(data.byType) : [];

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((r) => r.recordId)));
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
  const byType = data?.byType ?? {};

  const dateTempoBased = records.filter((r) => r.issueType === "data_tempo").length;
  const conteudoBased  = records.filter((r) => r.issueType === "conteudo").length;

  const tabCounts: Record<CevespTab, number> = {
    registros:    total,
    por_ano:      data?.byAno.length ?? 0,
    por_gve:      data?.byGve.length ?? 0,
    por_municipio: data?.byMunicipio.length ?? 0
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Qualidade dos dados CEVESP</h1>
          <p className="text-sm text-muted-foreground">
            Inconsistências detectadas automaticamente — datas, SE, município, GVE, distribuição de casos.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

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

      {total > 0 && (
        <>
          <TabsBar tab={tab} setTab={setTab} counts={tabCounts} />

          {tab === "registros" && (
            <div className="space-y-4">
              {/* Filter + actions bar */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                  value={filterType}
                  onChange={(e) => { setFilterType(e.target.value); setSelected(new Set()); }}
                >
                  <option value="todos">Todos os problemas ({total})</option>
                  {types.map((t) => (
                    <option key={t} value={t}>{t} ({byType[t]})</option>
                  ))}
                </select>

                {selected.size > 0 ? (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={proposeMutation.isPending}
                    onClick={() => { setProposeMsg(null); proposeMutation.mutate([...selected]); }}
                  >
                    <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                    {proposeMutation.isPending ? "Propondo..." : `Propor correção (${selected.size})`}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={proposeMutation.isPending}
                    onClick={() => { setProposeMsg(null); proposeMutation.mutate(undefined); }}
                  >
                    <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                    {proposeMutation.isPending ? "Propondo..." : "Propor todas as correções"}
                  </Button>
                )}

                <span className="text-xs text-muted-foreground">
                  {visible.length} exibido(s)
                  {selected.size > 0 && ` · ${selected.size} selecionado(s)`}
                </span>
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
                          <th className="px-3 py-2 text-left font-medium">ID</th>
                          <th className="px-3 py-2 text-left font-medium">Data</th>
                          <th className="px-3 py-2 text-left font-medium">SE</th>
                          <th className="px-3 py-2 text-left font-medium">Município</th>
                          <th className="px-3 py-2 text-left font-medium">GVE</th>
                          <th className="px-3 py-2 text-left font-medium">Total Casos</th>
                          <th className="px-3 py-2 text-left font-medium">Problema</th>
                          <th className="px-3 py-2 text-left font-medium">Sugestão</th>
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
                              <td className="px-3 py-2 font-mono font-medium">{r.recordId}</td>
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

              <p className="text-xs text-muted-foreground">
                Correções propostas ficam na fila de aprovação em{" "}
                <a href="/correcoes" className="underline">Correções CEVESP</a>.
                Após aprovação, são aplicadas no banco de dados.
              </p>
            </div>
          )}

          {tab === "por_ano"      && data && <PorAnoPanel      data={data} />}
          {tab === "por_gve"      && data && <PorGvePanel      data={data} />}
          {tab === "por_municipio"&& data && <PorMunicipioPanel data={data} />}
        </>
      )}

      {total === 0 && (
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
