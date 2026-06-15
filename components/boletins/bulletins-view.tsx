"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, ChevronRight, Clipboard, Loader2, Newspaper, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BulletinSummary {
  id: string;
  se: number;
  ano: number;
  title: string;
  created_at: string;
}

interface BulletinDetail extends BulletinSummary {
  content: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
  return payload;
}

function BulletinDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const { data, isLoading, error } = useQuery<BulletinDetail>({
    queryKey: ["bulletin", id],
    queryFn: () => fetchJson(`/api/boletins/${id}`)
  });

  async function copyContent() {
    if (!data?.content) return;
    await navigator.clipboard.writeText(data.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} className="px-2">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <Button variant="outline" onClick={copyContent} disabled={!data?.content}>
          <Clipboard className="h-4 w-4" />
          {copied ? "Copiado" : "Copiar texto"}
        </Button>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando boletim...
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-900">
          <CardContent className="py-4 text-sm">{error instanceof Error ? error.message : "Erro ao carregar boletim."}</CardContent>
        </Card>
      )}

      {data && (
        <article className="rounded-lg border bg-card">
          <div className="border-b p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge>SE {data.se}</Badge>
              <span>{data.ano}</span>
              <span>{new Date(data.created_at).toLocaleDateString("pt-BR")}</span>
            </div>
            <h1 className="text-2xl font-semibold text-foreground">{data.title}</h1>
          </div>
          <div className="whitespace-pre-wrap p-5 text-sm leading-7 text-foreground md:p-6">{data.content}</div>
        </article>
      )}
    </div>
  );
}

export function BulletinsView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: bulletins = [], isLoading, error } = useQuery<BulletinSummary[]>({
    queryKey: ["bulletins"],
    queryFn: () => fetchJson("/api/boletins")
  });

  const generateMutation = useMutation({
    mutationFn: () => fetchJson<{ id?: string; skipped?: boolean }>("/api/boletins", { method: "POST" }),
    onSuccess: async data => {
      await queryClient.invalidateQueries({ queryKey: ["bulletins"] });
      if (data.id) setSelectedId(data.id);
    }
  });

  const latest = bulletins[0];
  const uniqueYears = useMemo(() => new Set(bulletins.map(item => item.ano)).size, [bulletins]);

  if (selectedId) {
    return <BulletinDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-teal-700" />
            <h1 className="text-2xl font-semibold text-foreground">Boletins Epidemiológicos</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Gere, revise e acompanhe boletins semanais de conjuntivites com base nos dados disponíveis do CEVESP.
          </p>
        </div>
        <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Gerar boletim
        </Button>
      </div>

      {generateMutation.error && (
        <Card className="border-red-200 bg-red-50 text-red-900">
          <CardContent className="py-4 text-sm">
            {generateMutation.error instanceof Error ? generateMutation.error.message : "Não foi possível gerar o boletim."}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total publicado</CardDescription>
            <CardTitle className="text-2xl">{bulletins.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Anos com boletim</CardDescription>
            <CardTitle className="text-2xl">{uniqueYears}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Mais recente</CardDescription>
            <CardTitle className="text-2xl">{latest ? `SE ${latest.se}/${latest.ano}` : "-"}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Histórico</CardTitle>
            <CardDescription>Abra um boletim para revisar, copiar e usar em comunicados oficiais.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["bulletins"] })}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando boletins...
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              {error instanceof Error ? error.message : "Erro ao carregar boletins."}
            </div>
          )}

          {!isLoading && bulletins.length === 0 && (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhum boletim publicado. Use o botão gerar boletim para criar a primeira versão.
            </div>
          )}

          {bulletins.map(bulletin => (
            <button
              key={bulletin.id}
              onClick={() => setSelectedId(bulletin.id)}
              className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border bg-background p-3 text-left transition hover:border-teal-500 hover:bg-teal-50/50 dark:hover:bg-teal-950/20"
            >
              <div className="rounded-md bg-teal-50 px-3 py-2 text-center text-teal-800 dark:bg-teal-950 dark:text-teal-200">
                <div className="text-xs font-medium">SE</div>
                <div className="text-lg font-semibold leading-none">{bulletin.se}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{bulletin.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {bulletin.ano} - {new Date(bulletin.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
