"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, FileUp, Pencil, Search, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentKind } from "@/lib/types";

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text, agent, fileIds: [] })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Falha ao enviar mensagem.");
      }
      return response.json();
    },
    onMutate: (text) => {
      setLocalMessages((items) => [
        ...items,
        { id: crypto.randomUUID(), role: "user", content: text }
      ]);
      setMessage("");
    },
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setLocalMessages((items) => [
        ...items,
        { id: crypto.randomUUID(), role: "assistant", content: data.answer, sources: data.sources }
      ]);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/chat?conversationId=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Erro ao excluir.");
    },
    onSuccess: (_, id) => {
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

  function submitMessage() {
    const text = message.trim();
    if (!text || send.isPending) return;
    send.mutate(text);
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
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => selectConversation(conv.id, conv.agent)}
                  >
                    {conv.title}
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
        <div className="flex h-16 items-center justify-between border-b px-4">
          <div>
            <h1 className="font-semibold">Chat IA</h1>
            <p className="text-xs text-muted-foreground">
              {conversationId ? "Conversa ativa" : "Nova conversa"} · Ctrl+Enter para enviar
            </p>
          </div>
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

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            {localMessages.length === 0 && !send.isPending && (
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
                <div className="whitespace-pre-wrap text-sm leading-6">{item.content}</div>
                {item.sources && item.sources.length > 0 && (
                  <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                    Fontes: {item.sources.map((s) => s.title).join(", ")}
                  </div>
                )}
              </div>
            ))}

            {send.isPending && (
              <div className="mr-auto max-w-[86%] rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Gerando resposta...</span>
                </div>
              </div>
            )}

            {send.isError && (
              <p className="text-center text-sm text-destructive">{(send.error as Error).message}</p>
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
            <Button type="submit" size="icon" disabled={send.isPending || !message.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
