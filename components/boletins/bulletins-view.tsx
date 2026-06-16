"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, ChevronRight, Clipboard, Loader2, Newspaper, Plus, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
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

function getLastCompleteEpidemiologicalWeek(now = new Date()) {
  const ano = now.getFullYear();
  const week = Math.ceil((now.getTime() - new Date(ano, 0, 1).getTime()) / (7 * 864e5));
  return { ano, se: Math.max(1, week - 1) };
}

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => (
    <h1 className="mb-4 mt-6 text-xl font-bold text-foreground first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-6 border-b border-teal-200 pb-1 text-base font-semibold text-teal-800 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 font-semibold text-foreground">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-sm leading-relaxed text-foreground">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-foreground">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-teal-500 pl-4 italic text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-t border-border" />,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-teal-200 bg-teal-50 px-3 py-1.5 text-left font-semibold text-teal-800">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-1.5 text-foreground">{children}</td>
  ),
};

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
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
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
        <article className="rounded-lg border bg-card shadow-sm">
          <div className="border-b bg-teal-50/50 p-5">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge className="bg-teal-700 text-white hover:bg-teal-700">SE {data.se}</Badge>
              <span>{data.ano}</span>
              <span>·</span>
              <span>Emitido em {new Date(data.created_at).toLocaleDateString("pt-BR")}</span>
            </div>
            <h1 className="text-xl font-semibold text-foreground">{data.title}</h1>
          </div>
          <div className="p-5 md:p-6">
            <ReactMarkdown components={mdComponents}>{data.content}</ReactMarkdown>
          </div>
        </article>
      )}
    </div>
  );
}

export function BulletinsView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skippedSE, setSkippedSE] = useState<{ se: number; ano: number } | null>(null);
  const queryClient = useQueryClient();

  const nextSE = useMemo(() => getLastCompleteEpidemiologicalWeek(), []);

  const { data: bulletins = [], isLoading, error } = useQuery<BulletinSummary[]>({
    queryKey: ["bulletins"],
    queryFn: () => fetchJson("/api/boletins")
  });

  const generateMutation = useMutation({
    mutationFn: () => fetchJson<{ id?: string; skipped?: boolean; se: number; ano: number }>("/api/boletins", { method: "POST" }),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ["bulletins"] });
      if (result.skipped) {
        setSkippedSE({ se: result.se, ano: result.ano });
      }
      if (result.id) setSelectedId(result.id);
    }
  });

  const uniqueYears = useMemo(() => new Set(bulletins.map(b => b.ano)).size, [bulletins]);
  const latest = bulletins[0];

  if (selectedId) {
    return <BulletinDetail id={selectedId} onBack={() => { setSelectedId(null); setSkippedSE(null); }} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-teal-700" />
            <h1 className="text-2xl font-semibold text-foreground">Boletins Epidemiológicos</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Boletins semanais de conjuntivites gerados automaticamente com base nos dados do CEVESP.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => { setSkippedSE(null); generateMutation.mutate(); }} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Gerar boletim
          </Button>
          <span className="text-xs text-muted-foreground">
            {generateMutation.isPending ? "Gerando…" : `Próxima SE: ${nextSE.se}/${nextSE.ano}`}
          </span>
        </div>
      </div>

      {generateMutation.error && (
        <Card className="border-red-200 bg-red-50 text-red-900">
          <CardContent className="py-4 text-sm">
            {generateMutation.error instanceof Error ? generateMutation.error.message : "Não foi possível gerar o boletim."}
          </CardContent>
        </Card>
      )}

      {skippedSE && (
        <Card className="border-amber-200 bg-amber-50 text-amber-900">
          <CardContent className="py-3 text-sm">
            Já existe um boletim para a SE {skippedSE.se}/{skippedSE.ano}. Abrindo o existente…
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
            <CardTitle className="text-2xl">{uniqueYears || "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Boletim mais recente</CardDescription>
            <CardTitle className="text-2xl">{latest ? `SE ${latest.se}/${latest.ano}` : "—"}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Histórico</CardTitle>
            <CardDescription>Clique em um boletim para ler, copiar e usar em comunicados.</CardDescription>
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
              Nenhum boletim publicado ainda. Use o botão acima para gerar o primeiro.
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
                  {bulletin.ano} · {new Date(bulletin.created_at).toLocaleDateString("pt-BR")}
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
