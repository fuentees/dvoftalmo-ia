import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAIConfig } from "@/services/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};

  try {
    const supabase = createAdminClient();
    await supabase.from("app_config").select("key").limit(1);
    checks.supabase = "ok";
  } catch (err) {
    checks.supabase = err instanceof Error ? err.message : "error";
  }

  let providerName = "unknown";
  try {
    const config = await getAIConfig();
    providerName = config.provider;
    checks.ai_key = config.apiKey ? "ok" : "missing";
  } catch {
    checks.ai_key = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      provider: providerName,
      timestamp: new Date().toISOString(),
      checks
    },
    { status: allOk ? 200 : 503 }
  );
}
