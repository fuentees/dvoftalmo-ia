"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ClipboardCheck, Copy, Download, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

const STATUS_LABELS: Record<Status, string> = {
  pending:  "Aguardando",
  approved: "Aprovado",
  rejected: "Rejeitado",
  applied:  "Aplicado"
};

const STATUS_COLORS: Record<Status, string> = {
  pending:  "border-yellow-200 bg-yellow-50 text-yellow-800",
  approved: "border-blue-200 bg-blue-50 text-blue-800",
  rejected: "border-red-200 bg-red-50 text-red-800",
  applied:  "border-green-200 bg-green-50 text-green-800"
};

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function exportCsv(items: CorrectionItem[], status: string) {
  const header = ["ID", "Tabela", "Registro", "Campo", "Valor Atual", "Valor Sugerido", "Motivo", "Status", "Proposto por", "Data proposta", "Revisado por", "Data revisão", "Aplicado em"];
  const rows = items.map((item) => [
    item.id,
    item.table_name,
    item.record_id,
    item.field_name,
    item.old_value ?? "",
    item.new_value ?? "",
    item.reason ?? "",
    STATUS_LABELS[item.status],
    item.proposer?.full_name ?? "sistema",
    item.created_at ? new Date(item.created_at).toLocaleString("pt-BR") : "",
    item.reviewer?.full_name ?? "",
    item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("pt-BR") : "",
    item.applied_at ? new Date(item.applied_at).toLocaleString("pt-BR") : ""
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `correcoes-${status}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CorrectionQueueView() {
  const [statusFilter, setStatusFilter] = useState<Status>("pending");
  const [query, setQuery]               = useState("");
  const [fieldFilter, setFieldFilter]   = useState("todos");
  const [toast, setToast]               = useState<{ message: string; type: "success" | "error" } | null>(null);
  const queryClient = useQueryClient();

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  const items = useQuery<CorrectionItem[]>({
    queryKey: ["corrections", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/corrections?status=${statusFilter}`);
      if (!res.ok) return [];
      return res.json();
    }
  });

  const review = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const res = await fetch("/api/corrections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao processar.");
      }
      return action;
    },
    onSuccess: (action) => {
      showToast(action === "approve" ? "Correção aprovada." : "Correção rejeitada.", "success");
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
      showToast("Correção aplicada ao CEVESP com sucesso.", "success");
      queryClient.invalidateQueries({ queryKey: ["corrections"] });
    },
    onError: (err: Error) => showToast(err.message, "error")
  });

  const allItems = useMemo(() => items.data ?? [], [items.data]);

  const fieldOptions = useMemo(
    () => [...new Set(allItems.map((i) => i.field_name))].sort(),
    [allItems]
  );

  const visibleItems = useMemo(() => {
    const q = normalizeSearch(query);
    return allItems.filter((item) => {
      if (fieldFilter !== "todos" && item.field_name !== fieldFilter) return false;
      if (!q) return true;
      return normalizeSearch(
        `${item.record_id} ${item.field_name} ${item.reason} ${item.table_name} ${item.proposer?.full_name ?? ""}`
      ).includes(q);
    });
  }, [allItems, fieldFilter, query]);

  const fieldSummary = useMemo(
    () => Object.entries(
      allItems.reduce<Record<string, number>>((acc, item) => {
        acc[item.field_name] = (acc[item.field_name] ?? 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]),
    [allItems]
  );

  async function copyCorrectionText(item: CorrectionItem) {
    const text = [
      "Prezados(as),",
      "",
      "Solicitamos verificar e corrigir o registro abaixo na base CEVESP:",
      `- Registro: ${item.record_id}`,
      `- Tabela: ${item.table_name}`,
      `- Campo: ${item.field_name}`,
      `- Valor atual: ${item.old_value || "-"}`,
      `- Valor sugerido: ${item.new_value || "-"}`,
      `- Motivo: ${item.reason}`,
      "",
      "Após a correção, favor informar para atualização do acompanhamento de qualidade dos dados.",
      "",
      "Atenciosamente,"
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Texto de cobrança copiado.", "success");
    } catch {
      showToast("Não foi possível copiar automaticamente neste navegador.", "error");
    }
  }

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Dados</Badge>
              <Badge className={STATUS_COLORS[statusFilter]}>{STATUS_LABELS[statusFilter]}</Badge>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Fila de correções</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Revisão das inconsistências propostas pelo agente antes de aplicar ajustes na base operacional.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="grid grid-cols-2 gap-2 text-center text-xs sm:min-w-[200px]">
              <div className="rounded-md border bg-background px-3 py-2">
                <p className="text-muted-foreground">Exibindo</p>
                <p className="text-lg font-semibold tabular-nums">{visibleItems.length}</p>
              </div>
              <div className="rounded-md border bg-background px-3 py-2">
                <p className="text-muted-foreground">Total</p>
                <p className="text-lg font-semibold tabular-nums">{allItems.length}</p>
              </div>
            </div>
            {allItems.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportCsv(visibleItems, statusFilter)}
                title="Exportar correções exibidas para CSV"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        {toast && (
          <div
            className={`rounded-md border px-4 py-2 text-sm font-medium ${
              toast.type === "success" ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-800"
            }`}
          >
            {toast.message}
          </div>
        )}

        {/* Filtro de status */}
        <div className="flex flex-wrap gap-2 rounded-md border bg-card p-1">
          {(["pending", "approved", "rejected", "applied"] as Status[]).map((status) => (
            <button
              key={status}
              onClick={() => { setStatusFilter(status); setQuery(""); setFieldFilter("todos"); }}
              className={`h-9 rounded px-3 text-sm font-medium transition-colors ${
                statusFilter === status ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>

        {/* Busca + filtro por campo */}
        {allItems.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por registro, campo, motivo ou responsável"
                className="h-8 w-full rounded-md border bg-background pl-8 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <select
              value={fieldFilter}
              onChange={(e) => setFieldFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="todos">Todos os campos</option>
              {fieldOptions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            {(query || fieldFilter !== "todos") && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => { setQuery(""); setFieldFilter("todos"); }}
              >
                <X className="h-3.5 w-3.5" /> Limpar
              </Button>
            )}
          </div>
        )}

        {/* Chips de resumo por campo */}
        {fieldSummary.length > 0 && !query && fieldFilter === "todos" && (
          <div className="flex flex-wrap gap-2 text-xs">
            {fieldSummary.slice(0, 6).map(([field, count]) => (
              <button
                key={field}
                onClick={() => setFieldFilter(field)}
                className="rounded-full border bg-card px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {field}: <strong className="text-foreground">{count.toLocaleString("pt-BR")}</strong>
              </button>
            ))}
          </div>
        )}

        {items.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {!items.isLoading && visibleItems.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
              <ClipboardCheck className="mb-3 h-10 w-10 opacity-40" />
              {allItems.length > 0
                ? "Nenhuma correção encontrada para os filtros aplicados."
                : `Nenhuma correção com status "${STATUS_LABELS[statusFilter]}".`}
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {visibleItems.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
                      Registro <span className="font-mono text-primary">{item.record_id}</span>
                      {" — "}campo <span className="font-mono">{item.field_name}</span>
                    </CardTitle>
                    <CardDescription className="mt-1">{item.reason}</CardDescription>
                  </div>
                  <Badge className={STATUS_COLORS[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground line-through">{item.old_value || "-"}</span>
                  <span className="text-muted-foreground">para</span>
                  <span className="font-medium text-green-700">{item.new_value}</span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Tabela: <span className="font-mono text-foreground">{item.table_name}</span></span>
                  <span>Proposto por: <strong className="text-foreground">{item.proposer?.full_name ?? "sistema"}</strong></span>
                  <span>{new Date(item.created_at).toLocaleString("pt-BR")}</span>
                  {item.reviewer && (
                    <span>
                      Revisado por: <strong className="text-foreground">{item.reviewer.full_name}</strong>
                      {item.reviewed_at && <> em {new Date(item.reviewed_at).toLocaleString("pt-BR")}</>}
                    </span>
                  )}
                  {item.applied_at && <span>Aplicado em: {new Date(item.applied_at).toLocaleString("pt-BR")}</span>}
                </div>

                {item.status === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => review.mutate({ id: item.id, action: "approve" })}
                      disabled={review.isPending}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => review.mutate({ id: item.id, action: "reject" })}
                      disabled={review.isPending}
                    >
                      <X className="h-3.5 w-3.5" />
                      Rejeitar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyCorrectionText(item)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copiar cobrança
                    </Button>
                  </div>
                )}

                {item.status === "approved" && (
                  <Button size="sm" onClick={() => apply.mutate(item.id)} disabled={apply.isPending} className="bg-green-700 hover:bg-green-800">
                    {apply.isPending ? "Aplicando..." : "Aplicar no CEVESP"}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
