"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react";

interface EpiAlert {
  id: string;
  gve: string;
  se: number;
  ano: number;
  cases: number;
  moving_avg: number;
  pct_increase: number;
  severity: "low" | "medium" | "high";
  acknowledged: boolean;
  created_at: string;
}

const severityConfig = {
  high:   { label: "Alta",   icon: AlertCircle,   cls: "text-red-600 bg-red-50 border-red-200" },
  medium: { label: "Média",  icon: AlertTriangle, cls: "text-amber-600 bg-amber-50 border-amber-200" },
  low:    { label: "Baixa",  icon: Info,          cls: "text-blue-600 bg-blue-50 border-blue-200" }
};

export function AlertsView() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending">("pending");

  const { data: alerts = [], isLoading } = useQuery<EpiAlert[]>({
    queryKey: ["alerts"],
    queryFn:  () => fetch("/api/alertas").then(r => r.json())
  });

  const ack = useMutation({
    mutationFn: (id: string) => fetch("/api/alertas", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id })
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] })
  });

  const visible = filter === "pending" ? alerts.filter(a => !a.acknowledged) : alerts;
  const pending = alerts.filter(a => !a.acknowledged).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-teal-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Alertas Epidemiológicos</h1>
          {pending > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5">{pending}</span>
          )}
        </div>
        <div className="flex gap-2">
          {(["pending", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${filter === f ? "bg-teal-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>
              {f === "pending" ? "Pendentes" : "Todos"}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-gray-500">Carregando alertas...</div>
      )}

      {!isLoading && visible.length === 0 && (
        <div className="text-center py-16">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">
            {filter === "pending" ? "Nenhum alerta pendente." : "Nenhum alerta registrado."}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {visible.map(alert => {
          const cfg = severityConfig[alert.severity];
          const Icon = cfg.icon;
          return (
            <div key={alert.id}
              className={`rounded-xl border p-4 flex items-start gap-4 transition-opacity ${alert.acknowledged ? "opacity-50" : ""} ${cfg.cls}`}>
              <Icon className="w-5 h-5 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{alert.gve}</span>
                  <span className="text-xs opacity-70">SE {alert.se}/{alert.ano}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.cls}`}>
                    {cfg.label}
                  </span>
                </div>
                <p className="text-sm mt-1">
                  <strong>{alert.cases}</strong> casos registrados (média móvel: {alert.moving_avg.toFixed(1)}) —
                  aumento de <strong>{alert.pct_increase.toFixed(0)}%</strong>
                </p>
                <p className="text-xs mt-1 opacity-60">
                  {new Date(alert.created_at).toLocaleString("pt-BR")}
                </p>
              </div>
              {!alert.acknowledged && (
                <button onClick={() => ack.mutate(alert.id)}
                  disabled={ack.isPending}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-white/70 hover:bg-white border border-current font-medium transition-colors">
                  Reconhecer
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
