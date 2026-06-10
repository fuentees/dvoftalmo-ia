"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Database, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SyncStatus {
  hasData: boolean;
  lastSync: string | null;
  totalRows: number;
}

type Msg = { type: "success" | "error"; text: string };

export function CevespSyncCard() {
  const [status, setStatus]           = useState<SyncStatus | null>(null);
  const [exporting, setExporting]     = useState(false);
  const [importing, setImporting]     = useState(false);
  const [progress, setProgress]       = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg]                 = useState<Msg | null>(null);
  const fileRef                       = useRef<HTMLInputElement>(null);

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    try {
      const res = await fetch("/api/admin/cevesp-status");
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }

  async function handleExport(full: boolean) {
    setExporting(true);
    setMsg(null);
    try {
      const url = `/api/admin/cevesp-export${full ? "?full=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Erro ao exportar.");
      }
      const count = res.headers.get("X-Row-Count") ?? "?";
      const blob  = await res.blob();
      const link  = document.createElement("a");
      link.href   = URL.createObjectURL(blob);
      link.download = "cevesp-export.json";
      link.click();
      URL.revokeObjectURL(link.href);
      setMsg({ type: "success", text: `${Number(count).toLocaleString("pt-BR")} registros exportados. Leve o arquivo para casa e use "Importar".` });
    } catch (e) {
      setMsg({ type: "error", text: (e as Error).message });
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setMsg(null);
    setProgress(null);
    try {
      const text = await file.text();
      const rows = JSON.parse(text) as Record<string, unknown>[];
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Arquivo vazio ou formato inválido.");

      const BATCH = 500;
      let done = 0;
      setProgress({ done: 0, total: rows.length });

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const res = await fetch("/api/admin/cevesp-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? "Erro ao importar.");
        }
        const data = await res.json() as { upserted: number };
        done += data.upserted;
        setProgress({ done, total: rows.length });
      }

      setMsg({ type: "success", text: `${done.toLocaleString("pt-BR")} registros importados! O agente agora usa dados reais do CEVESP.` });
      await loadStatus();
    } catch (e) {
      setMsg({ type: "error", text: (e as Error).message });
    } finally {
      setImporting(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-primary" />
          Sincronização CEVESP
        </CardTitle>
        <CardDescription className="text-xs">
          Sincronize o MySQL (rede SES-SP) com o Supabase para que o agente use dados reais.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status do cache */}
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
          {status === null ? (
            <span className="text-muted-foreground">Verificando cache...</span>
          ) : status.hasData ? (
            <span className="text-green-700">
              Cache ativo — {status.totalRows.toLocaleString("pt-BR")} registros.
              {status.lastSync && ` Última sync: ${new Date(status.lastSync).toLocaleDateString("pt-BR")}.`}
            </span>
          ) : (
            <span className="text-amber-700">Cache vazio — sincronize para ativar dados reais.</span>
          )}
        </div>

        {/* Passo 1 — Exportar */}
        <div className="space-y-2">
          <p className="text-xs font-medium">
            <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">1</span>
            No escritório (rede SES-SP) — exporte o MySQL
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => handleExport(false)}
              disabled={exporting || importing}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {exporting ? "Exportando..." : "Exportar ano atual"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => handleExport(true)}
              disabled={exporting || importing}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Exportar tudo
            </Button>
          </div>
        </div>

        {/* Passo 2 — Importar */}
        <div className="space-y-2">
          <p className="text-xs font-medium">
            <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">2</span>
            Em qualquer lugar — importe o arquivo para o Supabase
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => fileRef.current?.click()}
            disabled={importing || exporting}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {importing ? "Importando..." : "Selecionar cevesp-export.json"}
          </Button>

          {progress && (
            <div className="space-y-1 pt-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress.done.toLocaleString("pt-BR")} / {progress.total.toLocaleString("pt-BR")} registros ({pct}%)
              </p>
            </div>
          )}
        </div>

        {msg && (
          <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
            msg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>
            {msg.type === "success"
              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {msg.text}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
