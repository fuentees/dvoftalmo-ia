/**
 * sync-cevesp.ts  — sincronização CEVESP ↔ Supabase em duas etapas
 *
 * PASSO 1 — no escritório (acessa MySQL mas Supabase bloqueado):
 *   npm run sync-cevesp -- --export            → exporta ano atual para cevesp-export.json
 *   npm run sync-cevesp -- --export --full     → exporta todos os anos
 *   npm run sync-cevesp -- --export --year 2025
 *
 * PASSO 2 — em casa / Vercel (acessa Supabase mas não o MySQL):
 *   npm run sync-cevesp -- --import            → importa cevesp-export.json para Supabase
 *   npm run sync-cevesp -- --import --file cevesp-export-2025.json
 *
 * MODO DIRETO (quando ambos acessíveis):
 *   npm run sync-cevesp -- --full
 *
 * LIMPEZA DO CACHE ANTIGO (linhas sem ID do MySQL, chave por hash):
 *   adicione --purge-legacy ao --import ou ao modo direto. As linhas antigas são apagadas
 *   do cache (não do MySQL) somente depois que todos os lotes forem enviados sem erro.
 *
 * Cada ano inclui também os registros DIGITADOS naquele ano (created_at) com ANO errado
 * ou vazio, para que a auditoria de qualidade consiga encontrá-los.
 */

import { config } from "dotenv";
import { existsSync, writeFileSync, readFileSync } from "fs";
if (existsSync(".env.local")) config({ path: ".env.local" });
else config();

import mysql from "mysql2/promise";
import { createClient } from "@supabase/supabase-js";
import { CEVESP_YEAR_WHERE, cevespYearParams, cleanRow } from "../lib/cevesp-clean";

const BATCH_SIZE = 500;

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`❌  Variável ${name} não configurada.`); process.exit(1); }
  return v;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) { console.error("❌  SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_URL não configurado."); process.exit(1); }
  return createClient(url, required("SUPABASE_SERVICE_ROLE_KEY"));
}

const clean = cleanRow;

async function fetchYears(conn: mysql.Connection, table: string, fullSync: boolean, targetYear: number | null, currentYear: number) {
  if (fullSync) {
    const [[r]] = await conn.query(`SELECT MIN(ANO) AS mn, MAX(ANO) AS mx FROM \`${table}\``) as [Array<{mn: number, mx: number}>, unknown];
    const min = r?.mn ?? currentYear;
    const max = r?.mx ?? currentYear;
    console.log(`📦  Exportando anos ${min}–${max}`);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }
  if (targetYear) { console.log(`📦  Exportando ano ${targetYear}`); return [targetYear]; }
  console.log(`📦  Exportando ano atual (${currentYear})`);
  return [currentYear];
}

/** Registros do ano, incluindo os digitados no ano com ANO errado (ver CEVESP_YEAR_WHERE). */
async function fetchRowsForYear(conn: mysql.Connection, table: string, ano: number) {
  const [rows] = await conn.query(
    `SELECT * FROM \`${table}\` WHERE ${CEVESP_YEAR_WHERE}`,
    cevespYearParams(ano)
  ) as [Array<Record<string, unknown>>, unknown];
  return rows;
}

function dedupByKey(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = String(r.row_key ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Apaga do cache as linhas sem ID do MySQL (chave antiga por hash), só dos anos que
 * acabaram de ser enviados — os outros anos continuam com os dados antigos até serem
 * sincronizados de novo.
 */
async function purgeLegacy(supabase: ReturnType<typeof getSupabase>, years: number[]) {
  if (!years.length) return;
  const { count, error } = await supabase
    .from("cevesp_notificacoes")
    .delete({ count: "exact" })
    .not("row_key", "like", "id:%")
    .in("ANO", years);
  if (error) { console.error(`❌  Falha ao limpar cache antigo: ${error.message}`); return; }
  console.log(`🧹  ${count ?? 0} linha(s) antigas (sem ID do MySQL) removidas do cache.`);
}

async function doExport(args: string[]) {
  const fullSync  = args.includes("--full");
  const yearArg   = args.find(a => a.startsWith("--year="))?.split("=")[1]
                 ?? (args.includes("--year") ? args[args.indexOf("--year") + 1] : null);
  const targetYear = yearArg ? parseInt(yearArg, 10) : null;
  const currentYear = new Date().getFullYear();
  const outFile = args.find(a => a.startsWith("--file="))?.split("=")[1]
               ?? (args.includes("--file") ? args[args.indexOf("--file") + 1] : null)
               ?? "cevesp-export.json";

  const table = (() => {
    const t = process.env.NOTIFY_DB_TABLE;
    if (!t || !/^[a-zA-Z0-9_]+$/.test(t)) { console.error("❌  NOTIFY_DB_TABLE inválido."); process.exit(1); }
    return t;
  })();

  console.log("🔌  Conectando ao MySQL CEVESP...");
  const conn = await mysql.createConnection({
    host:           required("NOTIFY_DB_HOST"),
    port:           Number(process.env.NOTIFY_DB_PORT ?? 3306),
    database:       required("NOTIFY_DB_NAME"),
    user:           required("NOTIFY_DB_USER"),
    password:       required("NOTIFY_DB_PASSWORD"),
    charset:        "utf8mb4",
    dateStrings:    true,
    connectTimeout: 15000
  });
  console.log("✅  MySQL conectado.");

  const years = await fetchYears(conn, table, fullSync, targetYear, currentYear);
  const allRows: Record<string, unknown>[] = [];

  for (const ano of years) {
    console.log(`\n  📅  Buscando ano ${ano}...`);
    const rows = await fetchRowsForYear(conn, table, ano);
    console.log(`     ${rows.length} registros`);
    for (const row of rows) allRows.push(clean(row));
  }

  await conn.end();

  // Um registro pode vir em dois anos (ANO e ano de digitação); a chave é o ID
  const unique = dedupByKey(allRows);
  const json = JSON.stringify(unique);
  console.log(`\n💾  Salvando ${unique.length} registros em ${outFile}...`);
  writeFileSync(outFile, json, "utf8");
  const sizeMb = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
  console.log(`✅  Arquivo salvo: ${outFile} (${sizeMb} MB)`);
  console.log(`\nAgora leve o arquivo para casa e rode:`);
  console.log(`  npm run sync-cevesp -- --import --file ${outFile}`);
}

async function doImport(args: string[]) {
  const inFile = args.find(a => a.startsWith("--file="))?.split("=")[1]
              ?? (args.includes("--file") ? args[args.indexOf("--file") + 1] : null)
              ?? "cevesp-export.json";

  if (!existsSync(inFile)) {
    console.error(`❌  Arquivo ${inFile} não encontrado.`);
    console.error(`   Gere-o no escritório com: npm run sync-export`);
    process.exit(1);
  }

  console.log(`📂  Lendo ${inFile}...`);
  // Reaplica a limpeza: arquivos exportados por versões antigas não têm ID na chave
  const allRows = (JSON.parse(readFileSync(inFile, "utf8")) as Record<string, unknown>[]).map(clean);
  const rows = dedupByKey(allRows);
  console.log(`   ${rows.length} registros (${allRows.length - rows.length} duplicatas removidas)`);

  const supabase = getSupabase();
  const startMs  = Date.now();
  let upserted   = 0;
  let failed     = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("cevesp_notificacoes")
      .upsert(batch, { onConflict: "row_key", ignoreDuplicates: false });
    if (error) {
      failed++;
      console.error(`\n❌  Batch ${Math.floor(i / BATCH_SIZE) + 1} erro: ${error.message}`);
    } else {
      upserted += batch.length;
      process.stdout.write(`\r   ${upserted}/${rows.length} enviados ao Supabase...`);
    }
  }

  await supabase.from("cevesp_sync_log").insert({
    rows_upserted: upserted,
    duration_ms:   Date.now() - startMs,
    mode:          "import"
  });

  if (args.includes("--purge-legacy")) {
    if (failed) console.error("⚠️  Limpeza do cache antigo ignorada: houve lotes com erro.");
    else await purgeLegacy(supabase, [...new Set(rows.map((r) => Number(r.ANO)).filter(Number.isInteger))]);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n\n✅  Import concluído: ${upserted} registros em ${elapsed}s`);
  console.log("   O Vercel agora usa dados reais do CEVESP via cache Supabase.");
}

async function doDirectSync(args: string[]) {
  const fullSync  = args.includes("--full");
  const yearArg   = args.find(a => a.startsWith("--year="))?.split("=")[1]
                 ?? (args.includes("--year") ? args[args.indexOf("--year") + 1] : null);
  const targetYear = yearArg ? parseInt(yearArg, 10) : null;
  const currentYear = new Date().getFullYear();

  const supabase = getSupabase();
  const table    = (() => {
    const t = process.env.NOTIFY_DB_TABLE;
    if (!t || !/^[a-zA-Z0-9_]+$/.test(t)) { console.error("❌  NOTIFY_DB_TABLE inválido."); process.exit(1); }
    return t;
  })();

  console.log("🔌  Conectando ao MySQL CEVESP...");
  const conn = await mysql.createConnection({
    host:           required("NOTIFY_DB_HOST"),
    port:           Number(process.env.NOTIFY_DB_PORT ?? 3306),
    database:       required("NOTIFY_DB_NAME"),
    user:           required("NOTIFY_DB_USER"),
    password:       required("NOTIFY_DB_PASSWORD"),
    charset:        "utf8mb4",
    dateStrings:    true,
    connectTimeout: 15000
  });
  console.log("✅  MySQL conectado.");

  const years   = await fetchYears(conn, table, fullSync, targetYear, currentYear);
  const startMs = Date.now();
  let total     = 0;
  let failed    = 0;

  for (const ano of years) {
    console.log(`\n  📅  Ano ${ano}...`);
    const rows = dedupByKey((await fetchRowsForYear(conn, table, ano)).map(clean));
    console.log(`     ${rows.length} registros encontrados`);
    if (!rows.length) continue;

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("cevesp_notificacoes")
        .upsert(batch, { onConflict: "row_key", ignoreDuplicates: false });
      if (error) {
        failed++;
        console.error(`     ❌  Batch erro: ${error.message}`);
      } else {
        inserted += batch.length;
        process.stdout.write(`\r     ${inserted}/${rows.length} upsertados...`);
      }
    }
    console.log(`\n     ✅  ${inserted} sincronizados para ${ano}`);
    total += inserted;
  }

  await conn.end();
  await supabase.from("cevesp_sync_log").insert({
    ano:           targetYear ?? (fullSync ? null : currentYear),
    rows_upserted: total,
    duration_ms:   Date.now() - startMs,
    mode:          fullSync ? "full" : targetYear ? "year" : "direct"
  });

  if (args.includes("--purge-legacy")) {
    if (failed) console.error("⚠️  Limpeza do cache antigo ignorada: houve lotes com erro.");
    else await purgeLegacy(supabase, years);
  }

  console.log(`\n✅  Sync direto concluído: ${total} registros em ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--export")) {
    await doExport(args);
  } else if (args.includes("--import")) {
    await doImport(args);
  } else {
    await doDirectSync(args);
  }
}

main().catch(err => {
  console.error("❌  Erro fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
