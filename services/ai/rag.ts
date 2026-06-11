import type { AgentKind, AiSource } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/services/ai/openai";
import { buildSystemPrompt } from "@/services/ai/prompts";
import { generateCompletion, streamCompletion } from "@/services/ai/provider";

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

type RagInput = {
  userId: string;
  message: string;
  agent: AgentKind;
  conversationMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  cevespContext?: string;
  tracomaContext?: string;
  dataContext?: string;
};

function buildRagMessages(context: RagContext, ragFailed: boolean, input: RagInput) {
  const systemMessages: Array<{ role: "system"; content: string }> = [
    { role: "system", content: buildSystemPrompt(input.agent) }
  ];

  if (ragFailed) {
    systemMessages.push({
      role: "system",
      content: "AVISO: a busca na base de conhecimento falhou (serviço de embeddings indisponível). Responda com base no seu conhecimento geral e nos dados em tempo real fornecidos."
    });
  } else if (context.content.length > 0) {
    systemMessages.push({
      role: "system",
      content: `Base de conhecimento recuperada:\n${context.content}`
    });
  }

  if (input.cevespContext) {
    systemMessages.push({
      role: "system",
      content: "REGRA CEVESP: quando houver contexto CEVESP injetado, responda como tendo acesso aos dados por cache/importacao ou consulta. Nao diga que nao consegue ler o banco. Se o contexto disser que o cache esta vazio ou sem dados para o filtro, explique esse diagnostico e oriente sincronizar/importar."
    });
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

  return [
    ...systemMessages,
    ...(input.conversationMessages ?? []),
    { role: "user" as const, content: input.message }
  ];
}

export async function answerWithRag(input: RagInput) {
  let ragFailed = false;
  const context = await retrieveContext(input.message, input.userId).catch(() => {
    ragFailed = true;
    return { content: "", sources: [] as AiSource[] };
  });

  const messages = buildRagMessages(context, ragFailed, input);
  const answer = await generateCompletion(messages, { temperature: 0.2 });

  return {
    answer: answer || "Nao foi possivel gerar uma resposta.",
    sources: context.sources
  };
}

export async function* streamRagAnswer(input: RagInput): AsyncGenerator<
  { type: "sources"; sources: AiSource[] } | { type: "chunk"; text: string }
> {
  let ragFailed = false;
  const context = await retrieveContext(input.message, input.userId).catch(() => {
    ragFailed = true;
    return { content: "", sources: [] as AiSource[] };
  });

  yield { type: "sources", sources: context.sources };

  const messages = buildRagMessages(context, ragFailed, input);
  for await (const chunk of streamCompletion(messages, { temperature: 0.2 })) {
    yield { type: "chunk", text: chunk };
  }
}
