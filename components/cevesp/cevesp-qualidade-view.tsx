"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ClipboardCheck,
  RefreshCw, XCircle
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InvalidRecord } from "@/services/cevesp-corrections";

interface QualidadeData {
  records: InvalidRecord[];
  byType: Record<string, number>;
  total: number;
}

interface ApiError { error: string; message?: string }

const ISSUE_ICON: Record<string, React.ReactNode> = {
  "Data futura":      <AlertTriangle className="h-4 w-4 text-amber-500" />,
  "Ano impossível":   <XCircle       className="h-4 w-4 text-red-500"   />,
  "Dia impossível":   <XCircle       className="h-4 w-4 text-red-500"   />,
  "SE inválida":      <AlertCircle   className="h-4 w-4 text-red-500"   />,
  "SE futura":        <AlertTriangle className="h-4 w-4 text-amber-500" />
};

function severity(issue: string): "critical" | "warning" {
  if (issue.startsWith("Ano impossível") || issue.startsWith("Dia impossível") || issue.startsWith("SE inválida")) return "critical";
  return "warning";
}

function SummaryCard({ count, label, sev, detail }: {
  count: number; label: string; sev: "critical" | "warning" | "ok"; detail?: string;
}) {
  const styles = {
    critical: { border: "border-red-200 bg-red-50",     icon: <XCircle      className="h-5 w-5 text-red-500"   />, num: "text-red-700"   },
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

export function CevespQualidadeView() {
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState<string>("todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [proposeMsg, setProposeMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<QualidadeData, ApiError>({
    queryKey: ["cevesp-qualidade"],
    queryFn: async () => {
      const res = await fetch("/api/cevesp/qualidade");
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
    onError: (err: Error) => {
      setProposeMsg({ type: "error", text: err.message });
    }
  });

  // filter records
  const records = data?.records ?? [];
  const visible = filterType === "todos"
    ? records
    : records.filter((r) => r.issue.startsWith(filterType));

  // issue types present
  const types = data ? Object.keys(data.byType) : [];

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === visible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((r) => r.recordId)));
    }
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
  const dateBased = (byType["Data futura"] ?? 0) + (byType["Ano impossível"] ?? 0) + (byType["Dia impossível"] ?? 0);
  const seBased   = (byType["SE inválida"] ?? 0) + (byType["SE futura"] ?? 0);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Qualidade dos dados CEVESP</h1>
          <p className="text-sm text-muted-foreground">
            Registros com inconsistências detectadas automaticamente — datas inválidas, SE incorreta, etc.
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
          detail={total === 0 ? "Nenhuma inconsistência detectada" : "Ver tabela abaixo"}
        />
        <SummaryCard
          count={dateBased}
          label="problemas de data"
          sev={dateBased > 0 ? "critical" : "ok"}
          detail="Data futura, ano impossível, dia inexistente"
        />
        <SummaryCard
          count={seBased}
          label="problemas de SE"
          sev={seBased > 0 ? "warning" : "ok"}
          detail="SE > 53, SE < 1, SE futura"
        />
      </div>

      {total > 0 && (
        <>
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
                onClick={() => {
                  setProposeMsg(null);
                  proposeMutation.mutate([...selected]);
                }}
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
                onClick={() => {
                  setProposeMsg(null);
                  proposeMutation.mutate(undefined);
                }}
              >
                <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                {proposeMutation.isPending ? "Propondo..." : "Propor todas as correções"}
              </Button>
            )}

            <span className="text-xs text-muted-foreground">
              {visible.length} registro(s) exibido(s)
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

          {/* Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Registros com inconsistência
              </CardTitle>
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
                      <th className="px-3 py-2 text-left font-medium">ID Notificação</th>
                      <th className="px-3 py-2 text-left font-medium">Data</th>
                      <th className="px-3 py-2 text-left font-medium">SE</th>
                      <th className="px-3 py-2 text-left font-medium">Município</th>
                      <th className="px-3 py-2 text-left font-medium">Problema</th>
                      <th className="px-3 py-2 text-left font-medium">Sugestão de correção</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const sev = severity(r.issue);
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
                          <td className="px-3 py-2 max-w-[140px] truncate" title={r.municipio ?? undefined}>
                            {r.municipio ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="shrink-0">
                                {ISSUE_ICON[r.issue.split(":")[0].trim()] ?? (
                                  <AlertCircle className={`h-4 w-4 ${sev === "critical" ? "text-red-500" : "text-amber-500"}`} />
                                )}
                              </span>
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
            Após aprovação por coordenador/admin, são aplicadas no banco de dados.
          </p>
        </>
      )}

      {total === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center text-sm text-green-800">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
          <p className="font-medium">Nenhuma inconsistência detectada</p>
          <p className="mt-1 text-xs text-green-700">
            Todos os registros CEVESP verificados possuem datas e semanas epidemiológicas válidas.
          </p>
        </div>
      )}
    </div>
  );
}
