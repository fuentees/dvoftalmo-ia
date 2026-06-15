"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Database, FileSearch, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Bank = "traconet" | "nottraconet";

interface SinanStatus {
  hasData: boolean;
  totalRows: number;
  banks: string[];
  agravos: string[];
  years: number[];
  minYear: number | null;
  maxYear: number | null;
  municipalities: number;
  lastImports?: Array<{
    source_bank: string;
    imported_at: string;
    rows_upserted: number;
  }>;
}

interface PreviewResult {
  fileName: string;
  totalRows: number;
  columns: string[];
  years: number[];
  municipalityFields: string[];
  suggestedBank: Bank;
  traconetScore: number;
  nottraconetScore: number;
  warnings: string[];
  sampleRows: Array<Record<string, unknown>>;
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const separator = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(separator).map(item => item.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values = line.split(separator).map(item => item.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export function SinanTracomaSyncCard() {
  const [status, setStatus] = useState<SinanStatus | null>(null);
  const [bank, setBank] = useState<Bank>("traconet");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch("/api/admin/sinan-tracoma-status");
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.error ?? "Erro ao consultar status SINAN Tracoma.");
      setStatus(data);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error
          ? error.message
          : "Erro ao consultar status SINAN Tracoma. Verifique se a migration foi aplicada."
      });
    }
  }

  async function previewFile(file: File) {
    setBusy(true);
    setPreview(null);
    setPendingFile(null);
    setMessage({ type: "info", text: `Validando ${file.name} antes da importação...` });
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/sinan-tracoma-preview", {
        method: "POST",
        body: form
      });
      const data = await readResponse(response) as PreviewResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Erro ao validar arquivo.");
      setPreview(data);
      setPendingFile(file);
      setBank(data.suggestedBank);
      setMessage({
        type: data.warnings?.length ? "info" : "success",
        text: `Pré-validação concluída. Sugestão: importar como ${data.suggestedBank.toUpperCase()}.`
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao validar arquivo." });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setPreview(null);
    setPendingFile(null);
    setMessage({ type: "info", text: `Enviando ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...` });
    try {
      if (file.name.toLowerCase().endsWith(".dbf")) {
        const form = new FormData();
        form.append("bank", bank);
        form.append("file", file);
        const response = await fetch("/api/admin/sinan-tracoma-import-file", {
          method: "POST",
          body: form
        });
        const data = await readResponse(response);
        if (!response.ok) throw new Error(data.error ?? "Erro ao importar DBF.");
        setMessage({
          type: "success",
          text: `${Number(data.imported ?? 0).toLocaleString("pt-BR")} registros DBF importados em ${bank.toUpperCase()}. Status atualizado abaixo com banco, período, municípios e histórico da importação.`
        });
        await loadStatus();
        return;
      }

      const text = await file.text();
      const rows = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Arquivo vazio ou formato inválido.");

      const batchSize = 500;
      const importId = `${bank}-${Date.now()}`;
      let done = 0;
      let received = 0;
      for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize);
        const response = await fetch("/api/admin/sinan-tracoma-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bank,
            rows: batch,
            importId,
            totalRows: rows.length,
            isLastBatch: index + batchSize >= rows.length
          })
        });
        const data = await readResponse(response);
        if (!response.ok) throw new Error(data.error ?? "Erro ao importar SINAN Tracoma.");
        done += Number(data.upserted ?? 0);
        received += Number(data.received ?? batch.length);
        setMessage({ type: "info", text: `Importando ${done.toLocaleString("pt-BR")} de ${rows.length.toLocaleString("pt-BR")} registros...` });
      }
      setMessage({
        type: "success",
        text: `${done.toLocaleString("pt-BR")} registros gravados em ${bank.toUpperCase()} de ${received.toLocaleString("pt-BR")} linha(s) lida(s). Confira abaixo período, municípios, agravos detectados e últimas importações.`
      });
      await loadStatus();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Erro ao importar." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-primary" />
          SINAN Tracoma
        </CardTitle>
        <CardDescription className="text-xs">
          Importe TRACONET (casos individuais: sexo, idade, TF/TT) e NOTTRACONET (consolidado: nº examinados/positivos por localidade).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-2">
          <Info label="Registros" value={(status?.totalRows ?? 0).toLocaleString("pt-BR")} />
          <Info label="Período" value={status?.minYear && status.maxYear ? `${status.minYear} a ${status.maxYear}` : "sem dados"} />
          <Info label="Municípios" value={(status?.municipalities ?? 0).toLocaleString("pt-BR")} />
          <Info label="Bancos" value={status?.banks?.join(", ") || "nenhum"} />
          {status?.agravos?.length ? (
            <div className="text-muted-foreground sm:col-span-2">Agravos detectados: {status.agravos.join(", ")}</div>
          ) : null}
        </div>

        {status && !status.hasData ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Nenhum registro SINAN Tracoma encontrado no cache. Depois de importar, este total deve sair de 0 e o histórico abaixo deve mostrar a última importação.
          </div>
        ) : null}

        {status?.lastImports?.length ? (
          <div className="rounded-md border p-3 text-xs">
            <div className="mb-2 font-medium">Últimas importações</div>
            <div className="space-y-1 text-muted-foreground">
              {status.lastImports.map((item, index) => (
                <div key={`${item.imported_at}-${index}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{item.source_bank.toUpperCase()}</span>
                  <span>{Number(item.rows_upserted ?? 0).toLocaleString("pt-BR")} registros</span>
                  <span>{formatDateTime(item.imported_at)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <select className="h-8 rounded-md border bg-background px-2 text-xs" value={bank} onChange={event => setBank(event.target.value as Bank)}>
            <option value="traconet">TRACONET - Casos individuais (TF/TT/sexo/idade)</option>
            <option value="nottraconet">NOTTRACONET - Consolidado (nº examinados/positivos)</option>
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".dbf,.json,.csv"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void previewFile(file);
            }}
          />
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
            <FileSearch className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Processando..." : "Validar arquivo"}
          </Button>
        </div>

        {preview && (
          <div className="space-y-3 rounded-md border bg-background p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{preview.fileName}</div>
                <div className="text-muted-foreground">
                  {preview.totalRows.toLocaleString("pt-BR")} registros - {preview.columns.length} colunas
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border px-2 py-0.5">TRACONET {preview.traconetScore}</span>
                <span className="rounded-full border px-2 py-0.5">NOTTRACONET {preview.nottraconetScore}</span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Info label="Banco sugerido" value={preview.suggestedBank.toUpperCase()} />
              <Info label="Banco selecionado" value={bank.toUpperCase()} />
              <Info label="Anos detectados" value={preview.years.join(", ") || "não identificado"} />
              <Info label="Campos município" value={preview.municipalityFields.join(", ") || "não identificado"} />
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                <div className="mb-1 flex items-center gap-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Atenção antes de importar
                </div>
                <ul className="list-disc space-y-1 pl-4">
                  {preview.warnings.map(warning => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Ver colunas reconhecidas
              </summary>
              <p className="mt-2 max-h-24 overflow-auto break-all font-mono text-[11px] text-muted-foreground">
                {preview.columns.join(", ")}
              </p>
            </details>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-8 text-xs" disabled={busy || !pendingFile} onClick={() => pendingFile && void importFile(pendingFile)}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Confirmar importação como {bank.toUpperCase()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setPendingFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {message && (
          <div className={`rounded-md border px-3 py-2 text-xs ${
            message.type === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : message.type === "error"
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-blue-300 bg-blue-50 text-blue-800"
          }`}>
            {message.text}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function readResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
