import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotificationConnection, getNotificationTableName, isNotificationConnectionError } from "@/lib/external/notification-db";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const anoParam = request.nextUrl.searchParams.get("ano");
  const ano = anoParam ? Number(anoParam) : undefined;

  try {
    // Try MySQL first for an efficient DISTINCT query
    try {
      const tableName = getNotificationTableName();
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error("Invalid table name");
      const conn = await createNotificationConnection();
      try {
        const whereClause = ano ? "WHERE ANO = ?" : "";
        const params = ano ? [ano] : [];
        const [rows] = await conn.query(
          `SELECT DISTINCT GVE_NOME FROM \`${tableName}\` ${whereClause} ORDER BY GVE_NOME`,
          params
        );
        const gves = (rows as Array<{ GVE_NOME: string | null }>)
          .map((r) => String(r.GVE_NOME ?? "").trim())
          .filter(Boolean)
          .sort();
        return NextResponse.json({ gves }, { headers: { "Cache-Control": "s-maxage=600" } });
      } finally {
        await conn.end();
      }
    } catch (mysqlError) {
      if (!isNotificationConnectionError(mysqlError)) throw mysqlError;
    }

    // Fallback: Supabase cache — scan GVE_NOME in batches
    const admin = createAdminClient();
    const gveSet = new Set<string>();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = admin
        .from("cevesp_notificacoes")
        .select('"GVE_NOME"')
        .not('"GVE_NOME"', "is", null)
        .range(from, from + pageSize - 1);
      if (ano) q = q.eq('"ANO"', ano);
      const { data, error } = await q;
      if (error) break;
      for (const row of (data ?? []) as Array<{ GVE_NOME?: string }>) {
        const gve = String(row.GVE_NOME ?? "").trim();
        if (gve) gveSet.add(gve);
      }
      if (!data || data.length < pageSize) break;
    }
    const gves = Array.from(gveSet).sort();
    return NextResponse.json({ gves }, { headers: { "Cache-Control": "s-maxage=600" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar GVEs.", gves: [] },
      { status: 500 }
    );
  }
}
