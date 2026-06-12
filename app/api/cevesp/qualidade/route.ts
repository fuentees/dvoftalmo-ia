import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { findInvalidRecords, saveCorrectionsToQueue } from "@/services/cevesp-corrections";
import { getNotificationTableName } from "@/lib/external/notification-db";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  try {
    const records = await findInvalidRecords(500);

    const byType: Record<string, number> = {};
    for (const r of records) {
      const key = r.issue.split(":")[0].trim();
      byType[key] = (byType[key] ?? 0) + 1;
    }

    return NextResponse.json({ records, byType, total: records.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("econnrefused") || msg.toLowerCase().includes("connect")) {
      return NextResponse.json(
        { error: "conexao_falhou", message: "Não foi possível conectar ao banco CEVESP. Verifique as configurações de conexão." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as { recordIds?: string[] };

  try {
    const records = await findInvalidRecords(500);
    const tableName = getNotificationTableName();

    const targets = body.recordIds?.length
      ? records.filter((r) => body.recordIds!.includes(r.recordId))
      : records;

    const proposals = targets
      .filter((r) => r.suggestedField && r.suggestedValue)
      .map((r) => ({
        recordId: r.recordId,
        tableName,
        pkColumn: r.pkColumn,
        fieldName: r.suggestedField,
        oldValue: r.suggestedField === "DtNotificacao"
          ? (r.dtNotificacao ?? "")
          : String(r.semEpidemio ?? ""),
        newValue: r.suggestedValue,
        reason: r.issue
      }));

    const result = await saveCorrectionsToQueue(proposals, user.id);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
