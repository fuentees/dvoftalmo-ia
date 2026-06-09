import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/services/ai/openai";

export interface VictorStyleDocument {
  id: string;
  title: string;
  content: string;
  documentType: string;
  similarity?: number;
  createdAt?: string;
}

export async function indexVictorDocument(
  userId: string,
  title: string,
  content: string,
  documentType: string
): Promise<string> {
  const supabase = createAdminClient();
  const embedding = await createEmbedding(content.slice(0, 8000));

  const { data, error } = await supabase
    .from("victor_style_documents")
    .insert({ owner_id: userId, title, content, document_type: documentType, embedding })
    .select("id")
    .single();

  if (error) throw new Error(`Erro ao indexar documento Victor: ${error.message}`);
  return data.id as string;
}

export async function retrieveVictorStyleExamples(
  userId: string,
  query: string,
  matchCount = 5
): Promise<VictorStyleDocument[]> {
  const supabase = createAdminClient();

  let embedding: number[];
  try {
    embedding = await createEmbedding(query.slice(0, 2000));
  } catch {
    return [];
  }

  const { data, error } = await supabase.rpc("match_victor_style", {
    query_embedding: embedding,
    match_count: matchCount,
    current_user_id: userId
  });

  if (error) return [];

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    documentType: String(row.document_type),
    similarity: Number(row.similarity)
  }));
}

export async function deleteVictorDocument(userId: string, documentId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("victor_style_documents")
    .delete()
    .eq("id", documentId)
    .eq("owner_id", userId);
  if (error) throw new Error(error.message);
}

export async function listVictorDocuments(userId: string): Promise<Omit<VictorStyleDocument, "similarity">[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("victor_style_documents")
    .select("id,title,content,document_type,created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) return [];

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    content: (row.content as string).slice(0, 200),
    documentType: row.document_type as string,
    createdAt: row.created_at as string
  }));
}
