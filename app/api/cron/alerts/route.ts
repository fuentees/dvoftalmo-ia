import { NextResponse } from "next/server";
import { generateEpidemiologicalAlerts } from "@/services/epidemiological-alerts";

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

  try {
    return NextResponse.json(await generateEpidemiologicalAlerts());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/alerts]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
