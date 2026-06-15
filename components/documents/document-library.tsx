"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Search, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { categoryLabels } from "@/lib/types";

const PAGE_SIZE = 20;

interface Document {
  id: string;
  title: string;
  category: string;
  file_name: string;
  version: number;
  favorite: boolean;
  deleted_at: string | null;
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
    }
  });

  useEffect(() => {
    if (!documents.data) return;
    if (skip === 0) {
      setAllDocs(documents.data);
    } else {
      setAllDocs(prev => [...prev, ...documents.data!]);
    }
  }, [documents.data, skip]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Erro ao excluir.");
    },
    onSuccess: (_, id) => {
      setAllDocs(prev => prev.filter(document => document.id !== id));
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
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={category}
            onChange={event => setCategory(event.target.value)}
          >
            <option value="todos">Todas categorias</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-3">
          {allDocs.map(document => (
            <div key={document.id} className="group flex items-center gap-3 rounded-md border p-3">
              <FileText className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{document.title}</p>
                <p className="text-xs text-muted-foreground">v{document.version} - {document.file_name}</p>
              </div>
              <Badge>{categoryLabels[document.category as keyof typeof categoryLabels] ?? document.category}</Badge>
              {document.favorite && <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" />}
              <button
                className="hidden text-muted-foreground hover:text-destructive group-hover:block"
                onClick={() => handleDelete(document.id)}
                disabled={deletingId === document.id}
                title="Excluir documento"
              >
                {deletingId === document.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
              onClick={() => setSkip(value => value + PAGE_SIZE)}
              disabled={documents.isFetching}
            >
              {documents.isFetching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando...
                </>
              ) : (
                "Carregar mais"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
