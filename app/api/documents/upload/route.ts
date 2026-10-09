import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "text/csv",
  "text/plain",
  "application/csv"
]);
const ALLOWED_EXT = /\.(pdf|docx|doc|xlsx|csv|txt)$/i;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const title    = String(formData.get("title")    ?? file?.name ?? "Documento");
  const category = String(formData.get("category") ?? "outros");
  const tags     = String(formData.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);

  if (!file) return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE)
    return NextResponse.json({ error: "Arquivo muito grande (máx. 50 MB)." }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.test(file.name))
    return NextResponse.json({ error: "Tipo não permitido. Use PDF, DOCX, XLSX, CSV ou TXT." }, { status: 400 });

  // Upload to storage
  const filePath = `${user.id}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(filePath, file, { contentType: file.type, upsert: false });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  // Arquivo só é guardado (sem indexação por IA)
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
      file_size: file.size,
      processing_status: "done"
    })
    .select("id")
    .single();
  if (documentError) return NextResponse.json({ error: documentError.message }, { status: 500 });

  return NextResponse.json({ id: document.id, status: "done" }, { status: 201 });
}
