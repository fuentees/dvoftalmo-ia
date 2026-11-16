/** Full-context automatic audit of a local export, with aggregate-only output. */
import { writeFileSync } from "node:fs";
import { auditCevespRows } from "../services/cevesp-corrections";
import { readJsonRows } from "./reconcile-cevesp";

function main() {
const args = process.argv.slice(2);
const file = args.find((arg) => arg.startsWith("--file="))?.slice(7) ?? "analise-cevesp/cevesp-export-completo.json";
const output = args.find((arg) => arg.startsWith("--out="))?.slice(6);
const referenceDate = args.find((arg) => arg.startsWith("--now="))?.slice(6) ?? "2026-10-09T12:00:00-03:00";
const now = new Date(referenceDate);
if (Number.isNaN(now.getTime())) throw new Error("invalid_audit_reference_date");
const rows = readJsonRows(file);
const findings = auditCevespRows(rows, now);
type YearQuality = { issues: number; affectedRecords: number; byProblem: Record<string, number> };
const byYear: Record<string, YearQuality> = {};
const recordsByYear = new Map<string, Set<string>>();
for (const finding of findings) {
  const year = finding.ano != null && Number.isInteger(finding.ano) && finding.ano >= 1990 && finding.ano <= 2100 ? String(finding.ano) : "sem_ano_valido";
  byYear[year] ??= { issues: 0, affectedRecords: 0, byProblem: {} };
  byYear[year].issues++;
  byYear[year].byProblem[finding.problem] = (byYear[year].byProblem[finding.problem] ?? 0) + 1;
  if (!recordsByYear.has(year)) recordsByYear.set(year, new Set());
  recordsByYear.get(year)!.add(finding.recordId);
}
for (const [year, records] of recordsByYear) byYear[year].affectedRecords = records.size;
const report = {
  generatedAt: new Date().toISOString(), referenceDate, sourceRecords: rows.length,
  issues: findings.length, affectedRecords: new Set(findings.map((finding) => finding.recordId)).size,
  byYear,
  limits: ["Apontamentos das regras automáticas; não corrigem nem certificam os registros.", "Um registro pode ter mais de um apontamento. Ano mostrado é o informado, que também pode estar errado.", "Faixa etária ausente pode refletir campos históricos não coletados; conferir ficha e versão da fonte antes de corrigir.", "Não contém IDs, nomes, territórios ou sugestões de mudança individuais."],
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) writeFileSync(output, json, { encoding: "utf8", mode: 0o600 });
console.log(json);
}
try { main(); } catch { console.error("Auditoria agregada não concluída: arquivo ou parâmetros inválidos. Dados privados e erros brutos omitidos."); process.exitCode = 1; }
