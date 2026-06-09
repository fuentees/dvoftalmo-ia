import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  indexVictorDocument,
  listVictorDocuments,
  deleteVictorDocument
} from "@/lib/external/victor-style-db";
import { extractTextFromFile } from "@/services/ai/document-parser";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const docs = await listVictorDocuments(user.id);
  return NextResponse.json(docs);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const documentType = String(formData.get("documentType") ?? "geral");
  const title = String(formData.get("title") ?? (file?.name ?? "Documento"));

  if (!file) return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });

  const content = await extractTextFromFile(file);
  if (!content.trim()) {
    return NextResponse.json({ error: "Nao foi possivel extrair texto do arquivo." }, { status: 422 });
  }

  try {
    const id = await indexVictorDocument(user.id, title, content, documentType);
    return NextResponse.json({ id, title, documentType });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao indexar documento." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatorio." }, { status: 400 });

  try {
    await deleteVictorDocument(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao excluir." },
      { status: 500 }
    );
  }
}
