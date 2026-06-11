import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireCevespSyncPermission } from "@/lib/admin-guard";
import { importSinanTracomaRows, type SinanTracomaBank } from "@/services/sinan-tracoma";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  const body = await request.json() as {
    rows?: unknown;
    bank?: unknown;
    importId?: unknown;
    totalRows?: unknown;
    isLastBatch?: unknown;
  };

  if (body.bank !== "traconet" && body.bank !== "nottraconet") {
    return NextResponse.json({ error: "Informe bank como traconet ou nottraconet." }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "rows deve ser um array nao-vazio." }, { status: 400 });
  }

  try {
    const result = await importSinanTracomaRows({
      rows: body.rows as Array<Record<string, unknown>>,
      bank: body.bank as SinanTracomaBank,
      importId: typeof body.importId === "string" ? body.importId : undefined,
      totalRows: typeof body.totalRows === "number" ? body.totalRows : undefined,
      isLastBatch: typeof body.isLastBatch === "boolean" ? body.isLastBatch : undefined
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao importar SINAN Tracoma." },
      { status: 500 }
    );
  }
}
