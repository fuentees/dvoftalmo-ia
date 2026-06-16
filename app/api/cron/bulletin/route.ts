import { NextResponse } from "next/server";
import { generateConjuntiviteBulletin } from "@/services/bulletins-conjuntivite-generator";

export const dynamic = "force-dynamic";

// Called every Monday by Vercel Cron — auto-generates the conjunctivitis weekly bulletin.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await generateConjuntiviteBulletin();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
