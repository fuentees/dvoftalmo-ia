"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ClipboardCheck, Copy, Database, Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "pending" | "approved" | "rejected" | "applied";

interface CorrectionItem {
  id: string;
  table_name: string;
  record_id: string;
  field_name: string;
  old_value: string;
  new_value: string;
  reason: string;
  status: Status;
  created_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
  proposed_by: string | null;
  reviewed_by: string | null;
  proposer: { full_name: string } | null;
  reviewer: { full_name: string } | null;
}

const STATUS_TABS: Array<{ id: Status; label: string }> = [
  { id: "pending", label: "Para aprovar" },
  { id: "approved", label: "Aprovadas" },
  { id: "applied", label: "Aplicadas" },
  { id: "rejected", label: "Rejeitadas" }
];

const STATUS_LABELS: Record<Status, string> = {
  pending: "Aguardando",
  approved: "Aprovada",
  rejected: "Rejeitada",
  applied: "Aplicada"
};

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(items: CorrectionItem[], status: string) {
  const header = ["ID", "Tabela", "Registro", "Campo", "Valor Atual", "Valor Sugerido", "Motivo", "Status", "Proposto por", "Data proposta", "Revisado por", "Data revisão", "Aplicado em"];
  const rows = items.map((item) => [
    item.id, item.table_name, item.record_id, item.field_name, item.old_value ?? "", item.new_value ?? "", item.reason ?? "",
    STATUS_LABELS[item.status], item.proposer?.full_name ?? "sistema",
    item.created_at ? new Date(item.created_at).toLocaleString("pt-BR") : "",
    item.reviewer?.full_name ?? "",
    item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("pt-BR") : "",
    item.applied_at ? new Date(item.applied_at).toLocaleString("pt-BR") : ""
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  download(`correcoes-${status}-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
}

const ident = (v: string) => (/^[A-Za-z0-9_]+$/.test(v) ? `\`${v}\`` : null);
const literal = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

/**
 * SQL das correções aprovadas para quem tem permissão de escrita no MySQL: backup das
 * linhas, UPDATE que só altera se o valor ainda for o auditado, e conferência.
 */
function exportSql(items: CorrectionItem[]) {
  const validas = items.filter((i) => ident(i.table_name) && ident(i.field_name) && /^\d+$/.test(i.record_id));
  const tabelas = [...new Set(validas.map((i) => i.table_name))];
  const data = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const linhas = [
    `-- Correções aprovadas na fila do sistema · ${new Date().toLocaleString("pt-BR")}`,
    `-- ${validas.length} alteração(ões). Rode com um usuário com permissão de UPDATE e CREATE.`,
    ""
  ];
  for (const tabela of tabelas) {
    const ids = [...new Set(validas.filter((i) => i.table_name === tabela).map((i) => i.record_id))];
    linhas.push(`CREATE TABLE \`${tabela}_bkp_fila_${data}\` AS SELECT * FROM \`${tabela}\` WHERE \`ID\` IN (${ids.join(",")});`);
  }
  linhas.push("");
  for (const i of validas) {
    const guarda = i.old_value === "" ? `(${ident(i.field_name)} IS NULL OR ${ident(i.field_name)} = '')` : `${ident(i.field_name)} = ${literal(i.old_value)}`;
    linhas.push(`UPDATE ${ident(i.table_name)} SET ${ident(i.field_name)} = ${literal(i.new_value)} WHERE \`ID\` = ${i.record_id} AND ${guarda};  -- ${i.reason.replace(/\n/g, " ")}`);
  }
  linhas.push("", "-- Depois de aplicar, marque as correções como aplicadas no sistema ou rode a sincronização.");
  download(`correcoes-aprovadas-${data}.sql`, linhas.join("\n"), "text/plain;charset=utf-8");
}

const dataHora = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

export function CorrectionQueueView() {
  const [statusFilter, setStatusFilter] = useState<Status>("pending");
  const [query, setQuery] = useState("");
  const [fieldFilter, setFieldFilter] = useState("todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const queryClient = useQueryClient();

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  const items = useQuery<CorrectionItem[]>({
    queryKey: ["corrections", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/corrections?status=${statusFilter}`);
      if (!res.ok) return [];
      return res.json();
    }
  });

  async function reviewOne(id: string, action: "approve" | "reject") {
    const res = await fetch("/api/corrections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Erro ao processar.");
    }
  }

  // Revisão de uma ou várias: em lotes de 5 para não sobrecarregar a API
  const review = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: "approve" | "reject" }) => {
      let ok = 0;
      const erros: string[] = [];
      for (let i = 0; i < ids.length; i += 5) {
        const lote = await Promise.allSettled(ids.slice(i, i + 5).map((id) => reviewOne(id, action)));
        for (const r of lote) {
          if (r.status === "fulfilled") ok++;
          else erros.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      }
      return { ok, erros, action };
    },
    onSuccess: ({ ok, erros, action }) => {
      const verbo = action === "approve" ? "aprovada(s)" : "rejeitada(s)";
      showToast(erros.length ? `${ok} ${verbo}; ${erros.length} com erro: ${erros[0]}` : `${ok} correção(ões) ${verbo}.`, erros.length ? "error" : "success");
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["corrections"] });
    },
    onError: (err: Error) => showToast(err.message, "error")
  });

  const apply = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/corrections/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao aplicar.");
    },
    onSuccess: () => {
      showToast("Correção aplicada no CEVESP.", "success");
      queryClient.invalidateQueries({ queryKey: ["corrections"] });
    },
    onError: (err: Error) => showToast(err.message, "error")
  });

  const allItems = useMemo(() => items.data ?? [], [items.data]);
  const fieldSummary = useMemo(
    () => Object.entries(allItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.field_name] = (acc[item.field_name] ?? 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]),
    [allItems]
  );
  const visibleItems = useMemo(() => {
    const q = normalizeSearch(query);
    return allItems.filter((item) => {
      if (fieldFilter !== "todos" && item.field_name !== fieldFilter) return false;
      if (!q) return true;
      return normalizeSearch(`${item.record_id} ${item.field_name} ${item.reason} ${item.table_name} ${item.proposer?.full_name ?? ""}`).includes(q);
    });
  }, [allItems, fieldFilter, query]);

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((i) => selected.has(i.id));
  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleItems.map((i) => i.id)));
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyCorrectionText(item: CorrectionItem) {
    const text = [
      "Prezados(as),", "",
      "Solicitamos verificar e corrigir o registro abaixo na base CEVESP:",
      `- Registro: ${item.record_id}`,
      `- Campo: ${item.field_name}`,
      `- Valor atual: ${item.old_value || "-"}`,
      `- Valor sugerido: ${item.new_value || "-"}`,
      `- Motivo: ${item.reason}`, "",
      "Após a correção, favor informar para atualização do acompanhamento de qualidade dos dados.", "",
      "Atenciosamente,"
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Texto de cobrança copiado.", "success");
    } catch {
      showToast("Não foi possível copiar automaticamente neste navegador.", "error");
    }
  }

  const selecionadas = visibleItems.filter((i) => selected.has(i.id));

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 p-4 md:p-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-[28px] font-bold tracking-tight">Correções</h1>
          <p className="text-[15px] text-muted-foreground">Toda alteração no banco passa por aqui: proposta, aprovação e aplicação, com registro.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {allItems.length > 0 && (
            <Button variant="outline" className="h-11" onClick={() => exportCsv(visibleItems, statusFilter)}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          )}
          {statusFilter === "approved" && visibleItems.length > 0 && (
            <Button className="h-11" onClick={() => exportSql(visibleItems)}>
              <Database className="h-4 w-4" /> Exportar SQL das aprovadas
            </Button>
          )}
        </div>
      </header>

      {statusFilter === "approved" && (
        <p role="status" className="flex items-start gap-2.5 rounded-lg border border-orange-200 bg-orange-50 p-3.5 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Aplicar exige permissão de escrita no MySQL.</strong> Se o usuário configurado só tiver leitura, exporte o SQL: ele faz backup das linhas e só altera se o valor ainda for o auditado.
          </span>
        </p>
      )}

      {toast && (
        <p role="status" className={cn("rounded-lg border px-4 py-2.5 text-sm font-medium", toast.type === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800")}>
          {toast.message}
        </p>
      )}

      <div role="tablist" aria-label="Situação" className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.id}
            onClick={() => { setStatusFilter(tab.id); setQuery(""); setFieldFilter("todos"); setSelected(new Set()); }}
            className={cn(
              "h-10 rounded-full border px-4 text-sm transition-colors",
              statusFilter === tab.id ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-input bg-card hover:bg-muted"
            )}
          >
            {tab.label}
            {statusFilter === tab.id && !items.isLoading && <span className="num ml-1.5">{allItems.length.toLocaleString("pt-BR")}</span>}
          </button>
        ))}
      </div>

      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-[18px] w-[18px]" checked={allVisibleSelected} onChange={toggleAll} disabled={!visibleItems.length} />
            Selecionar {visibleItems.length.toLocaleString("pt-BR")} visíveis
          </label>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar registro, campo, motivo ou pessoa"
              aria-label="Buscar correções"
              className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {statusFilter === "pending" && (
            <div className="flex gap-2">
              <Button variant="outline" className="h-10" disabled={!selecionadas.length || review.isPending}
                onClick={() => review.mutate({ ids: selecionadas.map((i) => i.id), action: "reject" })}>
                <X className="h-4 w-4" /> Rejeitar
              </Button>
              <Button className="h-10" disabled={!selecionadas.length || review.isPending}
                onClick={() => review.mutate({ ids: selecionadas.map((i) => i.id), action: "approve" })}>
                <Check className="h-4 w-4" /> {review.isPending ? "Enviando..." : `Aprovar ${selecionadas.length || ""}`.trim()}
              </Button>
            </div>
          )}
        </div>

        {fieldSummary.length > 1 && (
          <div className="flex flex-wrap gap-2 border-b px-4 py-2.5 text-xs">
            <button type="button" onClick={() => setFieldFilter("todos")}
              className={cn("rounded-full border px-2.5 py-1", fieldFilter === "todos" ? "border-primary bg-secondary text-secondary-foreground" : "bg-card text-muted-foreground")}>
              Todos os campos
            </button>
            {fieldSummary.map(([field, count]) => (
              <button key={field} type="button" onClick={() => setFieldFilter(field)}
                className={cn("rounded-full border px-2.5 py-1", fieldFilter === field ? "border-primary bg-secondary text-secondary-foreground" : "bg-card text-muted-foreground")}>
                {field} <strong className="num">{count.toLocaleString("pt-BR")}</strong>
              </button>
            ))}
          </div>
        )}

        {items.isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
            <ClipboardCheck className="mb-3 h-10 w-10 opacity-40" aria-hidden="true" />
            {allItems.length > 0 ? "Nenhuma correção para os filtros aplicados." : `Nenhuma correção ${STATUS_LABELS[statusFilter].toLowerCase()}.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-4 py-2.5"><span className="sr-only">Selecionar</span></th>
                  <th className="px-2 py-2.5 font-semibold">Registro</th>
                  <th className="px-2 py-2.5 font-semibold">Alteração</th>
                  <th className="px-2 py-2.5 font-semibold">Motivo</th>
                  <th className="px-2 py-2.5 font-semibold">Proposta</th>
                  <th className="px-4 py-2.5 text-right font-semibold"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id} className={cn("border-t align-top", selected.has(item.id) && "bg-secondary/50")}>
                    <td className="px-4 py-3">
                      <input type="checkbox" className="h-[18px] w-[18px]" aria-label={`Selecionar registro ${item.record_id}`} checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                    </td>
                    <td className="num whitespace-nowrap px-2 py-3">{item.record_id}</td>
                    <td className="px-2 py-3">
                      <span className="text-xs text-muted-foreground">{item.field_name}</span>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="num rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through dark:bg-red-950 dark:text-red-300">{item.old_value || "vazio"}</span>
                        <span aria-hidden="true">→</span>
                        <span className="num rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{item.new_value}</span>
                      </div>
                    </td>
                    <td className="max-w-[360px] px-2 py-3 text-muted-foreground">{item.reason}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-xs text-muted-foreground">
                      <div>{item.proposer?.full_name ?? "sistema"} · {dataHora(item.created_at)}</div>
                      {item.reviewer && <div>Revisada por {item.reviewer.full_name}{item.reviewed_at && ` · ${dataHora(item.reviewed_at)}`}</div>}
                      {item.applied_at && <div>Aplicada em {dataHora(item.applied_at)}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        {item.status === "pending" && (
                          <>
                            <Button size="sm" variant="outline" aria-label={`Rejeitar ${item.record_id}`} disabled={review.isPending}
                              onClick={() => review.mutate({ ids: [item.id], action: "reject" })}><X className="h-4 w-4" /></Button>
                            <Button size="sm" aria-label={`Aprovar ${item.record_id}`} disabled={review.isPending}
                              onClick={() => review.mutate({ ids: [item.id], action: "approve" })}><Check className="h-4 w-4" /></Button>
                          </>
                        )}
                        {item.status === "approved" && (
                          <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate(item.id)}>
                            {apply.isPending ? "Aplicando..." : "Aplicar"}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" aria-label={`Copiar texto de cobrança do registro ${item.record_id}`} onClick={() => void copyCorrectionText(item)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
