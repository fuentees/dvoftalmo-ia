import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";
import { emailEpidAlert } from "@/services/email";

export const dynamic = "force-dynamic";

// Called every Monday at 07:00 UTC by Vercel Cron.
// Queries CEVESP for the latest complete SE and compares with 4-week moving average.
// Creates alerts for GVEs with >50% increase.
export async function GET(request: Request) {
  // Vercel cron sends Authorization header with CRON_SECRET
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let conn: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    conn = await createNotificationConnection();
    const table = getNotificationTableName();

    // Get current year/SE
    const [[nowRow]] = await conn.query(
      `SELECT year(curdate()) as ano, week(curdate(), 6) as se`
    ) as unknown[][];
    const { ano, se } = nowRow as { ano: number; se: number };
    const lastSe = se - 1 < 1 ? 52 : se - 1;

    // Cases in last complete SE per GVE
    const [currentRows] = await conn.query(
      `SELECT coalesce(GVE_NOME,'Não informado') as gve,
              sum(coalesce(TotalCaso,0)) as cases
       FROM \`${table}\`
       WHERE SemEpidemio = ? AND ANO = ?
       GROUP BY gve`,
      [lastSe, ano]
    ) as unknown[][];

    const current = currentRows as Array<{ gve: string; cases: number }>;
    if (!current.length) {
      return NextResponse.json({ ok: true, alerts: 0, reason: "no data for last SE" });
    }

    // 4-week moving average per GVE
    const [avgRows] = await conn.query(
      `SELECT coalesce(GVE_NOME,'Não informado') as gve,
              avg(cases_by_se) as avg_cases
       FROM (
         SELECT GVE_NOME, SemEpidemio, sum(coalesce(TotalCaso,0)) as cases_by_se
         FROM \`${table}\`
         WHERE SemEpidemio BETWEEN ? AND ? AND ANO = ?
         GROUP BY GVE_NOME, SemEpidemio
       ) t GROUP BY gve`,
      [lastSe - 4, lastSe - 1, ano]
    ) as unknown[][];

    const avgMap = new Map(
      (avgRows as Array<{ gve: string; avg_cases: number }>).map((r) => [r.gve, r.avg_cases])
    );

    const supabase  = createAdminClient();
    let alertCount  = 0;

    for (const row of current) {
      const avg  = avgMap.get(row.gve) ?? 0;
      if (avg <= 0) continue;
      const pct  = ((row.cases - avg) / avg) * 100;
      if (pct < 50) continue;

      const severity = pct >= 100 ? "critical" : "warning";

      await supabase.from("epidemiological_alerts").upsert(
        { se_epidemiologica: lastSe, ano, gve: row.gve, cases_current: row.cases,
          cases_avg: avg, increase_pct: pct, severity },
        { onConflict: "se_epidemiologica,ano,gve" }
      );

      await emailEpidAlert({ gve: row.gve, se: lastSe, casesCurrent: row.cases,
        casesAvg: avg, increasePct: pct, severity });

      alertCount++;
    }

    return NextResponse.json({ ok: true, alerts: alertCount, se: lastSe });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/alerts]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}
