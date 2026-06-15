"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ClipboardCheck, Copy, X } from "lucide-react";
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
  proposer: { full_name: string } | null;
  reviewer: { full_name: string } | null;
}

const STATUS_LABELS: Record<Status, string> = {
  pending: "Aguardando",
  approved: "Aprovado",
  rejected: "Rejeitado",
  applied: "Aplicado"
};

const STATUS_COLORS: Record<Status, string> = {
  pending: "border-yellow-200 bg-yellow-50 text-yellow-800",
  approved: "border-blue-200 bg-blue-50 text-blue-800",
  rejected: "border-red-200 bg-red-50 text-red-800",
  applied: "border-green-200 bg-green-50 text-green-800"
};

export function CorrectionQueueView() {
  const [statusFilter, setStatusFilter] = useState<Status>("pending");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
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
      showToast(action === "approve" ? "Correcao aprovada." : "Correcao rejeitada.", "success");
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
      showToast("Correcao aplicada ao CEVESP com sucesso.", "success");
      queryClient.invalidateQueries({ queryKey: ["corrections"] });
    },
    onError: (err: Error) => showToast(err.message, "error")
  });

  const visibleItems = items.data ?? [];
  const fieldSummary = Object.entries(
    visibleItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.field_name] = (acc[item.field_name] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

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
      showToast("Texto de cobranca copiado.", "success");
    } catch {
      showToast("Nao foi possivel copiar automaticamente neste navegador.", "error");
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
            <h1 className="text-xl font-semibold tracking-tight">Fila de correcoes</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Revisao das inconsistencias propostas pelo agente antes de aplicar ajustes na base operacional.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs sm:min-w-[230px]">
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">No filtro</p>
              <p className="text-lg font-semibold tabular-nums">{visibleItems.length}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Etapa</p>
              <p className="text-sm font-semibold">{STATUS_LABELS[statusFilter]}</p>
            </div>
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

        <div className="flex flex-wrap gap-2 rounded-md border bg-card p-1">
          {(["pending", "approved", "rejected", "applied"] as Status[]).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`h-9 rounded px-3 text-sm font-medium transition-colors ${
                statusFilter === status ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>

        {fieldSummary.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {fieldSummary.slice(0, 6).map(([field, count]) => (
              <span key={field} className="rounded-full border bg-card px-2.5 py-1 text-muted-foreground">
                {field}: <strong className="text-foreground">{count.toLocaleString("pt-BR")}</strong>
              </span>
            ))}
          </div>
        )}

        {items.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {!items.isLoading && visibleItems.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
              <ClipboardCheck className="mb-3 h-10 w-10 opacity-40" />
              Nenhuma correcao com status "{STATUS_LABELS[statusFilter]}".
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
                      {" - "}campo <span className="font-mono">{item.field_name}</span>
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

                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span>Proposto por: <strong>{item.proposer?.full_name ?? "sistema"}</strong></span>
                  <span>{new Date(item.created_at).toLocaleString("pt-BR")}</span>
                  {item.reviewer && <span>Revisado por: <strong>{item.reviewer.full_name}</strong></span>}
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
                      Copiar cobranca
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
