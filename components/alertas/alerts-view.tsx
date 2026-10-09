"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

type AlertStatus = "novo" | "em_investigacao" | "confirmado" | "descartado" | "encerrado";
type AlertFilter = "active" | "em_investigacao" | "terminal" | "all";

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

type GenerateResponse = {
  ok: boolean;
  alerts: number;
  source?: "external" | "cache";
  ano?: number;
  se?: number;
  reason?: string;
  warning?: string;
};

const statusConfig: Record<AlertStatus, { label: string; cls: string }> = {
  novo: { label: "Pendente", cls: "border-orange-200 bg-orange-50 text-orange-700" },
  em_investigacao: { label: "Em investigação", cls: "border-blue-200 bg-blue-50 text-blue-700" },
  confirmado: { label: "Confirmado", cls: "border-red-200 bg-red-50 text-red-700" },
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

const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("pt-BR")}%`;
const dataHora = (v?: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

export function AlertsView() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<AlertFilter>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data, error, isLoading } = useQuery<AlertsResponse>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const response = await fetch("/api/alertas");
      const warning = response.headers.get("X-DvOftalmo-Warning");
      const body = await response.json().catch(() => []);
      if (!response.ok) throw new Error(body?.error ?? "Erro ao carregar alertas.");
      return { alerts: Array.isArray(body) ? (body as EpiAlert[]) : [], warning };
    }
  });
  const alerts = useMemo(() => data?.alerts ?? [], [data?.alerts]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: AlertStatus; note?: string }) => {
      const response = await fetch("/api/alertas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, note })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Erro ao atualizar alerta.");
      return body;
    },
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["alerts"] });
    }
  });
  const generateAlerts = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/alertas", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Erro ao gerar alertas.");
      return body as GenerateResponse;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] })
  });

  const pendente = (a: EpiAlert) => alertStatus(a) === "novo" || alertStatus(a) === "confirmado";
  const counts: Record<AlertFilter, number> = {
    active: alerts.filter(pendente).length,
    em_investigacao: alerts.filter((a) => alertStatus(a) === "em_investigacao").length,
    terminal: alerts.filter((a) => !isActive(a)).length,
    all: alerts.length
  };
  const visible = useMemo(() => {
    if (filter === "active") return alerts.filter((a) => alertStatus(a) === "novo" || alertStatus(a) === "confirmado");
    if (filter === "em_investigacao") return alerts.filter((a) => alertStatus(a) === "em_investigacao");
    if (filter === "terminal") return alerts.filter((a) => !isActive(a));
    return alerts;
  }, [alerts, filter]);

  // Mantém um alerta selecionado entre os visíveis
  useEffect(() => {
    if (!visible.some((a) => a.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [visible, selectedId]);
  const selected = visible.find((a) => a.id === selectedId) ?? null;
  const selectedStatus = selected ? alertStatus(selected) : null;
  const terminal = selectedStatus === "descartado" || selectedStatus === "encerrado";

  function decide(status: AlertStatus) {
    if (!selected) return;
    updateStatus.mutate({ id: selected.id, status, note: note.trim() || undefined });
  }

  const aviso = data?.warning || error || updateStatus.error || generateAlerts.error || generateAlerts.data?.warning || generateAlerts.data?.reason;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <PageHeader
        title="Alertas"
        description="Aumentos acima do esperado, verificados toda segunda-feira. Cada alerta precisa de uma decisão registrada."
        action={
          <Button variant="outline" className="h-11" onClick={() => generateAlerts.mutate()} disabled={generateAlerts.isPending}>
            {generateAlerts.isPending ? "Verificando..." : "Verificar agora"}
          </Button>
        }
      />

      {aviso && (
        <p role="status" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {generateAlerts.data
              ? `${generateAlerts.data.alerts.toLocaleString("pt-BR")} alerta(s) na SE ${generateAlerts.data.se ?? "-"}/${generateAlerts.data.ano ?? "-"}. ${generateAlerts.data.reason ?? generateAlerts.data.warning ?? ""}`
              : data?.warning ?? error?.message ?? updateStatus.error?.message ?? generateAlerts.error?.message}
          </span>
        </p>
      )}

      <div role="tablist" aria-label="Situação do alerta" className="flex flex-wrap gap-2">
        {([
          { id: "active", label: "Pendentes" },
          { id: "em_investigacao", label: "Em investigação" },
          { id: "terminal", label: "Encerrados" },
          { id: "all", label: "Todos" }
        ] as Array<{ id: AlertFilter; label: string }>).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "h-10 rounded-full border px-4 text-sm transition-colors",
              filter === item.id ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-input bg-card hover:bg-muted"
            )}
          >
            {item.label} <span className="num">{counts[item.id].toLocaleString("pt-BR")}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-5" aria-busy="true">
          <div className="space-y-2.5 lg:col-span-2">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
          <div className="h-80 animate-pulse rounded-xl bg-muted lg:col-span-3" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-14 text-center text-sm text-muted-foreground">
          <CheckCircle className="mb-3 h-10 w-10 text-teal-600" aria-hidden="true" />
          {filter === "active" ? "Nenhum alerta pendente." : "Nenhum alerta neste filtro."}
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          <section aria-label="Lista de alertas" className="flex flex-col gap-2.5 lg:col-span-2">
            {visible.map((alert) => {
              const status = alertStatus(alert);
              const ativo = alert.id === selectedId;
              return (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => { setSelectedId(alert.id); setNote(""); }}
                  aria-pressed={ativo}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors",
                    ativo ? "border-2 border-primary" : "hover:border-primary/40"
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold">{alert.gve}</span>
                    <Badge className={statusConfig[status].cls}>{statusConfig[status].label}</Badge>
                  </span>
                  <span className="text-[13px] text-muted-foreground">Conjuntivite · SE {alert.se_epidemiologica}/{alert.ano}</span>
                  <span className={cn("num text-[22px] font-semibold", alert.severity === "critical" ? "text-red-700" : "text-orange-700")}>{pct(alert.increase_pct)}</span>
                </button>
              );
            })}
          </section>

          {selected && (
            <section aria-label="Detalhe do alerta" className="flex flex-col gap-5 rounded-xl border bg-card p-5 lg:col-span-3">
              <div className="space-y-1">
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  {selected.severity === "critical"
                    ? <AlertCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
                    : <AlertTriangle className="h-4 w-4 text-orange-600" aria-hidden="true" />}
                  GVE {selected.gve} · {selected.severity === "critical" ? "crítico" : "atenção"}
                </span>
                <h2 className="text-[22px] font-bold leading-tight">
                  Aumento de {Math.round(selected.increase_pct).toLocaleString("pt-BR")}% na SE {selected.se_epidemiologica}/{selected.ano}
                </h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-muted/60 p-3.5"><span className="block text-xs text-muted-foreground">Casos na semana</span><span className="num text-2xl font-semibold">{selected.cases_current.toLocaleString("pt-BR")}</span></div>
                <div className="rounded-lg bg-muted/60 p-3.5"><span className="block text-xs text-muted-foreground">Esperado (média móvel)</span><span className="num text-2xl font-semibold">{selected.cases_avg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</span></div>
                <div className="rounded-lg bg-muted/60 p-3.5"><span className="block text-xs text-muted-foreground">Aumento</span><span className="num text-2xl font-semibold">{pct(selected.increase_pct)}</span></div>
              </div>

              <p className="rounded-lg bg-blue-50 p-3.5 text-sm leading-relaxed text-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
                Antes de investigar, confira se o aumento não vem de notificação duplicada ou de semana trocada nessa GVE.{" "}
                <Link href={`/conjuntivite?tab=qualidade&gve=${encodeURIComponent(selected.gve)}`} className="font-semibold underline">
                  Ver pendências da GVE
                </Link>
              </p>

              {selected.status_note && (
                <div className="rounded-lg border p-3.5 text-sm">
                  <span className="block text-xs text-muted-foreground">Última decisão · {dataHora(selected.status_updated_at)}</span>
                  {selected.status_note}
                </div>
              )}

              {!terminal && (
                <>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Registro da decisão
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      placeholder="O que foi feito e por quê"
                      className="resize-y rounded-lg border bg-background p-2.5 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {selectedStatus === "novo" && (
                      <Button className="h-11" disabled={updateStatus.isPending} onClick={() => decide("em_investigacao")}>Iniciar investigação</Button>
                    )}
                    {selectedStatus !== "confirmado" && (
                      <Button variant="outline" className="h-11" disabled={updateStatus.isPending} onClick={() => decide("confirmado")}>Confirmar surto</Button>
                    )}
                    <Button variant="outline" className="h-11" disabled={updateStatus.isPending} onClick={() => decide("descartado")}>Encerrar: erro de dado</Button>
                    <Button variant="outline" className="h-11" disabled={updateStatus.isPending} onClick={() => decide("encerrado")}>Encerrar: sem ação necessária</Button>
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">Criado em {dataHora(selected.created_at)}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
