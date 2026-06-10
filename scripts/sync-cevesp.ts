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
 */

import { config } from "dotenv";
import { existsSync, writeFileSync, readFileSync } from "fs";
if (existsSync(".env.local")) config({ path: ".env.local" });
else config();

import mysql from "mysql2/promise";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

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

function rowKey(row: Record<string, unknown>): string {
  const seed = [row.DtNotificacao ?? "", row.Unid_notificacao ?? "", row.GVE_NOME ?? "",
                row.SemEpidemio ?? "", row.MunicipioNotificacao ?? "", row.ANO ?? ""].join("|");
  return createHash("md5").update(seed).digest("hex");
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return s.match(/^\d{4}-\d{2}-\d{2}$/) ? s : null;
}

function clean(row: Record<string, unknown>): Record<string, unknown> {
  return {
    row_key:              rowKey(row),
    ANO:                  row.ANO         != null ? Number(row.ANO)         : null,
    Mes:                  row.Mes         != null ? Number(row.Mes)         : null,
    SemEpidemio:          row.SemEpidemio != null ? Number(row.SemEpidemio) : null,
    DtNotificacao:        toDate(row.DtNotificacao),
    MunicipioNotificacao: row.MunicipioNotificacao  != null ? String(row.MunicipioNotificacao)  : null,
    IbgeNotificacao:      row.IbgeNotificacao       != null ? String(row.IbgeNotificacao)       : null,
    GVE_NOME:             row.GVE_NOME              != null ? String(row.GVE_NOME)              : null,
    gve_numero:           row.gve_numero            != null ? Number(row.gve_numero)            : null,
    CodMacroGVE:          row.CodMacroGVE           != null ? String(row.CodMacroGVE)           : null,
    DRS_NOME:             row.DRS_NOME              != null ? String(row.DRS_NOME)              : null,
    drs_numero:           row.drs_numero            != null ? Number(row.drs_numero)            : null,
    SUBGRUPOS_VE:         row.SUBGRUPOS_VE          != null ? String(row.SUBGRUPOS_VE)          : null,
    Unid_notificacao:     row.Unid_notificacao      != null ? String(row.Unid_notificacao)      : null,
    nCNES:                row.nCNES                 != null ? String(row.nCNES)                 : null,
    UVIS:                 row.UVIS                  != null ? String(row.UVIS)                  : null,
    Nome_notificante:     row.Nome_notificante      != null ? String(row.Nome_notificante)      : null,
    CargoFuncao:          row.CargoFuncao           != null ? String(row.CargoFuncao)           : null,
    TotalCaso:            row.TotalCaso             != null ? Number(row.TotalCaso)             : null,
    SexMasc:              row.SexMasc               != null ? Number(row.SexMasc)               : null,
    SexFem:               row.SexFem                != null ? Number(row.SexFem)                : null,
    FxMenorUmAno:         row.FxMenorUmAno          != null ? Number(row.FxMenorUmAno)          : null,
    FxUmQuatro:           row.FxUmQuatro            != null ? Number(row.FxUmQuatro)            : null,
    FxCincoNove:          row.FxCincoNove           != null ? Number(row.FxCincoNove)           : null,
    FxDezQuatorze:        row.FxDezQuatorze         != null ? Number(row.FxDezQuatorze)         : null,
    FxQuizeOuMais:        row.FxQuizeOuMais         != null ? Number(row.FxQuizeOuMais)         : null,
    Surto:                row.Surto                 != null ? String(row.Surto)                 : null,
    NuSurto:              row.NuSurto               != null ? Number(row.NuSurto)               : null,
    NuColetaMaterialBio:  row.NuColetaMaterialBio   != null ? Number(row.NuColetaMaterialBio)   : null,
    ColetaMaterialBio:    row.ColetaMaterialBio     != null ? String(row.ColetaMaterialBio)     : null,
    NuAcaoEducativa:      row.NuAcaoEducativa       != null ? Number(row.NuAcaoEducativa)       : null,
    NuTreinamento:        row.NuTreinamento         != null ? Number(row.NuTreinamento)         : null,
    AfastamentoProfSintomatico: row.AfastamentoProfSintomatico != null ? String(row.AfastamentoProfSintomatico) : null,
    NuEncamimento:        row.NuEncamimento         != null ? Number(row.NuEncamimento)         : null,
    MedidaAdotada:        row.MedidaAdotada         != null ? String(row.MedidaAdotada)         : null,
    Excluido:             row.Excluido              != null ? Number(row.Excluido)              : 0,
    editable:             row.editable              != null ? Number(row.editable)              : 0,
  };
}

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
    connectTimeout: 15000
  });
  console.log("✅  MySQL conectado.");

  const years = await fetchYears(conn, table, fullSync, targetYear, currentYear);
  const allRows: Record<string, unknown>[] = [];

  for (const ano of years) {
    console.log(`\n  📅  Buscando ano ${ano}...`);
    const [rows] = await conn.query(`SELECT * FROM \`${table}\` WHERE ANO = ?`, [ano]) as [Array<Record<string, unknown>>, unknown];
    console.log(`     ${rows.length} registros`);
    allRows.push(...rows.map(clean));
  }

  await conn.end();

  console.log(`\n💾  Salvando ${allRows.length} registros em ${outFile}...`);
  writeFileSync(outFile, JSON.stringify(allRows), "utf8");
  const sizeMb = (Buffer.byteLength(JSON.stringify(allRows)) / 1024 / 1024).toFixed(1);
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
    console.error(`   Gere-o no escritório com: npm run sync-cevesp -- --export`);
    process.exit(1);
  }

  console.log(`📂  Lendo ${inFile}...`);
  const rows = JSON.parse(readFileSync(inFile, "utf8")) as Record<string, unknown>[];
  console.log(`   ${rows.length} registros encontrados`);

  const supabase = getSupabase();
  const startMs  = Date.now();
  let upserted   = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("cevesp_notificacoes")
      .upsert(batch, { onConflict: "row_key", ignoreDuplicates: false });
    if (error) {
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
    connectTimeout: 15000
  });
  console.log("✅  MySQL conectado.");

  const years   = await fetchYears(conn, table, fullSync, targetYear, currentYear);
  const startMs = Date.now();
  let total     = 0;

  for (const ano of years) {
    console.log(`\n  📅  Ano ${ano}...`);
    const [rows] = await conn.query(`SELECT * FROM \`${table}\` WHERE ANO = ?`, [ano]) as [Array<Record<string, unknown>>, unknown];
    console.log(`     ${rows.length} registros encontrados`);
    if (!rows.length) continue;

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map(clean);
      const { error } = await supabase
        .from("cevesp_notificacoes")
        .upsert(batch, { onConflict: "row_key", ignoreDuplicates: false });
      if (error) {
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
