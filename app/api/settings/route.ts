import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateConfigCache } from "@/services/ai/provider";

const ALLOWED_KEYS = [
  "ai_provider",
  "openai_api_key",    "openai_model",
  "anthropic_api_key", "anthropic_model",
  "gemini_api_key",    "gemini_model"
] as const;

function maskKey(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return "••••••••" + value.slice(-4);
}

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("app_config")
    .select("key, value")
    .in("key", ALLOWED_KEYS);

  const raw = Object.fromEntries((data ?? []).map((r) => [r.key, r.value as string]));

  // Return masked API keys to the client — actual values stay server-side
  return NextResponse.json({
    ai_provider:       raw.ai_provider       ?? "openai",
    openai_model:      raw.openai_model      ?? "gpt-4.1-mini",
    anthropic_model:   raw.anthropic_model   ?? "claude-haiku-4-5-20251001",
    gemini_model:      raw.gemini_model      ?? "gemini-2.0-flash",
    openai_key_set:    !!( raw.openai_api_key    || process.env.OPENAI_API_KEY),
    anthropic_key_set: !!(raw.anthropic_api_key  || process.env.ANTHROPIC_API_KEY),
    gemini_key_set:    !!(raw.gemini_api_key      || process.env.GEMINI_API_KEY),
    openai_key_hint:   maskKey(raw.openai_api_key    ?? process.env.OPENAI_API_KEY),
    anthropic_key_hint:maskKey(raw.anthropic_api_key ?? process.env.ANTHROPIC_API_KEY),
    gemini_key_hint:   maskKey(raw.gemini_api_key    ?? process.env.GEMINI_API_KEY)
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as Record<string, string>;
  const admin = createAdminClient();

  const upserts = Object.entries(body)
    .filter(([key]) => (ALLOWED_KEYS as readonly string[]).includes(key))
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));

  if (upserts.length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido." }, { status: 400 });
  }

  const { error } = await admin.from("app_config").upsert(upserts, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateConfigCache();
  return NextResponse.json({ ok: true });
}
