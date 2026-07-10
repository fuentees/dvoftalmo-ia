import type { AiSource } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/services/ai/openai";

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
