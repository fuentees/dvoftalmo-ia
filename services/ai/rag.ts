import type { AgentKind, AiSource } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/services/ai/openai";
import { buildSystemPrompt } from "@/services/ai/prompts";
import { generateCompletion } from "@/services/ai/provider";

interface RagContext {
  content: string;
  sources: AiSource[];
}

export async function retrieveContext(query: string, userId: string): Promise<RagContext> {
  const supabase = createAdminClient();
  const embedding = await createEmbedding(query);
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_count: 8,
    min_similarity: 0.68,
    current_user_id: userId
  });

  if (error) throw error;

  const rows = data ?? [];
  return {
    content: rows.map((row: Record<string, unknown>, index: number) =>
      `[Fonte ${index + 1}: ${row.title}]\n${row.content}`
    ).join("\n\n"),
    sources: rows.map((row: Record<string, unknown>) => ({
      documentId: row.document_id as string,
      title: row.title as string,
      category: row.category as AiSource["category"],
      chunkId: row.chunk_id as string,
      score: row.similarity as number
    }))
  };
}

export async function answerWithRag(input: {
  userId: string;
  message: string;
  agent: AgentKind;
  conversationMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  cevespContext?: string;
  tracomaContext?: string;
  dataContext?: string;
}) {
  // Embeddings require OpenAI — fail gracefully so other providers still work
  const context = await retrieveContext(input.message, input.userId).catch(() => ({
    content: "",
    sources: [] as AiSource[]
  }));

  const systemMessages: Array<{ role: "system"; content: string }> = [
    { role: "system", content: buildSystemPrompt(input.agent) }
  ];

  if (context.content.length > 0) {
    systemMessages.push({
      role: "system",
      content: `Base de conhecimento recuperada:\n${context.content}`
    });
  }

  if (input.cevespContext) {
    systemMessages.push({
      role: "system",
      content: `Dados CEVESP em tempo real — use estes numeros ao responder:\n${input.cevespContext}`
    });
  }

  if (input.tracomaContext) {
    systemMessages.push({
      role: "system",
      content: `Dados de tracoma (REDCap) em tempo real — use estes indicadores ao responder:\n${input.tracomaContext}`
    });
  }

  if (input.dataContext) {
    systemMessages.push({
      role: "system",
      content: `Dados da planilha enviada pelo usuario — use para analise estatistica:\n${input.dataContext}`
    });
  }

  const messages = [
    ...systemMessages,
    ...(input.conversationMessages ?? []),
    { role: "user" as const, content: input.message }
  ];

  const answer = await generateCompletion(messages, { temperature: 0.2 });

  return {
    answer: answer || "Nao foi possivel gerar uma resposta.",
    sources: context.sources
  };
}
