import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { processDocument } from "@/services/ai/document-processor";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch document — verify ownership and get storage path
  const { data: doc, error: fetchError } = await supabase
    .from("documents")
    .select("id,owner_id,file_path,file_name,mime_type,processing_status")
    .eq("id", id)
    .single();

  if (fetchError || !doc)
    return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  if (doc.owner_id !== user.id)
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  if (doc.processing_status === "indexing")
    return NextResponse.json({ error: "Já está sendo processado." }, { status: 409 });
  if (!doc.file_path)
    return NextResponse.json({ error: "Sem arquivo armazenado." }, { status: 400 });

  // Download file from storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("documents")
    .download(doc.file_path);
  if (downloadError || !fileData)
    return NextResponse.json({ error: "Erro ao baixar o arquivo do storage." }, { status: 500 });

  const fileBuffer = Buffer.from(await fileData.arrayBuffer());
  const documentId = doc.id;
  const userId     = doc.owner_id;
  const fileName   = doc.file_name ?? doc.file_path.split("/").pop() ?? "documento";
  const mimeType   = doc.mime_type ?? "";

  // Mark pending immediately so UI can show it
  await supabase
    .from("documents")
    .update({ processing_status: "pending", processing_error: null })
    .eq("id", documentId);

  after(async () => {
    await processDocument({ documentId, userId, fileBuffer, fileName, mimeType }).catch(() => {});
  });

  return NextResponse.json({ id: documentId, status: "pending" });
}
