"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface EpiAlert {
  id: string;
  gve: string;
  se_epidemiologica: number;
  ano: number;
  cases_current: number;
  cases_avg: number;
  increase_pct: number;
  severity: "warning" | "critical";
  acknowledged: boolean;
  created_at: string;
}

const severityConfig = {
  critical: { label: "Crítica", icon: AlertCircle, cls: "border-red-200 bg-red-50 text-red-700" },
  warning:  { label: "Atenção", icon: AlertTriangle, cls: "border-amber-200 bg-amber-50 text-amber-700" },
};

export function AlertsView() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "critical" | "all">("pending");

  const { data: alerts = [], isLoading } = useQuery<EpiAlert[]>({
    queryKey: ["alerts"],
    queryFn: () => fetch("/api/alertas").then((r) => r.json())
  });

  const ack = useMutation({
    mutationFn: (id: string) =>
      fetch("/api/alertas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] })
  });

  const pending  = alerts.filter((a) => !a.acknowledged).length;
  const critical = alerts.filter((a) => a.severity === "critical" && !a.acknowledged).length;
  const visible  = useMemo(() => {
    if (filter === "pending")  return alerts.filter((a) => !a.acknowledged);
    if (filter === "critical") return alerts.filter((a) => a.severity === "critical");
    return alerts;
  }, [alerts, filter]);

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Resposta</Badge>
              {pending > 0 && <Badge className="border-red-200 bg-red-50 text-red-700">{pending} pendentes</Badge>}
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Alertas epidemiológicos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Eventos que merecem verificação local, investigação de surto ou reforço das medidas de controle.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-[330px]">
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Pendentes</p>
              <p className="text-lg font-semibold tabular-nums">{pending}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Críticos</p>
              <p className="text-lg font-semibold tabular-nums text-red-600">{critical}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Total</p>
              <p className="text-lg font-semibold tabular-nums">{alerts.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap gap-2 rounded-md border bg-card p-1">
          {[
            { id: "pending",  label: "Pendentes" },
            { id: "critical", label: "Críticos" },
            { id: "all",      label: "Todos" }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id as typeof filter)}
              className={`h-9 rounded px-3 text-sm font-medium transition-colors ${
                filter === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isLoading && <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Carregando alertas...</div>}

        {!isLoading && visible.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
              <CheckCircle className="mb-3 h-10 w-10 text-teal-600" />
              {filter === "pending" ? "Nenhum alerta pendente." : "Nenhum alerta registrado neste filtro."}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {visible.map((alert) => {
            const cfg  = severityConfig[alert.severity] ?? severityConfig.warning;
            const Icon = cfg.icon;
            return (
              <Card key={alert.id} className={alert.acknowledged ? "opacity-60" : ""}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${cfg.cls}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{alert.gve}</p>
                      <Badge className={cfg.cls}>{cfg.label}</Badge>
                      <span className="text-xs text-muted-foreground">SE {alert.se_epidemiologica}/{alert.ano}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <strong className="text-foreground">{alert.cases_current}</strong> casos registrados; média móvel de{" "}
                      <strong className="text-foreground">{alert.cases_avg.toFixed(1)}</strong> e aumento de{" "}
                      <strong className="text-foreground">{alert.increase_pct.toFixed(0)}%</strong>.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(alert.created_at).toLocaleString("pt-BR")}</p>
                  </div>
                  {!alert.acknowledged && (
                    <Button variant="outline" size="sm" onClick={() => ack.mutate(alert.id)} disabled={ack.isPending}>
                      Reconhecer
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
