"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, X } from "lucide-react";
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
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  applied: "bg-green-100 text-green-800"
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

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <h1 className="text-lg font-semibold leading-tight">Fila de Correções CEVESP</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Correções propostas pelo Agente COS. Somente coordenadores e administradores podem aprovar e aplicar.</p>
      </div>
    <div className="space-y-6 p-6">

      {toast && (
        <div className={`rounded-md border px-4 py-2 text-sm font-medium ${
          toast.type === "success"
            ? "border-green-300 bg-green-50 text-green-800"
            : "border-red-300 bg-red-50 text-red-800"
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex gap-2">
        {(["pending", "approved", "rejected", "applied"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {items.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!items.isLoading && (items.data ?? []).length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma correção com status "{STATUS_LABELS[statusFilter]}".
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {(items.data ?? []).map((item) => (
          <Card key={item.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                    Registro <span className="font-mono text-primary">{item.record_id}</span>
                    {" · "}campo <span className="font-mono">{item.field_name}</span>
                  </CardTitle>
                  <CardDescription className="mt-1">{item.reason}</CardDescription>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                  {STATUS_LABELS[item.status]}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground line-through">{item.old_value || "—"}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium text-green-700">{item.new_value}</span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>Proposto por: <strong>{item.proposer?.full_name ?? "sistema"}</strong></span>
                <span>{new Date(item.created_at).toLocaleString("pt-BR")}</span>
                {item.reviewer && (
                  <span>Revisado por: <strong>{item.reviewer.full_name}</strong></span>
                )}
                {item.applied_at && (
                  <span>Aplicado em: {new Date(item.applied_at).toLocaleString("pt-BR")}</span>
                )}
              </div>

              {item.status === "pending" && (
                <div className="flex gap-2">
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
                </div>
              )}

              {item.status === "approved" && (
                <Button
                  size="sm"
                  onClick={() => apply.mutate(item.id)}
                  disabled={apply.isPending}
                  className="bg-green-700 hover:bg-green-800"
                >
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
