"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DOC_TYPES = [
  { value: "despacho", label: "Despacho" },
  { value: "relatorio", label: "Relatorio" },
  { value: "email", label: "E-mail" },
  { value: "oficio", label: "Oficio" },
  { value: "memorando", label: "Memorando" },
  { value: "analise", label: "Analise epidemiologica" },
  { value: "geral", label: "Geral" }
];

interface StyleDoc {
  id: string;
  title: string;
  content: string;
  documentType: string;
  createdAt?: string;
}

export function VictorStyleManager() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("geral");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const docs = useQuery<StyleDoc[]>({
    queryKey: ["victor-style"],
    queryFn: async () => {
      const response = await fetch("/api/victor/style");
      if (!response.ok) return [];
      return response.json();
    }
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("documentType", docType);
      form.append("title", file.name.replace(/\.[^.]+$/, ""));
      const response = await fetch("/api/victor/style", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro no upload.");
      return data;
    },
    onSuccess: () => {
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey: ["victor-style"] });
    },
    onError: (err: Error) => setUploadError(err.message)
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/victor/style?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Erro ao excluir.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["victor-style"] })
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Biblioteca de estilo — Victor
          </CardTitle>
          <CardDescription>
            Envie documentos que voce escreveu (oficios, relatorios, despachos, e-mails). O Agente Victor aprendera seu estilo de escrita com base nesses exemplos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Indexando...
                </span>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Enviar exemplo
                </>
              )}
            </Button>
          </div>

          {uploadError && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {uploadError}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Quanto mais exemplos do seu estilo voce enviar, mais precisa sera a personalizacao do Agente Victor.
          </p>
        </CardContent>
      </Card>

      {docs.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando documentos...</p>
      )}

      {!docs.isLoading && (docs.data ?? []).length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Nenhum exemplo de estilo enviado ainda.</p>
          <p className="mt-1 text-xs text-muted-foreground">Envie pelo menos 3-5 documentos para melhores resultados.</p>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {(docs.data ?? []).map((doc) => (
          <Card key={doc.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="truncate">{doc.title}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {DOC_TYPES.find((t) => t.value === doc.documentType)?.label ?? doc.documentType}
                  </span>
                  <button
                    onClick={() => remove.mutate(doc.id)}
                    className="text-muted-foreground hover:text-destructive"
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-2 text-xs text-muted-foreground">{doc.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
