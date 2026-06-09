"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { categoryLabels, type DocumentCategory } from "@/lib/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const STEPS = ["Enviando arquivo...", "Extraindo texto...", "Fragmentando conteúdo...", "Gerando embeddings..."];

export function UploadPanel() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("outros");
  const [tags, setTags] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState(0);
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

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
        const body = await response.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(body.error ?? "Falha no upload.");
      }
      return response.json() as Promise<{ id: string; chunks: number }>;
    },
    onSuccess: () => {
      setFile(null);
      setTitle("");
      setTags("");
      setCategory("outros");
      setClientError(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  useEffect(() => {
    if (upload.isPending) {
      setUploadStep(0);
      const delays = [1500, 4000, 7000];
      stepTimers.current = delays.map((ms, i) =>
        setTimeout(() => setUploadStep(i + 1), ms)
      );
    } else {
      stepTimers.current.forEach(clearTimeout);
      stepTimers.current = [];
      setUploadStep(0);
    }
    return () => { stepTimers.current.forEach(clearTimeout); };
  }, [upload.isPending]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setClientError(null);
    if (selected && selected.size > MAX_FILE_SIZE) {
      setClientError(`Arquivo muito grande (max 50 MB). Tamanho: ${(selected.size / 1024 / 1024).toFixed(1)} MB.`);
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
          PDF, DOCX, XLSX, CSV e TXT — ate 50 MB. O conteudo sera indexado para consulta semantica no Chat.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <Label>Titulo</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Manual, oficio, relatorio..."
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
              placeholder="tracoma, campo, municipio (separar por virgula)"
            />
          </div>
          <div className="space-y-1">
            <Label>Arquivo</Label>
            <Input type="file" onChange={handleFileChange} />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 md:col-span-2">
            <Button type="submit" disabled={upload.isPending}>
              {upload.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {STEPS[uploadStep]}
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4" />
                  Enviar e indexar
                </>
              )}
            </Button>

            {upload.isSuccess && upload.data && (
              <span className="flex items-center gap-1 text-sm text-green-700">
                <CheckCircle className="h-4 w-4" />
                {upload.data.chunks} trechos indexados com sucesso.
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
