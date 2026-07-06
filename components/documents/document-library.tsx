"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, FileText, Loader2, RefreshCw, Search, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { categoryLabels } from "@/lib/types";

const PAGE_SIZE = 20;

type ProcessingStatus = "pending" | "indexing" | "done" | "failed";

interface Document {
  id: string;
  title: string;
  category: string;
  file_name: string;
  version: number;
  favorite: boolean;
  deleted_at: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
}

function StatusBadge({ status, error }: { status: ProcessingStatus; error: string | null }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
        <CheckCircle2 className="h-3 w-3" /> Indexado
      </span>
    );
  }
  if (status === "indexing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" /> Indexando…
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
        <Clock className="h-3 w-3" /> Aguardando
      </span>
    );
  }
  // failed
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
      title={error ?? "Erro desconhecido"}
    >
      <AlertCircle className="h-3 w-3" /> Falhou
    </span>
  );
}

export function DocumentLibrary() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("todos");
  const [skip, setSkip] = useState(0);
  const [allDocs, setAllDocs] = useState<Document[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setSkip(0);
    setAllDocs([]);
  }, [search, category]);

  const documents = useQuery<Document[]>({
    queryKey: ["documents", search, category, skip],
    queryFn: async () => {
      const params = new URLSearchParams({
        search,
        category,
        skip: String(skip),
        limit: String(PAGE_SIZE)
      });
      const response = await fetch(`/api/documents?${params}`);
      if (!response.ok) return [];
      return response.json();
    },
    // Poll every 3s while any document is still processing
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActive = data?.some(
        (d) => d.processing_status === "pending" || d.processing_status === "indexing"
      );
      return hasActive ? 3000 : false;
    }
  });

  useEffect(() => {
    if (!documents.data) return;
    if (skip === 0) {
      setAllDocs(documents.data);
    } else {
      setAllDocs((prev) => [...prev, ...documents.data!]);
    }
  }, [documents.data, skip]);

  // Merge incoming poll results into allDocs without resetting the list
  useEffect(() => {
    if (!documents.data || skip !== 0) return;
    setAllDocs((prev) => {
      if (prev.length === 0) return documents.data!;
      const incoming = new Map(documents.data!.map((d) => [d.id, d]));
      return prev.map((d) => incoming.get(d.id) ?? d);
    });
  }, [documents.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Erro ao excluir.");
    },
    onSuccess: (_, id) => {
      setAllDocs((prev) => prev.filter((document) => document.id !== id));
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  const reprocess = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/documents/${id}/reprocess`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(body.error ?? "Erro ao reprocessar."));
      }
    },
    onSuccess: (_, id) => {
      setAllDocs((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, processing_status: "pending" as ProcessingStatus, processing_error: null } : d
        )
      );
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  });

  async function handleDelete(id: string) {
    if (!confirm("Excluir este documento? A ação pode ser desfeita pelo administrador.")) return;
    setDeletingId(id);
    await remove.mutateAsync(id).finally(() => setDeletingId(null));
  }

  const hasMore = (documents.data?.length ?? 0) === PAGE_SIZE;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Biblioteca documental</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Pesquisar por título ou descrição"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="todos">Todas categorias</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-3">
          {allDocs.map((document) => (
            <div key={document.id} className="group flex items-center gap-3 rounded-md border p-3">
              <FileText className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{document.title}</p>
                <p className="text-xs text-muted-foreground">
                  v{document.version} · {document.file_name}
                  {document.processing_status === "failed" && document.processing_error && (
                    <span className="ml-2 text-red-600" title={document.processing_error}>
                      — {document.processing_error.slice(0, 60)}
                    </span>
                  )}
                </p>
              </div>

              <StatusBadge status={document.processing_status} error={document.processing_error} />
              <Badge>
                {categoryLabels[document.category as keyof typeof categoryLabels] ?? document.category}
              </Badge>
              {document.favorite && <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />}

              {document.processing_status === "failed" && (
                <button
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  title="Tentar novamente"
                  onClick={() => reprocess.mutate(document.id)}
                  disabled={reprocess.isPending}
                >
                  <RefreshCw className={`h-4 w-4 ${reprocess.isPending ? "animate-spin" : ""}`} />
                </button>
              )}

              <button
                className="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block"
                onClick={() => handleDelete(document.id)}
                disabled={deletingId === document.id}
                title="Excluir documento"
              >
                {deletingId === document.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}

          {documents.isLoading && allDocs.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">Carregando documentos...</p>
          )}
          {!documents.isLoading && allDocs.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum documento encontrado.</p>
          )}
        </div>

        {hasMore && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkip((value) => value + PAGE_SIZE)}
              disabled={documents.isFetching}
            >
              {documents.isFetching
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</>
                : "Carregar mais"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
