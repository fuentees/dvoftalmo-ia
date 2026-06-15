import { NextResponse } from "next/server";
import { generateWeeklyBulletin } from "@/services/bulletins-generator";

export const dynamic = "force-dynamic";

// Called every Monday by Vercel Cron.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await generateWeeklyBulletin();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
