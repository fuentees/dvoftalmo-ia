/** Cache inventory only: no source export is available locally for reconciliation. */
import { writeFileSync } from "node:fs";
import { createReadOnlyCacheClient } from "./reconcile-cevesp";

async function main() {
  const client = createReadOnlyCacheClient();
  const countAt = async () => {
    const { count, error } = await client.from("sinan_tracoma_rows").select("id", { count: "exact", head: true });
    if (error || count == null) throw new Error("tracoma_cache_count_failed");
    return count;
  };
  const beforeCount = await countAt();
  const counts: Record<string, Record<string, number>> = {};
  let total = 0;
  for (let from = 0; ; from += 1000) {
    // No clinical raw JSON, names, patient IDs, addresses or unit names are retrieved.
    const { data, error } = await client.from("sinan_tracoma_rows").select("source_bank,ano").order("id").range(from, from + 999);
    if (error) throw new Error("tracoma_cache_select_failed");
    for (const row of data ?? []) {
      const bank = row.source_bank === "traconet" || row.source_bank === "nottraconet" ? row.source_bank : "unknown_bank";
      const year = row.ano != null && Number.isInteger(Number(row.ano)) && Number(row.ano) >= 1990 && Number(row.ano) <= 2100 ? String(row.ano) : "sem_ano_valido";
      counts[bank] ??= {};
      counts[bank][year] = (counts[bank][year] ?? 0) + 1;
      total++;
    }
    if (!data || data.length < 1000) break;
  }
  const afterCount = await countAt();
  const report = {
    generatedAt: new Date().toISOString(), mode: "read_only_cache_inventory", totalRecords: total,
    byBankAndYear: counts, beforeCount, afterCount, consistentCounts: beforeCount === afterCount && afterCount === total,
    reconciledWithSource: false,
    limits: ["Nenhuma exportação SINAN/REDCap de origem disponível nesta pasta para comparação.", "Contagens de linhas por banco; TRACONET e NOTTRACONET têm unidades distintas e não devem ser somados como casos.", "Não verifica examinados, positivos, denominadores ou correção de registros.", "SELECTs paginados não são snapshot transacional."],
  };
  const output = process.argv.slice(2).find((arg) => arg.startsWith("--out="))?.slice(6);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) writeFileSync(output, json, { encoding: "utf8", mode: 0o600 });
  console.log(json);
}
void main().catch(() => { console.error("Inventário de tracoma indisponível; dados e erros privados omitidos. Nenhuma alteração remota realizada."); process.exitCode = 1; });
