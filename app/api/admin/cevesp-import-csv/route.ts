import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCevespSyncPermission } from "@/lib/admin-guard";
import { cleanRow, parseCsv } from "@/lib/cevesp-clean";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  let csvText: string;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    csvText = await (file as File).text();
  } catch {
    return NextResponse.json({ error: "Erro ao ler arquivo." }, { status: 400 });
  }

  const raw = parseCsv(csvText);
  if (raw.length === 0) return NextResponse.json({ error: "Arquivo vazio ou formato inválido." }, { status: 400 });

  const cleaned = raw.map(cleanRow);

  const seen = new Set<string>();
  const deduped = cleaned.filter((row) => {
    const key = String(row.row_key ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const admin = createAdminClient();
  const batchSize = 500;
  let upserted = 0;

  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize);
    const { error } = await admin.from("cevesp_notificacoes").upsert(batch, { onConflict: "row_key", ignoreDuplicates: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    upserted += batch.length;
  }

  await admin.from("cevesp_sync_log").insert({ rows_upserted: upserted, mode: "csv_import" });

  return NextResponse.json({ received: raw.length, upserted, duplicateRows: raw.length - deduped.length });
}
