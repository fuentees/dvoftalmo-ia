import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createEmbedding } from "@/services/ai/openai";
import { chunkText, extractTextFromFile } from "@/services/ai/document-parser";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const title = String(formData.get("title") ?? file?.name ?? "Documento");
  const category = String(formData.get("category") ?? "outros");
  const tags = String(formData.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);

  if (!file) return NextResponse.json({ error: "Arquivo obrigatorio" }, { status: 400 });

  const ALLOWED_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "text/csv",
    "text/plain",
    "application/csv"
  ];
  const allowedExt = /\.(pdf|docx|doc|xlsx|csv|txt)$/i;
  if (!ALLOWED_TYPES.includes(file.type) && !allowedExt.test(file.name)) {
    return NextResponse.json({ error: "Tipo de arquivo não permitido. Use PDF, DOCX, XLSX, CSV ou TXT." }, { status: 400 });
  }

  const filePath = `${user.id}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("documents").upload(filePath, file, {
    contentType: file.type,
    upsert: false
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .insert({
      owner_id: user.id,
      title,
      category,
      tags,
      file_path: filePath,
      file_name: file.name,
      mime_type: file.type,
      file_size: file.size
    })
    .select("id")
    .single();

  if (documentError) return NextResponse.json({ error: documentError.message }, { status: 500 });

  const extracted = await extractTextFromFile(file);
  const chunks = chunkText(extracted);
  let indexedCount = 0;
  for (const content of chunks) {
    try {
      const embedding = await createEmbedding(content);
      await supabase.from("document_chunks").insert({
        document_id: document.id,
        owner_id: user.id,
        content,
        token_count: Math.ceil(content.length / 4),
        embedding
      });
      indexedCount++;
    } catch {
      // Skip chunks that fail to embed — partial indexing is better than no indexing
    }
  }

  await supabase.from("documents").update({ indexed: indexedCount > 0 }).eq("id", document.id);

  return NextResponse.json({ id: document.id, chunks: indexedCount });
}
