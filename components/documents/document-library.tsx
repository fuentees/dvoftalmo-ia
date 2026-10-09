"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Search, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadPanel } from "@/components/documents/upload-panel";
import { categoryLabels, type DocumentCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

interface Document {
  id: string;
  title: string;
  category: string;
  file_name: string | null;
  mime_type: string | null;
  version: number;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface Counts {
  total: number;
  byCategory: Record<string, number>;
  favorites: number;
}

type Selecao = "todos" | "favoritos" | DocumentCategory;

function extensao(document: Document) {
  const ext = document.file_name?.split(".").pop()?.toUpperCase() ?? "";
  if (ext === "DOCX") return "DOC";
  if (ext === "XLSX") return "XLS";
  return ext.slice(0, 4) || "ARQ";
}

export function DocumentLibrary() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selecao, setSelecao] = useState<Selecao>("todos");
  const [skip, setSkip] = useState(0);
  const [allDocs, setAllDocs] = useState<Document[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setSkip(0);
    setAllDocs([]);
  }, [search, selecao]);

  const counts = useQuery<Counts>({
    queryKey: ["documents-counts"],
    queryFn: async () => {
      const response = await fetch("/api/documents?counts=1");
      if (!response.ok) return { total: 0, byCategory: {}, favorites: 0 };
      return response.json();
    }
  });

  const documents = useQuery<Document[]>({
    queryKey: ["documents", search, selecao, skip],
    queryFn: async () => {
      const params = new URLSearchParams({
        search,
        category: selecao === "favoritos" ? "todos" : selecao,
        skip: String(skip),
        limit: String(PAGE_SIZE)
      });
      if (selecao === "favoritos") params.set("favorite", "1");
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
      setAllDocs((prev) => [...prev, ...documents.data!]);
    }
  }, [documents.data, skip]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["documents-counts"] });
  }

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Erro ao excluir.");
    },
    onSuccess: (_, id) => {
      setAllDocs((prev) => prev.filter((document) => document.id !== id));
      refresh();
    }
  });

  const favorite = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const response = await fetch("/api/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, favorite: value })
      });
      if (!response.ok) throw new Error("Só quem enviou o documento pode marcar como favorito.");
    },
    onSuccess: (_, { id, value }) => {
      setAllDocs((prev) => prev.map((document) => (document.id === id ? { ...document, favorite: value } : document)));
      queryClient.invalidateQueries({ queryKey: ["documents-counts"] });
    }
  });

  async function run(id: string, action: () => Promise<unknown>) {
    setActionError(null);
    setBusyId(id);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownload(id: string) {
    const response = await fetch(`/api/documents?download=${id}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Falha ao baixar.");
    window.open(data.url, "_blank", "noopener");
  }

  function handleDelete(id: string) {
    if (!confirm("Excluir este documento? A ação pode ser desfeita pelo administrador.")) return;
    void run(id, () => remove.mutateAsync(id));
  }

  const hasMore = (documents.data?.length ?? 0) === PAGE_SIZE;
  const itens: Array<{ id: Selecao; label: string; count: number | undefined }> = [
    { id: "todos", label: "Todos", count: counts.data?.total },
    ...(Object.entries(categoryLabels) as Array<[DocumentCategory, string]>).map(([id, label]) => ({
      id,
      label,
      count: counts.data?.byCategory[id] ?? (counts.data ? 0 : undefined)
    })),
    { id: "favoritos", label: "Favoritos", count: counts.data?.favorites }
  ];

  return (
    <div className="grid items-start gap-6 md:grid-cols-[220px_1fr]">
      <nav aria-label="Categorias" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {itens.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={selecao === item.id ? "page" : undefined}
            onClick={() => setSelecao(item.id)}
            className={cn(
              "flex h-10 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-sm transition-colors",
              selecao === item.id ? "bg-secondary font-semibold text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              item.id === "favoritos" && "md:mt-2 md:border-t md:pt-2"
            )}
          >
            <span className="flex items-center gap-2">
              {item.id === "favoritos" && <Star className="h-4 w-4" aria-hidden="true" />}
              {item.label}
            </span>
            {item.count !== undefined && <span className="num text-xs">{item.count.toLocaleString("pt-BR")}</span>}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        <label className="relative block">
          <span className="sr-only">Buscar documentos</span>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="h-11 pl-9"
            placeholder="Buscar documentos por título ou descrição"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <UploadPanel
          key={selecao}
          defaultCategory={selecao === "todos" || selecao === "favoritos" ? "outros" : selecao}
        />

        {actionError && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700">{actionError}</p>
        )}

        <section className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Documento</th>
                <th className="px-4 py-3 font-semibold">Categoria</th>
                <th className="px-4 py-3 font-semibold">Enviado</th>
                <th className="px-4 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {allDocs.map((document) => (
                <tr key={document.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="num flex h-9 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-semibold text-secondary-foreground">
                        {extensao(document)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{document.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {document.file_name ?? "sem arquivo"} · v{document.version}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    {categoryLabels[document.category as DocumentCategory] ?? document.category}
                  </td>
                  <td className="num whitespace-nowrap px-4 py-3 text-[13px] text-muted-foreground">
                    {new Date(document.created_at).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={document.favorite ? "Tirar dos favoritos" : "Marcar como favorito"}
                        aria-pressed={document.favorite}
                        disabled={busyId === document.id}
                        onClick={() => void run(document.id, () => favorite.mutateAsync({ id: document.id, value: !document.favorite }))}
                      >
                        <Star className={cn("h-4 w-4", document.favorite && "fill-amber-400 text-amber-500")} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Baixar ${document.title}`}
                        disabled={busyId === document.id || !document.file_name}
                        onClick={() => void run(document.id, () => handleDownload(document.id))}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Excluir ${document.title}`}
                        className="hover:text-destructive"
                        disabled={busyId === document.id}
                        onClick={() => handleDelete(document.id)}
                      >
                        {busyId === document.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {documents.isLoading && allDocs.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">Carregando documentos...</p>
          )}
          {!documents.isLoading && allDocs.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {search ? "Nenhum documento com essa busca." : "Nenhum documento nesta categoria ainda."}
            </p>
          )}
        </section>

        {hasMore && (
          <div className="flex justify-center">
            <Button variant="outline" className="h-10" onClick={() => setSkip((value) => value + PAGE_SIZE)} disabled={documents.isFetching}>
              {documents.isFetching ? <><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</> : "Carregar mais"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
