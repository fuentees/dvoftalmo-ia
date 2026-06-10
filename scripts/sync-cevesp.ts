/**
 * sync-cevesp.ts
 *
 * Roda DENTRO da rede SES-SP: conecta no MySQL CEVESP e grava no Supabase.
 * Depois, o Vercel lê do Supabase como fallback quando o MySQL está inacessível.
 *
 * Uso:
 *   npm run sync-cevesp               → sincroniza ano atual (rápido)
 *   npm run sync-cevesp -- --full     → sincroniza todos os anos (pode demorar)
 *   npm run sync-cevesp -- --year 2023 → sincroniza apenas 2023
 *
 * Requer: .env com NOTIFY_DB_HOST, NOTIFY_DB_NAME, NOTIFY_DB_USER,
 *         NOTIFY_DB_PASSWORD, NOTIFY_DB_TABLE, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const BATCH_SIZE = 500;

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`❌  Variável ${name} não configurada.`); process.exit(1); }
  return v;
}

function rowKey(row: Record<string, unknown>): string {
  const seed = [
    row.DtNotificacao ?? "",
    row.Unid_notificacao ?? "",
    row.GVE_NOME ?? "",
    row.SemEpidemio ?? "",
    row.MunicipioNotificacao ?? "",
    row.ANO ?? ""
  ].join("|");
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
    row_key:                rowKey(row),
    ANO:                    row.ANO   != null ? Number(row.ANO)   : null,
    Mes:                    row.Mes   != null ? Number(row.Mes)   : null,
    SemEpidemio:            row.SemEpidemio != null ? Number(row.SemEpidemio) : null,
    DtNotificacao:          toDate(row.DtNotificacao),
    MunicipioNotificacao:   row.MunicipioNotificacao != null ? String(row.MunicipioNotificacao) : null,
    IbgeNotificacao:        row.IbgeNotificacao      != null ? String(row.IbgeNotificacao)      : null,
    GVE_NOME:               row.GVE_NOME             != null ? String(row.GVE_NOME)             : null,
    gve_numero:             row.gve_numero           != null ? Number(row.gve_numero)           : null,
    CodMacroGVE:            row.CodMacroGVE          != null ? String(row.CodMacroGVE)          : null,
    DRS_NOME:               row.DRS_NOME             != null ? String(row.DRS_NOME)             : null,
    drs_numero:             row.drs_numero           != null ? Number(row.drs_numero)           : null,
    SUBGRUPOS_VE:           row.SUBGRUPOS_VE         != null ? String(row.SUBGRUPOS_VE)         : null,
    Unid_notificacao:       row.Unid_notificacao     != null ? String(row.Unid_notificacao)     : null,
    nCNES:                  row.nCNES                != null ? String(row.nCNES)                : null,
    UVIS:                   row.UVIS                 != null ? String(row.UVIS)                 : null,
    Nome_notificante:       row.Nome_notificante     != null ? String(row.Nome_notificante)     : null,
    CargoFuncao:            row.CargoFuncao          != null ? String(row.CargoFuncao)          : null,
    TotalCaso:              row.TotalCaso            != null ? Number(row.TotalCaso)            : null,
    SexMasc:                row.SexMasc              != null ? Number(row.SexMasc)              : null,
    SexFem:                 row.SexFem               != null ? Number(row.SexFem)               : null,
    FxMenorUmAno:           row.FxMenorUmAno         != null ? Number(row.FxMenorUmAno)         : null,
    FxUmQuatro:             row.FxUmQuatro           != null ? Number(row.FxUmQuatro)           : null,
    FxCincoNove:            row.FxCincoNove          != null ? Number(row.FxCincoNove)          : null,
    FxDezQuatorze:          row.FxDezQuatorze        != null ? Number(row.FxDezQuatorze)        : null,
    FxQuizeOuMais:          row.FxQuizeOuMais        != null ? Number(row.FxQuizeOuMais)        : null,
    Surto:                  row.Surto                != null ? String(row.Surto)                : null,
    NuSurto:                row.NuSurto              != null ? Number(row.NuSurto)              : null,
    NuColetaMaterialBio:    row.NuColetaMaterialBio  != null ? Number(row.NuColetaMaterialBio)  : null,
    ColetaMaterialBio:      row.ColetaMaterialBio    != null ? String(row.ColetaMaterialBio)    : null,
    NuAcaoEducativa:        row.NuAcaoEducativa      != null ? Number(row.NuAcaoEducativa)      : null,
    NuTreinamento:          row.NuTreinamento        != null ? Number(row.NuTreinamento)        : null,
    AfastamentoProfSintomatico: row.AfastamentoProfSintomatico != null ? String(row.AfastamentoProfSintomatico) : null,
    NuEncamimento:          row.NuEncamimento        != null ? Number(row.NuEncamimento)        : null,
    MedidaAdotada:          row.MedidaAdotada        != null ? String(row.MedidaAdotada)        : null,
    Excluido:               row.Excluido             != null ? Number(row.Excluido)             : 0,
    editable:               row.editable             != null ? Number(row.editable)             : 0,
  };
}

async function main() {
  const args     = process.argv.slice(2);
  const fullSync = args.includes("--full");
  const yearArg  = args.find(a => a.startsWith("--year="))?.split("=")[1]
                ?? (args[args.indexOf("--year") + 1] ?? null);
  const targetYear = yearArg ? parseInt(yearArg, 10) : null;
  const currentYear = new Date().getFullYear();

  const supabase = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY")
  );

  const table = (() => {
    const t = process.env.NOTIFY_DB_TABLE;
    if (!t) { console.error("❌  NOTIFY_DB_TABLE não configurado."); process.exit(1); }
    if (!/^[a-zA-Z0-9_]+$/.test(t)) { console.error("❌  NOTIFY_DB_TABLE inválido."); process.exit(1); }
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

  let years: number[];
  if (fullSync) {
    const [[r]] = await conn.query(`SELECT MIN(ANO) AS mn, MAX(ANO) AS mx FROM \`${table}\``) as [Array<{mn: number, mx: number}>, unknown];
    const min = r?.mn ?? currentYear;
    const max = r?.mx ?? currentYear;
    years = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    console.log(`📦  Sync COMPLETO: anos ${min}–${max}`);
  } else if (targetYear) {
    years = [targetYear];
    console.log(`📦  Sync ano ${targetYear}`);
  } else {
    years = [currentYear];
    console.log(`📦  Sync ano atual (${currentYear})`);
  }

  let totalUpserted = 0;
  const startMs = Date.now();

  for (const ano of years) {
    console.log(`\n  📅  Ano ${ano}...`);
    const [rows] = await conn.query(
      `SELECT * FROM \`${table}\` WHERE ANO = ?`,
      [ano]
    ) as [Array<Record<string, unknown>>, unknown];

    console.log(`     ${rows.length} registros encontrados`);
    if (!rows.length) continue;

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map(clean);
      const { error } = await supabase
        .from("cevesp_notificacoes")
        .upsert(batch, { onConflict: "row_key", ignoreDuplicates: false });
      if (error) {
        console.error(`     ❌  Batch ${Math.floor(i / BATCH_SIZE) + 1} erro:`, error.message);
      } else {
        inserted += batch.length;
        process.stdout.write(`\r     ${inserted}/${rows.length} upsertados...`);
      }
    }
    console.log(`\n     ✅  ${inserted} registros sincronizados para ${ano}`);
    totalUpserted += inserted;
  }

  await conn.end();

  // Registra o sync no log
  await supabase.from("cevesp_sync_log").insert({
    ano:           targetYear ?? (fullSync ? null : currentYear),
    rows_upserted: totalUpserted,
    duration_ms:   Date.now() - startMs,
    mode:          fullSync ? "full" : targetYear ? "year" : "recent"
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n✅  Sync concluído: ${totalUpserted} registros em ${elapsed}s`);
  console.log("   O Vercel agora usará o cache do Supabase quando fora da rede SES-SP.");
}

main().catch(err => {
  console.error("❌  Erro fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
