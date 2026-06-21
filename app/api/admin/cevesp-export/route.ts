import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireCevespSyncPermission } from "@/lib/admin-guard";
import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";
import { cleanRow } from "@/lib/cevesp-clean";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  if (!process.env.NOTIFY_DB_HOST) {
    return NextResponse.json(
      { error: "MySQL não acessível. Execute esta ação no escritório (rede SES-SP) com o servidor local." },
      { status: 503 }
    );
  }

  let table: string;
  try {
    const t = getNotificationTableName();
    if (!/^[a-zA-Z0-9_]+$/.test(t)) throw new Error("inválido");
    table = t;
  } catch {
    return NextResponse.json({ error: "NOTIFY_DB_TABLE inválido ou não configurado." }, { status: 500 });
  }

  const full      = request.nextUrl.searchParams.get("full") === "true";
  const yearParam = request.nextUrl.searchParams.get("year");
  const currentYear = new Date().getFullYear();

  let conn: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    conn = await createNotificationConnection();

    let years: number[];
    if (full) {
      const [[r]] = await conn.query(
        `SELECT MIN(ANO) AS mn, MAX(ANO) AS mx FROM \`${table}\``
      ) as [Array<{ mn: number; mx: number }>, unknown];
      const min = r?.mn ?? currentYear;
      const max = r?.mx ?? currentYear;
      years = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    } else if (yearParam) {
      years = [parseInt(yearParam, 10)];
    } else {
      years = [currentYear];
    }

    const allRows: Record<string, unknown>[] = [];
    for (const ano of years) {
      const [rows] = await conn.query(
        `SELECT * FROM \`${table}\` WHERE ANO = ?`,
        [ano]
      ) as [Array<Record<string, unknown>>, unknown];
      allRows.push(...rows.map(cleanRow));
    }

    const json = JSON.stringify(allRows);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="cevesp-export.json"`,
        "X-Row-Count": String(allRows.length),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetwork = msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("ENOTFOUND");
    if (isNetwork) {
      return NextResponse.json(
        { error: "Não foi possível conectar ao MySQL. Verifique que está na rede do escritório." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await conn?.end();
  }
}
