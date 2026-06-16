"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, ChevronRight, Clipboard, Loader2, Newspaper, Plus, Printer, RefreshCw } from "lucide-react";
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

// Markdown components with institutional blue styling (inspired by federal bulletin layout)
const bulletinMdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => (
    <h1 className="mb-4 mt-8 text-lg font-bold text-blue-900 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-8 flex items-start gap-2 text-sm font-bold uppercase tracking-wide text-blue-900 first:mt-0">
      <span className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm bg-blue-700" aria-hidden />
      <span>{children}</span>
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 font-semibold text-blue-800">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-[13px] leading-relaxed text-gray-700">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-[13px] text-gray-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px] text-gray-700">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-blue-500 bg-blue-50 px-4 py-3 text-[13px] italic text-blue-900">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-t border-blue-100" />,
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto rounded border border-blue-100">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-blue-200 bg-blue-800 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white">
      {children}
    </th>
  ),
  tr: ({ children }) => <tr className="even:bg-blue-50/30">{children}</tr>,
  td: ({ children }) => (
    <td className="border-b border-blue-50 px-3 py-2 text-gray-700">{children}</td>
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
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      {/* Action bar — hidden on print */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" onClick={onBack} className="px-2">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!data}>
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          <Button variant="outline" size="sm" onClick={copyContent} disabled={!data?.content}>
            <Clipboard className="h-4 w-4" />
            {copied ? "Copiado" : "Copiar texto"}
          </Button>
        </div>
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
          <CardContent className="py-4 text-sm">
            {error instanceof Error ? error.message : "Erro ao carregar boletim."}
          </CardContent>
        </Card>
      )}

      {data && (
        <article className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-md print:shadow-none">

          {/* ── Institutional top strip ──────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-950 px-5 py-2 text-[11px] text-blue-200">
            <div className="flex items-center gap-2 font-medium tracking-wide">
              <span className="text-white">ESTADO DE SÃO PAULO</span>
              <span>·</span>
              <span>Secretaria de Estado da Saúde</span>
            </div>
            <span>Centro de Vigilância Epidemiológica &quot;Prof. Alexandre Vranjac&quot;</span>
          </div>

          {/* ── Main header ─────────────────────────────────────── */}
          <div className="relative overflow-hidden bg-blue-900 px-6 pb-7 pt-5 text-white">
            {/* Big SE number watermark */}
            <div
              className="pointer-events-none absolute right-4 top-0 select-none text-[9rem] font-black leading-none text-white/10"
              aria-hidden
            >
              {String(data.se).padStart(2, "0")}
            </div>

            <div className="relative flex items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-widest text-blue-300">
                  Divisão de Vigilância Epidemiológica · Doenças Oculares
                </p>
                <h1 className="text-3xl font-black leading-tight md:text-4xl">
                  Boletim<br />Epidemiológico
                </h1>
              </div>
              <div className="text-right">
                <div className="text-xs text-blue-300">Semana Epidemiológica</div>
                <div className="text-4xl font-black text-white/90">{String(data.se).padStart(2, "0")}</div>
                <div className="text-sm font-semibold text-blue-200">{data.ano}</div>
                <div className="mt-1 text-[11px] text-blue-400">
                  Emitido em {new Date(data.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
            </div>
          </div>

          {/* ── Article title strip ──────────────────────────────── */}
          <div className="border-b-4 border-blue-700 bg-blue-700 px-6 py-4 text-white">
            <h2 className="text-base font-bold leading-snug md:text-lg">{data.title}</h2>
          </div>

          {/* ── Content ──────────────────────────────────────────── */}
          <div className="px-6 pb-8 pt-6 md:px-8">
            <ReactMarkdown components={bulletinMdComponents}>{data.content}</ReactMarkdown>
          </div>

          {/* ── Footer ───────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-blue-100 bg-blue-50 px-6 py-3 text-[11px] text-blue-700">
            <span>
              Centro de Vigilância Epidemiológica &quot;Prof. Alexandre Vranjac&quot; | CCD/SES-SP
            </span>
            <span className="text-blue-400">
              SE {String(data.se).padStart(2, "0")}/{data.ano}
            </span>
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
      if (result.skipped) setSkippedSE({ se: result.se, ano: result.ano });
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

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-blue-700" />
            <h1 className="text-2xl font-semibold text-foreground">Boletins Epidemiológicos</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Boletins semanais gerados automaticamente com base nos dados do CEVESP — CVE/SES-SP.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <Button
            onClick={() => { setSkippedSE(null); generateMutation.mutate(); }}
            disabled={generateMutation.isPending}
            className="bg-blue-700 hover:bg-blue-800"
          >
            {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Gerar boletim
          </Button>
          <span className="text-xs text-muted-foreground">
            {generateMutation.isPending ? "Gerando…" : `Próxima SE: ${nextSE.se}/${nextSE.ano}`}
          </span>
        </div>
      </div>

      {/* Errors */}
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

      {/* KPI cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-blue-100">
          <CardHeader className="pb-2">
            <CardDescription>Total publicado</CardDescription>
            <CardTitle className="text-2xl text-blue-900">{bulletins.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-blue-100">
          <CardHeader className="pb-2">
            <CardDescription>Anos com boletim</CardDescription>
            <CardTitle className="text-2xl text-blue-900">{uniqueYears || "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-blue-100">
          <CardHeader className="pb-2">
            <CardDescription>Boletim mais recente</CardDescription>
            <CardTitle className="text-2xl text-blue-900">{latest ? `SE ${latest.se}/${latest.ano}` : "—"}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Bulletin list */}
      <Card className="border-blue-100">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Histórico</CardTitle>
            <CardDescription>Clique em um boletim para ler, imprimir ou copiar o texto.</CardDescription>
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
              className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border bg-background p-3 text-left transition hover:border-blue-500 hover:bg-blue-50/50"
            >
              <div className="rounded-md bg-blue-900 px-3 py-2 text-center text-white">
                <div className="text-[10px] font-medium tracking-widest text-blue-300">SE</div>
                <div className="text-lg font-bold leading-none">{String(bulletin.se).padStart(2, "0")}</div>
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
