"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categoryLabels, type DocumentCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";

/** Área de arrastar arquivos; ao escolher um, abre o formulário curto de título, categoria e tags. */
export function UploadPanel({ defaultCategory = "outros" }: { defaultCategory?: DocumentCategory }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Selecione um arquivo.");
      const data = new FormData();
      data.append("file", file);
      data.append("title", title.trim() || file.name);
      data.append("category", category);
      data.append("tags", tags);
      const response = await fetch("/api/documents/upload", { method: "POST", body: data });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro desconhecido" })) as Record<string, unknown>;
        throw new Error(String(body.error ?? "Falha no upload."));
      }
      return response.json() as Promise<{ id: string; status: string }>;
    },
    onSuccess: () => {
      reset();
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["documents-counts"] });
    }
  });

  function reset() {
    setFile(null);
    setTitle("");
    setTags("");
    setClientError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function pick(selected: File | null) {
    setClientError(null);
    upload.reset();
    if (!selected) return;
    if (selected.size > MAX_FILE_SIZE) {
      setClientError(`Arquivo muito grande (máx. 50 MB). Tamanho: ${(selected.size / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }
    setFile(selected);
    setTitle(selected.name.replace(/\.[^.]+$/, ""));
    setCategory(defaultCategory);
  }

  const hasError = clientError ?? (upload.isError ? (upload.error as Error).message : null);

  return (
    <div className="space-y-3">
      <input ref={fileInputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(event) => pick(event.target.files?.[0] ?? null)} />

      {!file ? (
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border bg-card"
          )}
        >
          <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Arraste arquivos aqui · PDF, DOCX, XLSX, CSV ou TXT até 50 MB
          </p>
          <Button type="button" variant="outline" className="h-10" onClick={() => fileInputRef.current?.click()}>
            Escolher arquivo
          </Button>
          {upload.isSuccess && (
            <p role="status" className="flex items-center gap-1.5 text-sm text-teal-700">
              <CheckCircle2 className="h-4 w-4" /> Documento enviado.
            </p>
          )}
        </div>
      ) : (
        <form
          className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_200px]"
          onSubmit={(event) => { event.preventDefault(); upload.mutate(); }}
        >
          <div className="flex items-center justify-between gap-3 md:col-span-2">
            <p className="min-w-0 truncate text-sm">
              <span className="font-semibold">{file.name}</span>{" "}
              <span className="num text-muted-foreground">· {(file.size / 1024).toFixed(0)} KB</span>
            </p>
            <Button type="button" variant="ghost" size="icon" onClick={reset} aria-label="Cancelar envio">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
            Título
            <Input value={title} onChange={(event) => setTitle(event.target.value)} className="h-10" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
            Categoria
            <select
              className="h-10 rounded-lg border bg-background px-2.5 text-sm text-foreground"
              value={category}
              onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-muted-foreground md:col-span-2">
            Tags (separadas por vírgula)
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tracoma, campo, município" className="h-10" />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" className="h-11" disabled={upload.isPending}>
              {upload.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</> : <><UploadCloud className="h-4 w-4" /> Enviar documento</>}
            </Button>
          </div>
        </form>
      )}

      {hasError && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">{hasError}</p>
      )}
    </div>
  );
}
