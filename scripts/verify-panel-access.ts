/**
 * Read-only deployment check. Requests zero rows and never prints credentials,
 * table contents, identities, error messages, or endpoint URLs.
 * Run: npx tsx scripts/verify-panel-access.ts
 * Optional: SUPABASE_AUDIT_AUTH_TOKEN from a session already authorized for audit.
 * It does not sign in, mint tokens, change roles, or apply migrations.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { createClient } from "@supabase/supabase-js";

for (const filename of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) continue;
  const values = parse(readFileSync(path));
  for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
}

type Outcome = "denied" | "allowed" | "missing_schema" | "unverified";
type Check = { role: string; target: string; outcome: Outcome; expected: "denied" | "allowed"; passed: boolean; errorCode?: string; httpStatus?: number; denialEvidence?: "sql_permission" | "http_forbidden" };

async function main() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authToken = process.env.SUPABASE_AUDIT_AUTH_TOKEN;
  if (!rawUrl) {
    console.log(JSON.stringify({ status: "unverified", reason: "Supabase URL is not configured" }));
    process.exitCode = 2;
    return;
  }
  const url = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const roles = [
    { name: "anon", key: anonKey, token: undefined, expected: "denied" as const },
    { name: "authenticated", key: anonKey, token: authToken, expected: "denied" as const },
    { name: "service_role", key: serviceKey, token: undefined, expected: "allowed" as const },
  ];
  const targets = [
    { table: "sinan_tracoma_rows", columns: "id" },
    { table: "sinan_tracoma_import_log", columns: "id" },
    { table: "cevesp_notificacoes", columns: "id" },
    { table: "cevesp_sync_log", columns: "id" },
    { table: "cevesp_notificacoes", columns: "ano_suspeito,created_at_origem,ID" },
  ];
  const checks: Check[] = [];
  for (const role of roles) {
    if (!role.key || (role.name === "authenticated" && !role.token)) {
      checks.push({ role: role.name, target: "all", outcome: "unverified", expected: role.expected, passed: false });
      continue;
    }
    const client = createClient(url, role.key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        ...(role.token ? { headers: { Authorization: `Bearer ${role.token}` } } : {}),
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }),
      },
    });
    for (const target of targets) {
      // limit=0 prevents any notification, person, or import record being returned.
      const { error, status } = await client.from(target.table).select(target.columns).limit(0);
      const denialEvidence = error?.code === "42501" ? "sql_permission" as const : status === 403 ? "http_forbidden" as const : undefined;
      const outcome: Outcome = denialEvidence ? "denied" : !error ? "allowed"
        : ["PGRST205", "PGRST204", "42P01", "42703"].includes(error.code) ? "missing_schema"
        : "unverified";
      checks.push({
        role: role.name, target: `${target.table}(${target.columns})`, outcome,
        expected: role.expected, passed: outcome === role.expected,
        httpStatus: status,
        ...(denialEvidence ? { denialEvidence } : {}),
        ...(error?.code ? { errorCode: error.code } : {}),
      });
    }
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), mode: "read_only_zero_rows", checks,
    verification: "partial_http_only",
    sqlMetadataVerified: false,
    limitations: [
      "HTTP 403 proves the request was blocked, without identifying whether grants, RLS or another access layer caused the denial.",
      "SQL permission code 42501 identifies a database permission denial; this script does not inspect all privileges.",
      "An allowed zero-row request proves a grant; it does not prove records are visible under RLS.",
      "authenticated requires an authorized existing session token; no sign-in is performed.",
      "The migration ledger and table RLS metadata require a separate SQL check.",
    ],
  }, null, 2));
  process.exitCode = checks.some((check) => check.outcome === "allowed" && check.expected === "denied") ? 1
    : checks.some((check) => !check.passed) ? 2 : 0;
}

main().catch(() => {
  console.log(JSON.stringify({ status: "unverified", reason: "Access check could not complete; details omitted to protect credentials" }));
  process.exitCode = 2;
});
