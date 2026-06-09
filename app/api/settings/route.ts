import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateConfigCache } from "@/services/ai/provider";
import { encryptValue, decryptValue, isApiKey } from "@/lib/crypto";

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

interface ConfigResult {
  data: Record<string, string>;
  tableExists: boolean;
}

async function readConfig(): Promise<ConfigResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("app_config")
      .select("key, value")
      .in("key", ALLOWED_KEYS);
    if (error) {
      const missing = error.message?.includes("relation") || error.message?.includes("does not exist");
      return { data: {}, tableExists: !missing };
    }
    const decrypted = Object.fromEntries(
      (data ?? []).map((r) => [r.key, isApiKey(r.key) ? decryptValue(r.value as string) : r.value as string])
    );
    return { data: decrypted, tableExists: true };
  } catch {
    // Network error (fetch failed) — don't show migration warning, assume table exists
    return { data: {}, tableExists: true };
  }
}

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: raw, tableExists } = await readConfig();

  return NextResponse.json({
    ai_provider:        raw.ai_provider       ?? (process.env.AI_PROVIDER ?? "openai"),
    openai_model:       raw.openai_model      ?? "gpt-4.1-mini",
    anthropic_model:    raw.anthropic_model   ?? "claude-haiku-4-5-20251001",
    gemini_model:       raw.gemini_model      ?? "gemini-3.5-flash",
    openai_key_set:     !!(raw.openai_api_key    || process.env.OPENAI_API_KEY),
    anthropic_key_set:  !!(raw.anthropic_api_key || process.env.ANTHROPIC_API_KEY),
    gemini_key_set:     !!(raw.gemini_api_key    || process.env.GEMINI_API_KEY),
    openai_key_hint:    maskKey(raw.openai_api_key    ?? process.env.OPENAI_API_KEY),
    anthropic_key_hint: maskKey(raw.anthropic_api_key ?? process.env.ANTHROPIC_API_KEY),
    gemini_key_hint:    maskKey(raw.gemini_api_key    ?? process.env.GEMINI_API_KEY),
    table_ready:        tableExists
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
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => ({ key, value: isApiKey(key) ? encryptValue(value) : value }));

  if (upserts.length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido." }, { status: 400 });
  }

  let dbError: string | null = null;
  try {
    const { error } = await admin.from("app_config").upsert(upserts, { onConflict: "key" });
    if (error) {
      const tableNotFound = error.message?.includes("relation") || error.message?.includes("does not exist");
      if (tableNotFound) {
        return NextResponse.json({
          error: "Tabela app_config não encontrada. Execute a migration no Supabase SQL Editor."
        }, { status: 503 });
      }
      dbError = error.message;
    }
  } catch (err) {
    // Network failure (fetch failed) — settings saved to env only
    dbError = `Supabase inacessível: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (dbError) {
    return NextResponse.json({ error: dbError }, { status: 503 });
  }

  invalidateConfigCache();
  return NextResponse.json({ ok: true });
}
