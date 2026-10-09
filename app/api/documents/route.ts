import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;

  // Contagem por categoria e favoritos, para a barra lateral
  if (params.get("counts") === "1") {
    const { data, error } = await supabase.from("documents").select("category, favorite").is("deleted_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const byCategory: Record<string, number> = {};
    let favorites = 0;
    for (const row of data ?? []) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      if (row.favorite) favorites++;
    }
    return NextResponse.json({ total: data?.length ?? 0, byCategory, favorites });
  }

  // Link temporário para baixar o arquivo
  const downloadId = params.get("download");
  if (downloadId) {
    const { data: document, error } = await supabase
      .from("documents")
      .select("file_path, file_name")
      .eq("id", downloadId)
      .is("deleted_at", null)
      .single();
    if (error || !document?.file_path) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    const { data: signed, error: signError } = await supabase.storage
      .from("documents")
      .createSignedUrl(document.file_path, 60, { download: document.file_name ?? true });
    if (signError || !signed) return NextResponse.json({ error: signError?.message ?? "Falha ao gerar o link." }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl });
  }

  const category = params.get("category");
  // Vírgulas e parênteses quebrariam o filtro .or() do PostgREST
  const search   = params.get("search")?.replace(/[,()%*]/g, " ").trim();
  const favorite = params.get("favorite") === "1";
  const skip     = Math.max(0, Number(params.get("skip")  ?? 0));
  const limit    = Math.min(100, Math.max(1, Number(params.get("limit") ?? 20)));

  let query = supabase
    .from("documents")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (category && category !== "todos") query = query.eq("category", category);
  if (favorite) query = query.eq("favorite", true);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query.range(skip, skip + limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório." }, { status: 400 });

  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { id?: string; favorite?: boolean };
  if (!body.id || typeof body.favorite !== "boolean") {
    return NextResponse.json({ error: "id e favorite obrigatórios." }, { status: 400 });
  }

  const { error } = await supabase
    .from("documents")
    .update({ favorite: body.favorite })
    .eq("id", body.id)
    .eq("owner_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
