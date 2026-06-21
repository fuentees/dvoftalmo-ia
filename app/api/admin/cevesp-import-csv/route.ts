import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCevespSyncPermission } from "@/lib/admin-guard";
import { cleanRow } from "@/lib/cevesp-clean";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  let rows: Record<string, unknown>[];
  let importId: string | null = null;
  let totalRows = 0;
  let isLastBatch = true;
  try {
    const body = await request.json() as { rows?: unknown; importId?: unknown; totalRows?: unknown; isLastBatch?: unknown };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: "rows deve ser um array não-vazio." }, { status: 400 });
    }
    rows = body.rows as Record<string, unknown>[];
    importId = typeof body.importId === "string" ? body.importId : null;
    totalRows = typeof body.totalRows === "number" ? body.totalRows : rows.length;
    isLastBatch = typeof body.isLastBatch === "boolean" ? body.isLastBatch : true;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const cleaned = rows.map(cleanRow);

  const seen = new Set<string>();
  const deduped = cleaned.filter((row) => {
    const key = String(row.row_key ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const admin = createAdminClient();
  const { error } = await admin
    .from("cevesp_notificacoes")
    .upsert(deduped, { onConflict: "row_key", ignoreDuplicates: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (isLastBatch) {
    await admin.from("cevesp_sync_log").insert({
      rows_upserted: totalRows,
      mode: importId ? `csv_import:${importId}` : "csv_import"
    });
  }

  return NextResponse.json({
    received: rows.length,
    upserted: deduped.length,
    duplicateRows: rows.length - deduped.length
  });
}
