"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface AuditEntry {
  id: string;
  correction_id: string;
  action: string;
  applied_by: string;
  applied_at: string;
  applier?: { full_name: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  applied: "Aplicada",
  reviewed: "Revisada",
  approved: "Aprovada",
  rejected: "Rejeitada",
  created: "Criada"
};

const ACTION_COLORS: Record<string, string> = {
  applied: "border-green-200 bg-green-50 text-green-700",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  reviewed: "border-amber-200 bg-amber-50 text-amber-700",
  created: "bg-muted text-foreground"
};

const PAGE_SIZE = 50;

export function AuditLogView() {
  const [skip, setSkip] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  const { isFetching, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log", skip],
    queryFn: async () => {
      const res = await fetch(`/api/auditoria?skip=${skip}&limit=${PAGE_SIZE}`);
      const data = (await res.json()) as AuditEntry[];
      setEntries((prev) => (skip === 0 ? data : [...prev, ...data]));
      return data;
    }
  });

  const hasMore = entries.length > 0 && entries.length % PAGE_SIZE === 0;
  const stats = useMemo(() => {
    return {
      total: entries.length,
      applied: entries.filter((entry) => entry.action === "applied").length,
      rejected: entries.filter((entry) => entry.action === "rejected").length
    };
  }, [entries]);

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Dados</Badge>
              <Badge className="bg-muted text-foreground">Rastreabilidade</Badge>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Auditoria</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Historico das propostas, aprovacoes, rejeicoes e aplicacoes realizadas nas bases.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-[330px]">
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Carregados</p>
              <p className="text-lg font-semibold tabular-nums">{stats.total}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Aplicadas</p>
              <p className="text-lg font-semibold tabular-nums text-green-700">{stats.applied}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Rejeitadas</p>
              <p className="text-lg font-semibold tabular-nums text-red-600">{stats.rejected}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {isLoading && <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Carregando registros...</div>}

        {!isLoading && entries.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
              <ClipboardList className="mb-3 h-10 w-10 opacity-40" />
              Nenhum registro de auditoria encontrado.
            </CardContent>
          </Card>
        )}

        {entries.length > 0 && (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Acao</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Correcao</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Usuario</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Badge className={ACTION_COLORS[entry.action] ?? ACTION_COLORS.created}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.correction_id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{entry.applier?.full_name ?? entry.applied_by?.slice(0, 8) ?? "-"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(entry.applied_at).toLocaleString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="text-center">
            <Button variant="outline" onClick={() => setSkip((value) => value + PAGE_SIZE)} disabled={isFetching}>
              <ChevronDown className="h-4 w-4" />
              {isFetching ? "Carregando..." : "Carregar mais"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
