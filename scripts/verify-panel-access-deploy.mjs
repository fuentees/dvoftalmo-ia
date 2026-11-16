/**
 * Default: metadata-only check in a READ ONLY transaction.
 * --apply: explicitly applies only the four reviewed panel migrations atomically.
 * Requires pg in PANEL_ACCESS_SQL_RUNTIME or the local dependency tree.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const localRequire = createRequire(import.meta.url);
const { parse } = localRequire("dotenv");
const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  for (const filename of [".env.local", ".env"]) {
    const path = resolve(filename);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parse(readFileSync(path)))) process.env[key] ??= value;
  }
}
const runtimeRequire = process.env.PANEL_ACCESS_SQL_RUNTIME
  ? createRequire(pathToFileURL(resolve(process.env.PANEL_ACCESS_SQL_RUNTIME, "package.json")))
  : localRequire;
const migrationFiles = [
  "20261009000002_cevesp_cache_access.sql",
  "20261009000003_profiles_role_guard.sql",
  "20261009000004_corrections_review_guard.sql",
  "20261116000001_cevesp_distribution_validation.sql",
];
const patches = migrationFiles.map((name) => {
  const sql = readFileSync(resolve("supabase/migrations", name), "utf8");
  return { name, version: name.slice(0, 14), sql, sha256: createHash("sha256").update(sql).digest("hex") };
});

export function belongsToConfiguredProject(value, configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) {
  try {
    const appUrl = new URL(configuredUrl);
    const connection = new URL(value);
    const project = appUrl.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/)?.[1];
    const pooler = /(?:^|\.)pooler\.supabase\.com$/.test(connection.hostname);
    return Boolean(project) && ["postgres:", "postgresql:"].includes(connection.protocol)
      && decodeURIComponent(connection.pathname) === "/postgres"
      && (connection.hostname === `db.${project}.supabase.co`
        || (pooler && decodeURIComponent(connection.username).endsWith(`.${project}`)));
  } catch {
    return false;
  }
}

export async function runAccessTransaction(client, apply, work) {
  let phase = "not_started";
  try {
    await client.query(apply ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
    phase = "open";
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await work();
    if (apply) {
      // Once COMMIT is sent, a lost response cannot prove whether it succeeded.
      phase = "commit_attempted";
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    return result;
  } catch (error) {
    let rollbackConfirmed = false;
    if (phase !== "not_started") {
      try { await client.query("ROLLBACK"); rollbackConfirmed = true; } catch { /* uncertain connection state */ }
    }
    const failure = new Error("Access transaction did not complete");
    failure.code = /^[A-Z0-9_]{1,30}$/.test(error?.code ?? "") ? error.code : "unavailable";
    failure.transactionOutcome = !apply ? "check_failed"
      : phase === "not_started" ? "apply_not_started"
      : phase === "commit_attempted" || !rollbackConfirmed ? "apply_outcome_unknown"
      : "apply_rolled_back";
    throw failure;
  }
}

async function connect() {
  const { Client } = runtimeRequire("pg");
  const candidates = ["DIRECT_URL", "DATABASE_URL"].filter((name) => process.env[name]);
  const attempts = [];
  for (const source of candidates) {
    if (!belongsToConfiguredProject(process.env[source])) {
      attempts.push({ source, sameConfiguredProject: false, connected: false });
      continue;
    }
    const url = new URL(process.env[source]);
    // Do not let connection URL SSL flags override certificate verification.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
    const client = new Client({
      connectionString: url.toString(), ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 15_000, application_name: "panel_access_metadata_review",
    });
    try {
      await client.connect();
      attempts.push({ source, sameConfiguredProject: true, connected: true });
      return { client, attempts };
    } catch (error) {
      await client.end().catch(() => {});
      attempts.push({ source, sameConfiguredProject: true, connected: false,
        errorCode: /^[A-Z0-9_]{1,30}$/.test(error?.code ?? "") ? error.code : "unavailable",
        reason: /timeout/i.test(error?.message ?? "") ? "connection_timeout"
          : /certificate|TLS|SSL/i.test(error?.message ?? "") ? "tls_validation_failed"
          : /password|authentication|SASL/i.test(error?.message ?? "") ? "authentication_failed"
          : "connection_unavailable" });
    }
  }
  console.log(JSON.stringify({ mode: "unverified", connectionAttempts: attempts }, null, 2));
  return null;
}

export async function inspect(client) {
  const relations = (await client.query(`
    SELECT c.relname AS name, c.relrowsecurity AS rls,
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS client_anon_grant,
      has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS client_authenticated_grant,
      has_table_privilege('service_role', c.oid, 'SELECT') AS server_read,
      (c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        OR pg_has_role(current_user, c.relowner, 'MEMBER')
        OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS can_alter
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY c.relname
  `, [["sinan_tracoma_rows", "sinan_tracoma_import_log", "cevesp_notificacoes", "cevesp_sync_log", "profiles", "correction_queue"]])).rows;
  const functions = (await client.query(`
    SELECT p.proname AS name, p.oid::regprocedure::text AS signature, p.prosecdef AS security_definer,
      p.proconfig AS configuration,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS server_execute,
      CASE WHEN p.proname = 'handle_new_user' THEN
        p.prosrc ~* 'raw_user_meta_data[[:space:]]*->>?[[:space:]]*''role'''
        ELSE NULL END AS signup_uses_role_metadata,
      CASE WHEN p.proname = 'cevesp_relatorio' THEN
        obj_description(p.oid, 'pg_proc') = 'CEVESP report with per-row demographic validation v1'
        AND p.prosrc LIKE '%''sex_invalid_rows''%' AND p.prosrc LIKE '%''age_invalid_rows''%'
        ELSE NULL END AS demographic_validation
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (left(p.proname, 7) = 'cevesp_' OR p.proname = ANY($1::text[]))
    ORDER BY p.proname
  `, [["current_role", "handle_new_user", "guard_profile_role", "nottraconet_history_by_year", "traconet_history_by_year"]])).rows;
  const policies = (await client.query(`
    SELECT policyname AS name, cmd, roles,
      coalesce(qual LIKE '%auth.uid()%role%', false) AS restricts_role_in_using,
      coalesce(with_check LIKE '%role%', false) AS restricts_role_in_check
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' ORDER BY policyname
  `)).rows;
  const roleGuard = (await client.query(`SELECT EXISTS(
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'profiles_role_guard' AND tgenabled IN ('O', 'A') AND NOT tgisinternal
  ) AS present`)).rows[0].present;
  const correctionPermissions = (await client.query(`
    SELECT has_table_privilege('authenticated', 'public.correction_queue', 'UPDATE') AS table_update,
      has_table_privilege('authenticated', 'public.correction_queue', 'SELECT') AS can_read,
      has_table_privilege('authenticated', 'public.correction_queue', 'INSERT') AS can_propose,
      bool_and(has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))
        FILTER (WHERE a.attname IN ('status', 'reviewed_by', 'reviewed_at')) AS can_update_review_columns,
      bool_or(has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))
        FILTER (WHERE a.attname NOT IN ('status', 'reviewed_by', 'reviewed_at')) AS can_update_payload
    FROM pg_attribute a WHERE a.attrelid = 'public.correction_queue'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  `)).rows[0];
  const correctionPolicies = (await client.query(`
    SELECT policyname AS name, cmd, roles,
      coalesce(with_check LIKE '%status%pending%' AND with_check LIKE '%reviewed_by%IS NULL%'
        AND with_check LIKE '%reviewed_at%IS NULL%' AND with_check LIKE '%applied_at%IS NULL%', false) AS pending_insert_only,
      coalesce(qual LIKE '%status%pending%' AND with_check LIKE '%approved%' AND with_check LIKE '%rejected%'
        AND with_check LIKE '%reviewed_by%auth.uid()%' AND with_check LIKE '%reviewed_at%IS NOT NULL%'
        AND with_check LIKE '%applied_at%IS NULL%', false) AS recorded_staff_review
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'correction_queue' ORDER BY policyname
  `)).rows;
  const ledgerPresent = (await client.query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present")).rows[0].present;
  const ledger = ledgerPresent ? (await client.query(
    "SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[]) ORDER BY version",
    [patches.map((patch) => patch.version)]
  )).rows.map((row) => row.version) : [];
  return { relations, functions, profilePolicies: policies, roleGuard, correctionPermissions, correctionPolicies,
    ledgerPresent, appliedVersions: ledger };
}

export function assertProtected(state) {
  const cacheNames = ["cevesp_notificacoes", "cevesp_sync_log"];
  const caches = state.relations.filter((row) => cacheNames.includes(row.name));
  if (caches.length !== 2 || caches.some((row) => !row.rls || row.client_anon_grant || row.client_authenticated_grant || !row.server_read)) {
    throw new Error("Cache permission post-check failed");
  }
  const cacheFunctions = state.functions.filter((fn) => fn.name.startsWith("cevesp_"));
  if (cacheFunctions.length < 13 || cacheFunctions.some((fn) => fn.anon_execute || fn.authenticated_execute || !fn.server_execute
    || !fn.configuration?.includes('search_path=public, pg_temp'))) {
    throw new Error("RPC permission post-check failed");
  }
  if (!cacheFunctions.some((fn) => fn.name === "cevesp_relatorio" && fn.demographic_validation)) {
    throw new Error("Demographic validation post-check failed");
  }
  const roleLookup = state.functions.find((fn) => fn.name === "current_role");
  const signup = state.functions.find((fn) => fn.name === "handle_new_user");
  const guard = state.functions.find((fn) => fn.name === "guard_profile_role");
  if (!state.roleGuard || !roleLookup?.security_definer || roleLookup.anon_execute
    || !roleLookup.configuration?.includes('search_path=""') || !signup?.security_definer
    || signup.signup_uses_role_metadata || signup.anon_execute || signup.authenticated_execute
    || !signup.configuration?.includes('search_path=""') || !guard || guard.security_definer
    || !guard.configuration?.includes('search_path=""')) {
    throw new Error("Profile role post-check failed");
  }
  const queue = state.relations.find((row) => row.name === "correction_queue");
  const permissions = state.correctionPermissions;
  if (!queue?.rls || queue.client_anon_grant || !queue.server_read
    || permissions.table_update || permissions.can_update_payload || !permissions.can_read
    || !permissions.can_propose || !permissions.can_update_review_columns
    || !state.correctionPolicies.some((policy) => policy.name === "corrections_insert" && policy.pending_insert_only)
    || !state.correctionPolicies.some((policy) => policy.name === "corrections_update" && policy.recorded_staff_review)) {
    throw new Error("Correction review post-check failed");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--check", "--apply"].includes(arg)) || args.length > 1) {
    throw new Error("Use either --check (default) or --apply.");
  }
  const apply = args.includes("--apply");
  const connection = await connect();
  if (!connection) { process.exitCode = 2; return; }
  const { client, attempts } = connection;
  let committed = false;
  try {
    const before = await runAccessTransaction(client, apply, async () => {
      const state = await inspect(client);
      if (apply) {
        const required = state.relations.filter((row) => ["cevesp_notificacoes", "cevesp_sync_log", "profiles", "correction_queue"].includes(row.name));
        if (required.length !== 4 || required.some((row) => !row.can_alter)) throw new Error("Migration ownership prerequisite failed");
        for (const patch of patches) await client.query(patch.sql);
        assertProtected(await inspect(client));
        if (state.ledgerPresent) {
          for (const patch of patches) await client.query(`
            INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
            VALUES ($1, $2, $3::text[]) ON CONFLICT (version) DO NOTHING
          `, [patch.version, patch.name.slice(15, -4), [patch.sql]]);
        }
      }
      return state;
    });
    committed = apply;
    console.log(JSON.stringify({
      mode: apply ? "applied_transactionally" : "metadata_read_only", connectionAttempts: attempts,
      patches: patches.map(({ name, sha256 }) => ({ name, sha256 })),
      ...(apply ? { postCheck: "passed", ledgerRecorded: before.ledgerPresent } : { state: before }),
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ mode: committed ? "applied_report_failed" : error?.transactionOutcome ?? "check_failed",
      errorCode: /^[A-Z0-9_]{1,30}$/.test(error?.code ?? "") ? error.code : "unavailable" }));
    process.exitCode = 1;
  } finally { await client.end().catch(() => {}); }
}

if (isMain) {
  main().catch(() => {
    console.log(JSON.stringify({ mode: "unverified", reason: "Connection check unavailable; sensitive details omitted" }));
    process.exitCode = 2;
  });
}
