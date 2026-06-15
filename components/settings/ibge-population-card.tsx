"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Database, DownloadCloud, Info, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Message = { type: "success" | "error" | "info"; text: string };

type PopulationStatus = {
  totalRows: number;
  years: number[];
  minYear: number | null;
  maxYear: number | null;
};

export function IbgePopulationCard() {
  const currentYear = new Date().getFullYear();
  const [yearStart, setYearStart] = useState("2007");
  const [yearEnd, setYearEnd] = useState(String(currentYear - 1));
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [status, setStatus] = useState<PopulationStatus | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/ibge-population-sync");
      if (response.ok) setStatus(await response.json());
    } catch {
      // Status is informational; sync can still be attempted.
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function syncPopulation() {
    const start = Number(yearStart);
    const end = Number(yearEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1900 || end < 1900) {
      setMessage({ type: "error", text: "Informe anos validos para sincronizar a populacao." });
      return;
    }

    setSyncing(true);
    setMessage({ type: "info", text: "Buscando populacao municipal no IBGE/SIDRA..." });
    try {
      const response = await fetch("/api/admin/ibge-population-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ufCode: "35", yearStart: start, yearEnd: end })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao sincronizar populacao IBGE.");
      setMessage({
        type: "success",
        text: `${Number(data.upserted ?? 0).toLocaleString("pt-BR")} registros de populacao gravados para ${data.yearStart} a ${data.yearEnd}.`
      });
      await loadStatus();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao sincronizar populacao IBGE." });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-primary" />
          Populacao IBGE
        </CardTitle>
        <CardDescription className="text-xs">
          Base municipal por ano para incidencia, taxa de deteccao e cobertura.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Para comparar anos anteriores, sincronize a populacao de todos os anos do periodo analisado.
              Se faltar algum ano, o sistema usa a populacao mais proxima disponivel e sinaliza a origem.
            </p>
          </div>
        </div>

        <div className="grid gap-2 rounded-md border bg-background p-3 text-xs sm:grid-cols-2">
          <InfoItem label="Registros" value={(status?.totalRows ?? 0).toLocaleString("pt-BR")} />
          <InfoItem
            label="Periodo carregado"
            value={status?.minYear && status.maxYear ? `${status.minYear} a ${status.maxYear}` : "sem status"}
          />
          {status?.years?.length ? (
            <div className="text-muted-foreground sm:col-span-2">
              Anos disponiveis: {status.years.join(", ")}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Ano inicial
            <input
              type="number"
              value={yearStart}
              onChange={(event) => setYearStart(event.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Ano final
            <input
              type="number"
              value={yearEnd}
              onChange={(event) => setYearEnd(event.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <Button size="sm" variant="outline" className="self-end" onClick={syncPopulation} disabled={syncing}>
            <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </Button>
        </div>

        {message && (
          <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            message.type === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : message.type === "error"
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-blue-300 bg-blue-50 text-blue-800"
          }`}>
            {message.type === "success"
              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              : message.type === "error"
                ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {message.text}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
