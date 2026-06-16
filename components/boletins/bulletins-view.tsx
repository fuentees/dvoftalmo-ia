"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Calendar, ChevronRight, Clipboard, Eye, Loader2,
  Newspaper, Plus, Printer, RefreshCw, RotateCcw
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Agravo = "conjuntivite" | "tracoma";

interface BulletinSummary {
  id: string;
  se: number;
  ano: number;
  agravo: Agravo;
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

function lastCompleteWeek(now = new Date()) {
  const ano = now.getFullYear();
  const week = Math.ceil((now.getTime() - new Date(ano, 0, 1).getTime()) / (7 * 864e5));
  return { ano, se: Math.max(1, week - 1) };
}

// ──── Markdown component map — blue institutional style ───────────────────────
const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
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

// ──── Configs per disease ─────────────────────────────────────────────────────
const AGRAVO_CONFIG = {
  conjuntivite: {
    label: "Conjuntivite",
    subtitle: "Boletim semanal — CEVESP/SES-SP",
    divisionLabel: "Divisão de Doenças de Transmissão Respiratória e Ocular",
    headerClass: "bg-blue-900",
    badgeClass: "bg-blue-700 text-white hover:bg-blue-700",
    accentClass: "bg-blue-700",
    cardClass: "border-blue-100",
    seLabel: (se: number, ano: number) => `SE ${String(se).padStart(2, "0")}/${ano}`,
    seDisplay: (se: number) => String(se).padStart(2, "0"),
  },
  tracoma: {
    label: "Tracoma",
    subtitle: "Boletim anual — SINAN/SES-SP",
    divisionLabel: "Divisão de Doenças Oculares — Programa de Eliminação do Tracoma",
    headerClass: "bg-teal-900",
    badgeClass: "bg-teal-700 text-white hover:bg-teal-700",
    accentClass: "bg-teal-600",
    cardClass: "border-teal-100",
    seLabel: (_se: number, ano: number) => `Ano ${ano}`,
    seDisplay: (_se: number) => "ANO",
  },
};

// ──── BulletinDetail ──────────────────────────────────────────────────────────
function BulletinDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<BulletinDetail>({
    queryKey: ["bulletin", id],
    queryFn: () => fetchJson(`/api/boletins/${id}`)
  });

  const regenerateMutation = useMutation({
    mutationFn: () => {
      if (!data) throw new Error("Boletim não carregado");
      const body: Record<string, unknown> = { agravo: data.agravo, force: true };
      if (data.agravo === "conjuntivite") { body.se = data.se; body.ano = data.ano; }
      else { body.ano = data.ano; }
      return fetchJson<{ ok: boolean; error?: string }>(
        "/api/boletins",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bulletin", id] });
      await queryClient.invalidateQueries({ queryKey: ["bulletins", data?.agravo] });
    }
  });

  async function copyContent() {
    if (!data?.content) return;
    await navigator.clipboard.writeText(data.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const cfg = data ? AGRAVO_CONFIG[data.agravo] : AGRAVO_CONFIG.conjuntivite;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      {/* Action bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" onClick={onBack} className="px-2">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => regenerateMutation.mutate()}
            disabled={!data || regenerateMutation.isPending}
            title="Regera o conteúdo com os dados mais recentes"
          >
            {regenerateMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />}
            {regenerateMutation.isPending ? "Gerando…" : "Regenerar"}
          </Button>
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

      {regenerateMutation.error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 print:hidden">
          {regenerateMutation.error instanceof Error ? regenerateMutation.error.message : "Erro ao regenerar."}
        </div>
      )}

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
          {/* Top strip */}
          <div className={`flex flex-wrap items-center justify-between gap-2 bg-blue-950 px-5 py-2 text-[11px] text-blue-200`}>
            <div className="flex items-center gap-2 font-medium tracking-wide">
              <span className="text-white">ESTADO DE SÃO PAULO</span>
              <span>·</span>
              <span>Secretaria de Estado da Saúde</span>
            </div>
            <span>Centro de Vigilância Epidemiológica &quot;Prof. Alexandre Vranjac&quot;</span>
          </div>

          {/* Header */}
          <div className={`relative overflow-hidden ${cfg.headerClass} px-6 pb-7 pt-5 text-white`}>
            <div className="pointer-events-none absolute right-4 top-0 select-none text-[9rem] font-black leading-none text-white/10" aria-hidden>
              {cfg.seDisplay(data.se)}
            </div>
            <div className="relative flex items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-widest opacity-60">
                  {cfg.divisionLabel}
                </p>
                <h1 className="text-3xl font-black leading-tight md:text-4xl">
                  Boletim<br />Epidemiológico
                </h1>
                <p className="mt-1 text-sm opacity-75">{cfg.subtitle}</p>
              </div>
              <div className="text-right">
                <div className="text-xs opacity-60">
                  {data.agravo === "tracoma" ? "Ano de referência" : "Semana Epidemiológica"}
                </div>
                <div className="text-4xl font-black text-white/90">
                  {data.agravo === "tracoma" ? data.ano : String(data.se).padStart(2, "0")}
                </div>
                {data.agravo === "conjuntivite" && (
                  <div className="text-sm font-semibold opacity-75">{data.ano}</div>
                )}
                <div className="mt-1 text-[11px] opacity-50">
                  Emitido em {new Date(data.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
            </div>
          </div>

          {/* Title strip */}
          <div className={`${cfg.accentClass} border-b-4 border-opacity-80 px-6 py-4 text-white`}
               style={{ borderBottomColor: "rgba(255,255,255,0.2)" }}>
            <h2 className="text-base font-bold leading-snug md:text-lg">{data.title}</h2>
          </div>

          {/* Content */}
          <div className="px-6 pb-8 pt-6 md:px-8">
            <ReactMarkdown components={mdComponents}>{data.content}</ReactMarkdown>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-blue-100 bg-blue-50 px-6 py-3 text-[11px] text-blue-700">
            <span>Centro de Vigilância Epidemiológica &quot;Prof. Alexandre Vranjac&quot; | CCD/SES-SP</span>
            <span className="text-blue-400">{cfg.seLabel(data.se, data.ano)}</span>
          </div>
        </article>
      )}
    </div>
  );
}

// ──── GenerateButton ──────────────────────────────────────────────────────────
function GenerateButton({
  agravo,
  onSuccess
}: {
  agravo: Agravo;
  onSuccess: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const nextSE = useMemo(() => lastCompleteWeek(), []);
  const [skipped, setSkipped] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ id?: string; skipped?: boolean; se: number; ano: number; agravo: Agravo }>(
        "/api/boletins",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agravo }) }
      ),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ["bulletins", agravo] });
      setSkipped(Boolean(result.skipped));
      if (result.id) onSuccess(result.id);
    }
  });

  const cfg = AGRAVO_CONFIG[agravo];
  const hint = agravo === "tracoma"
    ? `Ano ${new Date().getFullYear()}`
    : `Próxima SE: ${nextSE.se}/${nextSE.ano}`;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={() => { setSkipped(false); mutation.mutate(); }}
        disabled={mutation.isPending}
        className={agravo === "tracoma" ? "bg-teal-700 hover:bg-teal-800" : "bg-blue-700 hover:bg-blue-800"}
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Gerar boletim de {cfg.label}
      </Button>
      <span className="text-xs text-muted-foreground">
        {mutation.isPending ? "Gerando…" : hint}
      </span>
      {mutation.error && (
        <span className="text-xs text-red-600">
          {mutation.error instanceof Error ? mutation.error.message : "Erro ao gerar"}
        </span>
      )}
      {skipped && !mutation.isPending && (
        <span className="text-xs text-amber-600">Boletim já existe — abrindo o existente…</span>
      )}
    </div>
  );
}

// ──── BulletinList ────────────────────────────────────────────────────────────
function BulletinList({ agravo, onSelect }: { agravo: Agravo; onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const cfg = AGRAVO_CONFIG[agravo];

  const { data: bulletins = [], isLoading, error } = useQuery<BulletinSummary[]>({
    queryKey: ["bulletins", agravo],
    queryFn: () => fetchJson(`/api/boletins?agravo=${agravo}`)
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando boletins…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        {error instanceof Error ? error.message : "Erro ao carregar boletins."}
      </div>
    );
  }

  if (bulletins.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nenhum boletim de {cfg.label.toLowerCase()} publicado ainda.
        <br />Use o botão acima para gerar o primeiro.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {bulletins.map(b => (
        <button
          key={b.id}
          onClick={() => onSelect(b.id)}
          className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border bg-background p-3 text-left transition hover:border-${agravo === "tracoma" ? "teal" : "blue"}-500 hover:bg-${agravo === "tracoma" ? "teal" : "blue"}-50/50`}
        >
          <div className={`rounded-md px-3 py-2 text-center text-white ${agravo === "tracoma" ? "bg-teal-800" : "bg-blue-900"}`}>
            <div className="text-[10px] font-medium tracking-widest opacity-60">
              {agravo === "tracoma" ? "ANO" : "SE"}
            </div>
            <div className="text-lg font-bold leading-none">
              {agravo === "tracoma" ? b.ano : String(b.se).padStart(2, "0")}
            </div>
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{b.title}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {b.ano} · {new Date(b.created_at).toLocaleDateString("pt-BR")}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      ))}
      <div className="pt-1 text-right">
        <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["bulletins", agravo] })}>
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </Button>
      </div>
    </div>
  );
}

// ──── BulletinsView (main export) ─────────────────────────────────────────────
export function BulletinsView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Agravo>("conjuntivite");

  if (selectedId) {
    return <BulletinDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const tabs: { id: Agravo; label: string; icon: React.ReactNode }[] = [
    { id: "conjuntivite", label: "Conjuntivite", icon: <Eye className="h-4 w-4" /> },
    { id: "tracoma",      label: "Tracoma",       icon: <Newspaper className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">

      {/* Page header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Newspaper className="h-6 w-6 text-blue-700" />
          <h1 className="text-2xl font-semibold text-foreground">Boletins Epidemiológicos</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Boletins gerados automaticamente com base nos dados do CEVESP (conjuntivite) e SINAN (tracoma) — CVE/SES-SP.
        </p>
      </div>

      {/* Disease tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? tab.id === "tracoma"
                  ? "bg-teal-800 text-white shadow"
                  : "bg-blue-800 text-white shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content per tab */}
      <div className="space-y-4">
        {/* Header strip for active disease */}
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ${
          activeTab === "tracoma" ? "bg-teal-50 border border-teal-100" : "bg-blue-50 border border-blue-100"
        }`}>
          <div>
            <div className={`text-sm font-semibold ${activeTab === "tracoma" ? "text-teal-900" : "text-blue-900"}`}>
              {AGRAVO_CONFIG[activeTab].label}
            </div>
            <div className="text-xs text-muted-foreground">{AGRAVO_CONFIG[activeTab].subtitle}</div>
          </div>
          <GenerateButton agravo={activeTab} onSuccess={id => setSelectedId(id)} />
        </div>

        {/* Bulletin list */}
        <Card className={activeTab === "tracoma" ? "border-teal-100" : "border-blue-100"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Histórico</CardTitle>
            <CardDescription>
              Clique em um boletim para ler, imprimir ou copiar o conteúdo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BulletinList agravo={activeTab} onSelect={id => setSelectedId(id)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
