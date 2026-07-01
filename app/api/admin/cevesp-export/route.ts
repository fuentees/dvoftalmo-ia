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

  const year     = yearParam ? parseInt(yearParam, 10) : (full ? null : currentYear);
  const sql      = year != null ? `SELECT * FROM \`${table}\` WHERE ANO = ?` : `SELECT * FROM \`${table}\``;
  const params   = year != null ? [year] : [];
  const fileName = full ? "cevesp-export-completo.json" : `cevesp-export-${year ?? currentYear}.json`;

  let promiseConn: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    promiseConn = await createNotificationConnection();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(msg);
    return NextResponse.json(
      { error: isNetwork ? "Não foi possível conectar ao MySQL. Verifique que está na rede do escritório." : msg },
      { status: isNetwork ? 503 : 500 }
    );
  }

  // Access the underlying callback-based connection for row-by-row streaming.
  // This avoids buffering all rows in memory and avoids multiple round-trip queries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = (promiseConn as any).connection;
  const encoder = new TextEncoder();
  let first = true;

  const readable = new ReadableStream({
    start(controller) {
      conn.query(sql, params)
        .on("result", (row: Record<string, unknown>) => {
          const prefix = first ? "[" : ",";
          first = false;
          controller.enqueue(encoder.encode(prefix + JSON.stringify(cleanRow(row))));
        })
        .on("error", (err: Error) => {
          try { promiseConn?.end(); } catch { /* ignore */ }
          controller.error(err);
        })
        .on("end", () => {
          if (first) controller.enqueue(encoder.encode("["));
          controller.enqueue(encoder.encode("]"));
          controller.close();
          try { promiseConn?.end(); } catch { /* ignore */ }
        });
    },
    cancel() {
      try { promiseConn?.end(); } catch { /* ignore */ }
    }
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
