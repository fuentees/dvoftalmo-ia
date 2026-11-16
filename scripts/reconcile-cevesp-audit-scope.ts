/** Local reproduction of API audit context; outputs only aggregate comparisons. */
import { writeFileSync } from "node:fs";
import { auditCevespRows } from "../services/cevesp-corrections";
import { readJsonRows } from "./reconcile-cevesp";
import { excluidoFlag } from "../lib/cevesp-clean";

function suspiciousYear(row: Record<string, unknown>) {
  if (!row.created_at_origem) return false;
  const created = String(row.created_at_origem).slice(0, 10);
  const createdYear = Number(created.slice(0, 4));
  const year = row.ANO == null ? null : Number(row.ANO);
  if (year == null || year > createdYear) return true;
  if (year >= createdYear - 1) return false;
  if (!row.DtNotificacao) return true;
  const date = String(row.DtNotificacao).slice(0, 10);
  const month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
  // PostgreSQL clamps leap day when adding a year interval.
  const maximumDay = new Date(Date.UTC(createdYear, month, 0)).getUTCDate();
  const adjusted = Date.UTC(createdYear, month - 1, Math.min(day, maximumDay));
  const gap = (Date.parse(`${created}T00:00:00Z`) - adjusted) / 86_400_000;
  return gap >= 0 && gap <= 14;
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => arg.startsWith("--file="))?.slice(7) ?? "analise-cevesp/cevesp-export-completo.json";
  const output = args.find((arg) => arg.startsWith("--out="))?.slice(6);
  const year = Number(args.find((arg) => arg.startsWith("--year="))?.slice(7) ?? 2026);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new Error("invalid_year");
  const rows: Array<Record<string, unknown>> = readJsonRows(file).map((row): Record<string, unknown> => ({ ...row, ano_suspeito: suspiciousYear(row) }));
  const now = new Date("2026-10-09T12:00:00-03:00");
  const createdInYear = (row: Record<string, unknown>) => String(row.created_at_origem ?? "").slice(0, 4) === String(year);
  const inScope = (row: Record<string, unknown>) => Number(row.ANO) === year || ((row.ano_suspeito === true || row.ANO == null || Number(row.ANO) > year) && createdInYear(row));
  const context = rows.filter((row) => (row.ANO != null && Number(row.ANO) >= year - 1 && Number(row.ANO) <= year) || row.ANO == null || (row.ano_suspeito === true && createdInYear(row)));
  const summarize = (issues: ReturnType<typeof auditCevespRows>) => {
    const byProblem: Record<string, number> = {};
    for (const issue of issues) byProblem[issue.problem] = (byProblem[issue.problem] ?? 0) + 1;
    return { issues: issues.length, affectedRecords: new Set(issues.map((issue) => issue.recordId)).size, byProblem };
  };
  const requestedRows = rows.filter((row) => Number(row.ANO) === year && excluidoFlag(row.Excluido) === 0);
  const knownSum = (field: string) => requestedRows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  const report = {
    generatedAt: new Date().toISOString(), year, referenceDate: now.toISOString(), sourceRecords: rows.length,
    originalYearOnlyWithinFullHistory: summarize(auditCevespRows(rows, now, (row) => Number(row.ANO) === year)),
    expandedScopeWithinFullHistory: summarize(auditCevespRows(rows, now, inScope)),
    expandedScopeWithinApiYearContext: summarize(auditCevespRows(context, now, inScope)),
    contextRecords: context.length, scopeRowsWhoseOriginalYearDiffers: rows.filter((row) => Number(row.ANO) !== year && inScope(row) && excluidoFlag(row.Excluido) === 0).length,
    originalYearRawActiveFieldSums: { cases: knownSum("TotalCaso"), masculine: knownSum("SexMasc"), feminine: knownSum("SexFem") },
    largestOriginalYearNotificationDateYear: Math.max(...requestedRows.map((row) => Number(String(row.DtNotificacao ?? "").slice(0, 4))).filter((value) => Number.isInteger(value))),
    largestExpandedScopeNotificationDateYear: Math.max(...rows.filter(inScope).map((row) => Number(String(row.DtNotificacao ?? "").slice(0, 4))).filter((value) => Number.isInteger(value))),
    limits: ["Emulação local da coluna SQL ano_suspeito e do modo full do endpoint; sem nova consulta externa.", "Contextos e inScope diferentes alteram as comparações entre semanas. Estes recortes não têm contagens de problemas diretamente equivalentes.", "Somas brutas de campos ativos com ANO informado; não são percentuais nem total epidemiológico validado.", "Uma regra individual por registro pode ocultar outros problemas individuais; problemas estruturais são adicionais."],
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) writeFileSync(output, json, { encoding: "utf8", mode: 0o600 });
  console.log(json);
}
try { main(); } catch { console.error("Comparação agregada de escopos indisponível; nenhum dado privado foi exibido."); process.exitCode = 1; }
