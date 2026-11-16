import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("app_config").select("key").limit(1);
    if (error) throw new Error("Supabase check unavailable");
    checks.supabase = "ok";
  } catch {
    checks.supabase = "unavailable";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      checks
    },
    { status: allOk ? 200 : 503 }
  );
}
