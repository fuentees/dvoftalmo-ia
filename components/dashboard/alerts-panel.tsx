"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Bell, CheckCircle } from "lucide-react";
import Link from "next/link";

interface EpiAlert {
  id: string;
  gve: string;
  se: number;
  ano: number;
  pct_increase: number;
  severity: "low" | "medium" | "high";
  acknowledged: boolean;
  created_at: string;
}

const severityIcon = {
  high:   <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />,
  medium: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />,
  low:    <Bell className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
};

export function AlertsPanel() {
  const qc = useQueryClient();

  const { data: alerts = [] } = useQuery<EpiAlert[]>({
    queryKey: ["alerts-dashboard"],
    queryFn:  () => fetch("/api/alertas").then(r => r.ok ? r.json() : []),
    staleTime: 2 * 60 * 1000
  });

  const ack = useMutation({
    mutationFn: (id: string) => fetch("/api/alertas", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id })
    }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts-dashboard"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
    }
  });

  const pending = alerts.filter(a => !a.acknowledged);

  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-red-800 dark:text-red-400 flex items-center gap-2">
          <Bell className="h-4 w-4" />
          {pending.length} alerta{pending.length > 1 ? "s" : ""} pendente{pending.length > 1 ? "s" : ""}
        </h3>
        <Link href="/alertas" className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium">
          Ver todos
        </Link>
      </div>
      <div className="space-y-2">
        {pending.slice(0, 3).map(a => (
          <div key={a.id} className="flex items-start gap-2 text-sm text-red-800 dark:text-red-300">
            {severityIcon[a.severity]}
            <span className="flex-1">
              <strong>{a.gve}</strong> — SE {a.se}/{a.ano} (+{a.pct_increase.toFixed(0)}%)
            </span>
            <button onClick={() => ack.mutate(a.id)} disabled={ack.isPending}
              className="shrink-0 ml-2 text-xs text-red-600 hover:text-red-700 dark:text-red-400">
              <CheckCircle className="h-4 w-4" />
            </button>
          </div>
        ))}
        {pending.length > 3 && (
          <p className="text-xs text-red-600 dark:text-red-400 pl-6">
            + {pending.length - 3} alerta{pending.length - 3 > 1 ? "s" : ""} adiciona{pending.length - 3 > 1 ? "is" : "l"}
          </p>
        )}
      </div>
    </div>
  );
}
