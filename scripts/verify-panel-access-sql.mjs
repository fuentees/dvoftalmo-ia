/** Isolated, in-memory PostgreSQL regression runner. Never loads .env or connects remotely. */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { inspect, assertProtected, runAccessTransaction } from "./verify-panel-access-deploy.mjs";

const runtimeDirectory = process.env.PANEL_ACCESS_SQL_RUNTIME;
const runtimeRequire = runtimeDirectory
  ? createRequire(pathToFileURL(resolve(runtimeDirectory, "package.json")))
  : createRequire(import.meta.url);
const { PGlite } = runtimeRequire("@electric-sql/pglite");
const { pgtap } = runtimeRequire("@electric-sql/pglite-pgtap");
const db = new PGlite({ extensions: { pgtap } });
const migrationsDirectory = resolve("supabase/migrations");
const migration = (name) => readFileSync(resolve(migrationsDirectory, name), "utf8");
const initial = migration("20260608160000_initial_schema.sql");
const originalDefinition = (pattern) => {
  const match = initial.match(pattern);
  if (!match) throw new Error("Required original schema definition was not found");
  return match[0];
};

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
    CREATE EXTENSION pgtap SCHEMA extensions;
    SET search_path = public, extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
    ${originalDefinition(/create type public\.user_role as enum[^;]+;/i)}
    ${originalDefinition(/create table public\.profiles \([\s\S]*?\n\);/i)}
    ALTER TABLE public.profiles ADD COLUMN selected_model text;
    ${originalDefinition(/create or replace function public\.handle_new_user\(\)[\s\S]*?\$\$;/i)}
    ${originalDefinition(/create or replace function public\.current_role\(\)[\s\S]*?\$\$;/i)}
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ${originalDefinition(/create policy "profiles_self_read"[^;]+;/i)}
    ${originalDefinition(/create policy "profiles_self_update"[^;]+;/i)}
  `);
  await db.exec(migration("20260609000001_correction_queue.sql"));
  // Actual cache tables/functions, including each corrective migration, in order.
  const cacheMigrations = readdirSync(migrationsDirectory).filter((name) =>
    name.endsWith(".sql") && (name.includes("cevesp") || [
      "20260611000000_sinan_tracoma_cache.sql",
      "20260621000001_tracoma_history_aggregate_functions.sql",
    ].includes(name)) && !name.includes("cache_access") && !name.includes("distribution_validation"));
  for (const name of cacheMigrations.sort()) {
    await db.exec(migration(name));
  }
  // Mimic a Supabase install whose browser roles inherited table/sequence grants.
  await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
  `);
  for (const name of [
    "20261008000002_sinan_tracoma_cache_access.sql",
    "20261009000002_cevesp_cache_access.sql",
    "20261009000003_profiles_role_guard.sql",
    "20261009000004_corrections_review_guard.sql",
    "20261116000001_cevesp_distribution_validation.sql",
  ]) {
    await db.exec(migration(name));
  }
  // Exercise the exact metadata post-check used by the optional deploy runner.
  const localClient = { query: (...args) => db.query(...args) };
  assertProtected(await inspect(localClient));
  console.log("Deployment metadata post-check: passed in local fixture");
  await assert.rejects(runAccessTransaction(localClient, true, async () => {
    await db.exec("ALTER TABLE public.cevesp_notificacoes DISABLE ROW LEVEL SECURITY; GRANT SELECT ON public.cevesp_notificacoes TO anon;");
    throw new Error("Synthetic migration failure before commit");
  }), (error) => error.transactionOutcome === "apply_rolled_back");
  assertProtected(await inspect(localClient));
  console.log("DDL permission rollback: passed in local fixture");
  let total = 0;
  let failed = 0;
  for (const name of [
    "sinan_tracoma_cache_access.test.sql",
    "cevesp_cache_access.test.sql",
    "profiles_role_guard.test.sql",
    "corrections_review_guard.test.sql",
    "corrections_review_legacy.test.sql",
    "cevesp_distribution_validation.test.sql",
  ]) {
    const sql = readFileSync(resolve("supabase/tests", name), "utf8").replaceAll(
      "/* APPLY_CORRECTIONS_REVIEW_MIGRATION */",
      () => migration("20261009000004_corrections_review_guard.sql")
    ).replaceAll("/* APPLY_PREVIOUS_CEVESP_REPORT */", () => migration("20260701000002_cevesp_relatorio_rpc.sql"))
      .replaceAll("/* APPLY_CEVESP_DISTRIBUTION_MIGRATION */", () => migration("20261116000001_cevesp_distribution_validation.sql"));
    const results = await db.exec(sql);
    const tap = results.flatMap((result) => result.rows)
      .flatMap((row) => Object.values(row)).filter((value) => typeof value === "string");
    const assertions = tap.filter((line) => /^(?:not )?ok \d+/.test(line));
    const failures = tap.filter((line) => /^not ok |# Looks like you (?:planned|ran)/.test(line));
    total += assertions.length;
    failed += failures.length;
    console.log(`${name}: ${assertions.length} checks, ${failures.length} failures`);
    for (const failure of failures) console.log(failure);
  }
  console.log(`Isolated SQL: ${total} checks, ${failed} failures`);
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  await db.close();
}
