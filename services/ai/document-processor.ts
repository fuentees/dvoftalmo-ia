import { createAdminClient } from "@/lib/supabase/admin";
import { extractTextFromBuffer, chunkText } from "@/services/ai/document-parser";
import { createEmbeddingBatch } from "@/services/ai/openai";

const EMBED_BATCH_SIZE = 20;

interface ProcessOptions {
  documentId: string;
  userId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
}

/**
 * Full pipeline: extract → chunk → batch-embed → persist.
 * Updates documents.processing_status to 'indexing' → 'done' | 'failed'.
 * Safe to call from after() or a background route — uses adminClient (no cookies needed).
 */
export async function processDocument({
  documentId,
  userId,
  fileBuffer,
  fileName,
  mimeType
}: ProcessOptions): Promise<{ indexed: number; failed: number }> {
  const supabase = createAdminClient();

  await supabase
    .from("documents")
    .update({ processing_status: "indexing", processing_error: null })
    .eq("id", documentId);

  try {
    const text = await extractTextFromBuffer(fileBuffer, mimeType, fileName);
    const chunks = chunkText(text);

    // Delete any previous chunks (idempotent — safe for reprocess)
    await supabase.from("document_chunks").delete().eq("document_id", documentId);

    let indexed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      try {
        const embeddings = await createEmbeddingBatch(batch);
        const rows = batch.map((content, j) => ({
          document_id: documentId,
          owner_id: userId,
          content,
          token_count: Math.ceil(content.length / 4),
          embedding: embeddings[j]
        }));
        const { error } = await supabase.from("document_chunks").insert(rows);
        if (error) {
          failed += batch.length;
          errors.push(error.message);
        } else {
          indexed += batch.length;
        }
      } catch (err) {
        failed += batch.length;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const status = indexed > 0 ? "done" : "failed";
    await supabase
      .from("documents")
      .update({
        processing_status: status,
        processing_error: status === "failed" ? (errors[0] ?? "Nenhum trecho indexado") : null,
        indexed: indexed > 0
      })
      .eq("id", documentId);

    return { indexed, failed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("documents")
      .update({ processing_status: "failed", processing_error: message })
      .eq("id", documentId)
      .then(() => {}, () => {});
    throw err;
  }
}
