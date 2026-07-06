"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryLabels, type DocumentCategory } from "@/lib/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export function UploadPanel() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile]         = useState<File | null>(null);
  const [title, setTitle]       = useState("");
  const [category, setCategory] = useState<DocumentCategory>("outros");
  const [tags, setTags]         = useState("");
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
      setFile(null);
      setTitle("");
      setTags("");
      setCategory("outros");
      setClientError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setClientError(null);
    if (selected && selected.size > MAX_FILE_SIZE) {
      setClientError(`Arquivo muito grande (máx. 50 MB). Tamanho: ${(selected.size / 1024 / 1024).toFixed(1)} MB.`);
      event.target.value = "";
      return;
    }
    setFile(selected);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) { setClientError("Selecione um arquivo."); return; }
    setClientError(null);
    upload.mutate();
  }

  const hasError = clientError ?? (upload.isError ? (upload.error as Error).message : null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload para base de conhecimento</CardTitle>
        <CardDescription>
          PDF, DOCX, XLSX, CSV e TXT · até 50 MB. O arquivo é enviado imediatamente; a indexação semântica acontece em segundo plano.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Manual, ofício, relatório..."
            />
          </div>
          <div className="space-y-1">
            <Label>Categoria</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Tags</Label>
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="tracoma, campo, município (separar por vírgula)"
            />
          </div>
          <div className="space-y-1">
            <Label>Arquivo</Label>
            <Input ref={fileInputRef} type="file" onChange={handleFileChange} />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 md:col-span-2">
            <Button type="submit" disabled={upload.isPending}>
              {upload.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</>
                : <><UploadCloud className="h-4 w-4" /> Enviar e indexar</>}
            </Button>

            {upload.isSuccess && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 text-blue-500" />
                Arquivo enviado. Indexação em andamento — acompanhe na lista abaixo.
              </span>
            )}
          </div>

          {hasError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2">
              {hasError}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
