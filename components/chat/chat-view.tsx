"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Download, FileUp, Pencil, Search, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { agentLabels, type AgentKind } from "@/lib/types";

// Simple Markdown renderer — handles the most common AI output patterns
function MarkdownText({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  function renderInline(text: string): React.ReactNode[] {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={idx}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*"))
        return <em key={idx}>{part.slice(1, -1)}</em>;
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={idx} className="rounded bg-muted px-1 font-mono text-xs">{part.slice(1, -1)}</code>;
      return part;
    });
  }

  while (i < lines.length) {
    const line = lines[i];
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    const bullet = line.match(/^\s*[-*•] (.+)/);
    const numbered = line.match(/^\s*(\d+)\. (.+)/);
    const hr = line.match(/^---+$/);

    if (h1) {
      elements.push(<h3 key={i} className="mt-3 mb-1 text-base font-bold">{h1[1]}</h3>);
    } else if (h2) {
      elements.push(<h4 key={i} className="mt-2 mb-0.5 text-sm font-bold">{h2[1]}</h4>);
    } else if (h3) {
      elements.push(<h5 key={i} className="mt-2 mb-0.5 text-sm font-semibold">{h3[1]}</h5>);
    } else if (hr) {
      elements.push(<hr key={i} className="my-2 border-border" />);
    } else if (bullet) {
      elements.push(<div key={i} className="flex gap-1.5"><span className="mt-1 shrink-0">•</span><span>{renderInline(bullet[1])}</span></div>);
    } else if (numbered) {
      elements.push(<div key={i} className="flex gap-1.5"><span className="shrink-0 font-medium">{numbered[1]}.</span><span>{renderInline(numbered[2])}</span></div>);
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="leading-6">{renderInline(line)}</p>);
    }
    i++;
  }

  return <div className="space-y-0.5 text-sm">{elements}</div>;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ title: string; score: number }>;
}

interface Conversation {
  id: string;
  title: string;
  agent: AgentKind;
  updated_at: string;
}

const SUGGESTIONS: Record<AgentKind, string[]> = {
  geral:          ["Quais são os protocolos de conjuntivite?", "Como notificar um surto?", "O que é tracoma?"],
  documentos:     ["Resumir os documentos sobre vigilância", "Protocolos de triagem ocular", "Normas de notificação"],
  email:          ["Redigir comunicado sobre surto", "E-mail para a GVE sobre coleta", "Circular sobre conjuntivite"],
  treinamentos:   ["Conteúdo de treinamento em vigilância", "Como capacitar equipes de campo?"],
  campo:          ["Checklist para investigação de surto", "Como coletar material para diagnóstico?"],
  epidemiologico: ["Quantos casos na última SE?", "Quais GVEs com mais surtos?", "Comparar ano atual com anterior"],
  tracoma:        ["Calcular doses de azitromicina", "TF e TT da última pesquisa", "Municípios prioritários para tracoma"],
  dados:          ["Analisar planilha enviada", "Calcular prevalência por município"],
  cos:            ["Situação epidemiológica atual do estado", "Resumo dos alertas desta semana"]
};

const agents: Array<{ value: AgentKind; label: string }> = [
  { value: "geral", label: "Geral" },
  { value: "documentos", label: "Documentos" },
  { value: "email", label: "E-mail" },
  { value: "treinamentos", label: "Treinamentos" },
  { value: "campo", label: "Campo" },
  { value: "epidemiologico", label: "Epidemiologico CEVESP" },
  { value: "tracoma", label: "Tracoma REDCap" },
  { value: "dados", label: "Dados Estatisticos" },
  { value: "cos", label: "Agente COS" }
];

export function ChatView() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [agent, setAgent] = useState<AgentKind>("geral");
  const [search, setSearch] = useState("");
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery<Conversation[]>({
    queryKey: ["conversations", search],
    queryFn: async () => {
      const response = await fetch(`/api/chat?search=${encodeURIComponent(search)}`);
      if (!response.ok) return [];
      return response.json();
    }
  });

  // Carrega o histórico ao selecionar uma conversa
  const messagesQuery = useQuery<Message[]>({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      const response = await fetch(`/api/chat?conversationId=${conversationId}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!conversationId,
    staleTime: 30_000
  });

  useEffect(() => {
    if (messagesQuery.data) {
      setLocalMessages(
        messagesQuery.data.map((msg) => ({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          sources: msg.sources
        }))
      );
    }
  }, [messagesQuery.data]);

  // Read draft from Templates "Usar no Chat"
  useEffect(() => {
    const draft = localStorage.getItem("dvoftalmo_draft_message");
    if (draft) {
      setMessage(draft);
      localStorage.removeItem("dvoftalmo_draft_message");
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      if (!confirm("Excluir esta conversa?")) return;
      const response = await fetch(`/api/chat?conversationId=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Erro ao excluir.");
      return id;
    },
    onSuccess: (id) => {
      if (!id) return;
      if (conversationId === id) {
        setConversationId(undefined);
        setLocalMessages([]);
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const renameConversation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const response = await fetch("/api/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, title })
      });
      if (!response.ok) throw new Error("Erro ao renomear.");
    },
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);
      formData.append("category", "outros");
      const response = await fetch("/api/documents/upload", { method: "POST", body: formData });
      if (!response.ok) throw new Error("Falha no upload.");
      return response.json();
    },
    onSuccess: (data) => {
      const notice: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Arquivo indexado com sucesso (${data.chunks} trechos). Agora voce pode perguntar sobre o conteudo.`
      };
      setLocalMessages((items) => [...items, notice]);
    }
  });

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submitMessage();
    }
  }

  async function submitMessage() {
    const text = message.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setSendError(null);

    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();
    setLocalMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: text },
      { id: assistantMsgId, role: "assistant", content: "" }
    ]);
    setMessage("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text, agent, fileIds: [] })
      });

      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
              if (event.t === "c") {
                setLocalMessages((prev) =>
                  prev.map((m) => m.id === assistantMsgId ? { ...m, content: m.content + String(event.v) } : m)
                );
              } else if (event.t === "done") {
                setConversationId(event.conversationId as string);
                setLocalMessages((prev) =>
                  prev.map((m) => m.id === assistantMsgId ? { ...m, sources: event.sources as Message["sources"] } : m)
                );
                queryClient.invalidateQueries({ queryKey: ["conversations"] });
              } else if (event.t === "err") {
                setSendError(String(event.e));
                setLocalMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
              }
            } catch { /* ignore malformed lines */ }
          }
        }
      } else {
        // COS agent or error — JSON response
        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as Record<string, unknown>;
          throw new Error(String(data.error ?? "Falha ao enviar mensagem."));
        }
        const data = await response.json() as { conversationId: string; answer: string; sources?: Message["sources"] };
        setConversationId(data.conversationId);
        setLocalMessages((prev) =>
          prev.map((m) => m.id === assistantMsgId ? { ...m, content: data.answer, sources: data.sources } : m)
        );
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Erro desconhecido.");
      setLocalMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
    } finally {
      setIsSending(false);
    }
  }

  function selectConversation(id: string, agentKind: AgentKind) {
    setConversationId(id);
    setAgent(agentKind);
    setLocalMessages([]);
  }

  function newConversation() {
    setConversationId(undefined);
    setLocalMessages([]);
  }

  function exportConversation(format: "txt" | "pdf" | "docx") {
    if (!conversationId) return;
    const url = `/api/chat/export?conversationId=${conversationId}&format=${format}`;
    const a   = document.createElement("a");
    a.href    = url;
    a.download = "";
    a.click();
  }

  return (
    <div className="grid h-screen grid-cols-1 md:grid-cols-[320px_1fr]">
      {/* ── Sidebar de conversas ──────────────────────── */}
      <aside className="hidden flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 border-b p-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Pesquisar conversas"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 border-none bg-transparent p-0 focus-visible:ring-0"
          />
        </div>
        <div className="p-3">
          <Button className="w-full" onClick={newConversation}>
            <Bot className="h-4 w-4" />
            Nova conversa
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {(conversations.data ?? []).map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-1 rounded-md border p-2 text-sm ${
                conversationId === conv.id ? "border-primary bg-primary/5" : "hover:bg-muted"
              }`}
            >
              {editingId === conv.id ? (
                <div className="flex flex-1 items-center gap-1">
                  <Input
                    className="h-6 flex-1 py-0 text-xs"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") renameConversation.mutate({ id: conv.id, title: editingTitle });
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                  />
                  <button onClick={() => renameConversation.mutate({ id: conv.id, title: editingTitle })} className="text-primary hover:opacity-70">
                    <Check className="h-3 w-3" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:opacity-70">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => selectConversation(conv.id, conv.agent)}
                  >
                    <span className="block truncate">{conv.title}</span>
                    <span className="text-[10px] text-muted-foreground">{agentLabels[conv.agent] ?? conv.agent}</span>
                  </button>
                  <button
                    className="hidden text-muted-foreground hover:text-foreground group-hover:block"
                    onClick={() => { setEditingId(conv.id); setEditingTitle(conv.title); }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    className="hidden text-muted-foreground hover:text-destructive group-hover:block"
                    onClick={() => deleteConversation.mutate(conv.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          ))}
          {conversations.data?.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nenhuma conversa ainda.</p>
          )}
        </div>
      </aside>

      {/* ── Área principal ───────────────────────────── */}
      <main className="flex min-h-0 flex-col">
        <div className="flex h-16 items-center justify-between border-b px-4 gap-2">
          <div className="min-w-0">
            <h1 className="font-semibold">Chat IA</h1>
            <p className="text-xs text-muted-foreground truncate">
              {conversationId ? "Conversa ativa" : "Nova conversa"} · Ctrl+Enter para enviar
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {conversationId && (
              <div className="relative group">
                <button className="flex items-center gap-1 h-9 px-3 rounded-md border bg-background text-sm hover:bg-muted">
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Exportar</span>
                </button>
                <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-popover border rounded-md shadow-md z-10 min-w-[110px]">
                  {(["txt", "pdf", "docx"] as const).map(fmt => (
                    <button key={fmt} onClick={() => exportConversation(fmt)}
                      className="px-4 py-2 text-sm text-left hover:bg-muted capitalize">
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={agent}
              onChange={(event) => setAgent(event.target.value as AgentKind)}
            >
              {agents.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            {localMessages.length === 0 && !isSending && (
              <div className="space-y-4">
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  <Bot className="mx-auto mb-3 h-8 w-8 text-primary" />
                  <p className="font-medium text-foreground">Envie uma mensagem para começar</p>
                  <p className="mt-1">
                    {agent === "epidemiologico"
                      ? "Agente epidemiologico ativo — perguntas sobre o banco CEVESP retornam dados reais."
                      : agent === "tracoma"
                      ? "Agente Tracoma ativo — consulta REDCap, calcula TF/TT e estima doses de azitromicina."
                      : agent === "dados"
                      ? "Agente de Dados ativo — envie planilha acima (seção Agentes) ou pergunte sobre seus dados."
                      : agent === "cos"
                      ? "Agente COS ativo — usa ferramentas reais: CEVESP, tracoma, documentos e cálculos."
                      : "Respostas baseadas na base de conhecimento com citacao de fontes."}
                  </p>
                </Card>
                <div className="flex flex-wrap gap-2 justify-center">
                  {(SUGGESTIONS[agent] ?? []).map((chip) => (
                    <button key={chip} onClick={() => setMessage(chip)}
                      className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messagesQuery.isFetching && localMessages.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">Carregando historico...</p>
            )}

            {localMessages.map((item) => (
              <div
                key={item.id}
                className={
                  item.role === "user"
                    ? "ml-auto max-w-[82%] rounded-lg bg-primary p-4 text-primary-foreground"
                    : "mr-auto max-w-[86%] rounded-lg border bg-card p-4"
                }
              >
                {item.role === "assistant"
                  ? <MarkdownText content={item.content} />
                  : <div className="whitespace-pre-wrap text-sm leading-6">{item.content}</div>}
                {item.sources && item.sources.length > 0 && (
                  <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                    Fontes: {item.sources.map((s) => s.title).join(", ")}
                  </div>
                )}
              </div>
            ))}

            {sendError && (
              <p className="text-center text-sm text-destructive">{sendError}</p>
            )}

            {uploadFile.isError && (
              <p className="text-center text-sm text-destructive">{(uploadFile.error as Error).message}</p>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <form
          className="border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitMessage();
          }}
        >
          <div className="mx-auto flex max-w-3xl gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile.mutate(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="icon"
              type="button"
              title="Anexar e indexar arquivo"
              disabled={uploadFile.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadFile.isPending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
            </Button>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem... (Ctrl+Enter para enviar)"
              className="min-h-12 resize-none"
              rows={1}
            />
            <Button type="submit" size="icon" disabled={isSending || uploadFile.isPending || !message.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
