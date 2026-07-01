"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type AlertStatus = "novo" | "em_investigacao" | "confirmado" | "descartado" | "encerrado";
type AlertFilter = "active" | "critical" | AlertStatus | "all";

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
  status?: AlertStatus | null;
  status_note?: string | null;
  status_updated_at?: string | null;
  closed_at?: string | null;
  created_at: string;
}

type AlertsResponse = {
  alerts: EpiAlert[];
  warning?: string | null;
};

const severityConfig = {
  critical: { label: "Crítica", icon: AlertCircle, cls: "border-red-200 bg-red-50 text-red-700" },
  warning:  { label: "Atenção", icon: AlertTriangle, cls: "border-amber-200 bg-amber-50 text-amber-700" },
};

const statusConfig: Record<AlertStatus, { label: string; cls: string }> = {
  novo: { label: "Novo", cls: "border-red-200 bg-red-50 text-red-700" },
  em_investigacao: { label: "Em investigação", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  confirmado: { label: "Confirmado", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  descartado: { label: "Descartado", cls: "bg-muted text-foreground" },
  encerrado: { label: "Encerrado", cls: "border-teal-200 bg-teal-50 text-teal-700" }
};

function alertStatus(alert: EpiAlert): AlertStatus {
  if (alert.status && statusConfig[alert.status]) return alert.status;
  return alert.acknowledged ? "encerrado" : "novo";
}

function isActive(alert: EpiAlert) {
  return !["descartado", "encerrado"].includes(alertStatus(alert));
}

export function AlertsView() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<AlertFilter>("active");

  const { data, error, isLoading } = useQuery<AlertsResponse>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const response = await fetch("/api/alertas");
      const warning = response.headers.get("X-DvOftalmo-Warning");
      const body = await response.json().catch(() => []);
      if (!response.ok) throw new Error(body?.error ?? "Erro ao carregar alertas.");
      return {
        alerts: Array.isArray(body) ? body as EpiAlert[] : [],
        warning
      };
    }
  });
  const alerts = useMemo(() => data?.alerts ?? [], [data?.alerts]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AlertStatus }) => {
      const response = await fetch("/api/alertas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Erro ao atualizar alerta.");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] })
  });

  const pending  = alerts.filter(isActive).length;
  const critical = alerts.filter((a) => a.severity === "critical" && isActive(a)).length;
  const investigating = alerts.filter((a) => alertStatus(a) === "em_investigacao").length;
  const visible  = useMemo(() => {
    if (filter === "active") return alerts.filter(isActive);
    if (filter === "critical") return alerts.filter((a) => a.severity === "critical" && isActive(a));
    if (filter !== "all") return alerts.filter((a) => alertStatus(a) === filter);
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
              <p className="text-muted-foreground">Ativos</p>
              <p className="text-lg font-semibold tabular-nums">{pending}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Críticos</p>
              <p className="text-lg font-semibold tabular-nums text-red-600">{critical}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-muted-foreground">Investigação</p>
              <p className="text-lg font-semibold tabular-nums">{investigating}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap gap-2 rounded-md border bg-card p-1">
          {[
            { id: "active",  label: "Ativos" },
            { id: "critical", label: "Críticos" },
            { id: "em_investigacao", label: "Em investigação" },
            { id: "confirmado", label: "Confirmados" },
            { id: "encerrado", label: "Encerrados" },
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

        {(data?.warning || error || updateStatus.error) && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex gap-3 py-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                <p className="font-medium">Verifique a fonte dos alertas</p>
                <p className="text-amber-800">
                  {data?.warning ?? error?.message ?? updateStatus.error?.message}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLoading && visible.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
              <CheckCircle className="mb-3 h-10 w-10 text-teal-600" />
              {filter === "active" ? "Nenhum alerta ativo." : "Nenhum alerta registrado neste filtro."}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {visible.map((alert) => {
            const cfg  = severityConfig[alert.severity] ?? severityConfig.warning;
            const Icon = cfg.icon;
            const status = alertStatus(alert);
            const terminal = status === "descartado" || status === "encerrado";
            return (
              <Card key={alert.id} className={terminal ? "opacity-70" : ""}>
                <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-start">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${cfg.cls}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{alert.gve}</p>
                      <Badge className={cfg.cls}>{cfg.label}</Badge>
                      <Badge className={statusConfig[status].cls}>{statusConfig[status].label}</Badge>
                      <span className="text-xs text-muted-foreground">SE {alert.se_epidemiologica}/{alert.ano}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <strong className="text-foreground">{alert.cases_current}</strong> casos registrados; média móvel de{" "}
                      <strong className="text-foreground">{alert.cases_avg.toFixed(1)}</strong> e aumento de{" "}
                      <strong className="text-foreground">{alert.increase_pct.toFixed(0)}%</strong>.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Criado em {new Date(alert.created_at).toLocaleString("pt-BR")}
                      {alert.status_updated_at ? ` · status atualizado em ${new Date(alert.status_updated_at).toLocaleString("pt-BR")}` : ""}
                    </p>
                  </div>
                  {!terminal && (
                    <div className="grid gap-2 sm:grid-cols-2 xl:w-[360px]">
                      {status === "novo" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateStatus.mutate({ id: alert.id, status: "em_investigacao" })}
                          disabled={updateStatus.isPending}
                        >
                          Investigar
                        </Button>
                      )}
                      {status !== "confirmado" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateStatus.mutate({ id: alert.id, status: "confirmado" })}
                          disabled={updateStatus.isPending}
                        >
                          Confirmar
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateStatus.mutate({ id: alert.id, status: "descartado" })}
                        disabled={updateStatus.isPending}
                      >
                        Descartar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => updateStatus.mutate({ id: alert.id, status: "encerrado" })}
                        disabled={updateStatus.isPending}
                      >
                        Encerrar
                      </Button>
                    </div>
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
