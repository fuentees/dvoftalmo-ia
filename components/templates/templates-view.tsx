"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FilePlus, Loader2, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const categories = ["oficio", "despacho", "relatorio", "email", "convite", "memorando"];

interface Template {
  id: string;
  title: string;
  category: string;
  content: string;
}

export function TemplatesView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("oficio");
  const [content, setContent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const templates = useQuery<Template[]>({
    queryKey: ["templates"],
    queryFn: async () => {
      const response = await fetch("/api/templates");
      if (!response.ok) return [];
      return response.json();
    }
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, content, isPublic: false })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao salvar template.");
      }
      return response.json();
    },
    onSuccess: () => {
      setTitle("");
      setContent("");
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (error: Error) => {
      setFormError(error.message);
    }
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) { setFormError("Informe um titulo."); return; }
    if (content.trim().length < 10) { setFormError("Conteudo deve ter ao menos 10 caracteres."); return; }
    setFormError(null);
    create.mutate();
  }

  async function copyTemplate(template: Template) {
    await navigator.clipboard.writeText(template.content);
    setCopiedId(template.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function duplicateTemplate(template: Template) {
    setTitle(`${template.title} (copia)`);
    setCategory(template.category);
    setContent(template.content);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Excluir este modelo?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/templates?id=${id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    } finally {
      setDeletingId(null);
    }
  }

  function insertTemplateInChat(template: Template) {
    localStorage.setItem("dvoftalmo_draft_message", template.content);
    router.push("/chat");
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Templates</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Modelos reutilizáveis para documentos, e-mails, convites e memorandos.</p>
        </div>
      </div>
    <div className="space-y-6 p-6">
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        {/* Formulário de criação */}
        <Card>
          <CardHeader>
            <CardTitle>Criar modelo</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1">
                <Label>Titulo</Label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Nome do modelo..."
                />
              </div>
              <div className="space-y-1">
                <Label>Categoria</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item.charAt(0).toUpperCase() + item.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Conteudo</Label>
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Texto do modelo com campos editaveis em [colchetes]..."
                  className="min-h-[160px]"
                />
              </div>
              {formError && (
                <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </p>
              )}
              <Button type="submit" disabled={create.isPending}>
                <FilePlus className="h-4 w-4" />
                {create.isPending ? "Salvando..." : "Salvar modelo"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Lista de templates */}
        <div className="space-y-3">
          {templates.isLoading && (
            <p className="py-4 text-center text-sm text-muted-foreground">Carregando modelos...</p>
          )}
          {!templates.isLoading && templates.data?.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhum modelo criado ainda.</p>
              <p className="mt-1 text-xs text-muted-foreground">Crie seu primeiro modelo no formulario ao lado.</p>
            </Card>
          )}
          {(templates.data ?? []).map((template) => (
            <Card key={template.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{template.title}</span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                    {template.category}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-3 text-sm text-muted-foreground">{template.content}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyTemplate(template)}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedId === template.id ? "Copiado!" : "Copiar"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => duplicateTemplate(template)}
                  >
                    <FilePlus className="h-4 w-4" />
                    Duplicar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => insertTemplateInChat(template)}
                  >
                    <Wand2 className="h-4 w-4" />
                    Usar no Chat
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteTemplate(template.id)}
                    disabled={deletingId === template.id}
                  >
                    {deletingId === template.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
