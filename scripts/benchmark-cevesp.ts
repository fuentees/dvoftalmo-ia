/** Reproducible local benchmark of the production audit/channel functions. No network. */
import { writeFileSync } from "node:fs";
import { auditCevespRows } from "../services/cevesp-corrections";
import { aggregateEndemicCaseRows, buildChannel } from "../services/cevesp-endemic";
import { readJsonRows } from "./reconcile-cevesp";

type Timing = { minimumMs: number; medianMs: number; maximumMs: number; iterations: number };
function measure<T>(action: () => T, repetitions: number): { timing: Timing; result: T } {
  const durations: number[] = [];
  let result!: T;
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    result = action();
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { timing: { minimumMs: round(durations[0]), medianMs: round(durations[Math.floor(durations.length / 2)]), maximumMs: round(durations.at(-1)!), iterations: repetitions }, result };
}

function main() {
const args = process.argv.slice(2);
const file = args.find((arg) => arg.startsWith("--file="))?.slice(7) ?? "analise-cevesp/cevesp-export-completo.json";
const output = args.find((arg) => arg.startsWith("--out="))?.slice(6);
const rows = readJsonRows(file);
const nowText = args.find((arg) => arg.startsWith("--now="))?.slice(6) ?? "2026-10-09T12:00:00-03:00";
const now = new Date(nowText);
if (Number.isNaN(now.getTime())) throw new Error("invalid_benchmark_reference_date");
const sizesText = args.find((arg) => arg.startsWith("--sizes="))?.slice(8) ?? "1000,10000,50000,all";
const sizes = [...new Set(sizesText.split(",").map((item) => item === "all" ? rows.length : Number(item)).filter((size) => Number.isInteger(size) && size > 0 && size <= rows.length))];
if (!sizes.length) throw new Error("invalid_benchmark_sizes");
const currentYear = now.getFullYear();
// Deliberately synthetic denominator: this measures computation, not actual incidence.
const population = { byYear: new Map<number, number>(), years: [] as number[], latestYear: currentYear, forYear: (year: number) => ({ value: 40_000_000, sourceYear: year, exact: true }) };
const results: unknown[] = [];
for (const size of sizes) {
  // Deterministically sample across the entire export rather than only its first year.
  const sample = Array.from({ length: size }, (_, i) => rows[Math.floor((i * rows.length) / size)]);
  const repetitions = size >= 100_000 ? 1 : 3;
  const rssBeforeMb = process.memoryUsage().rss / 1024 / 1024;
  const audit = measure(() => auditCevespRows(sample, now), repetitions);
  const byProblem: Record<string, number> = {};
  for (const issue of audit.result) byProblem[issue.problem] = (byProblem[issue.problem] ?? 0) + 1;
  const affectedRecords = new Set(audit.result.map((issue) => issue.recordId)).size;
  const channel = measure(() => {
    const groups = aggregateEndemicCaseRows(sample.filter((row) => Number(row.ANO) >= currentYear - 10 && Number(row.ANO) <= currentYear), "week");
    const points = buildChannel(groups.filter((row) => row.yr < currentYear), groups.filter((row) => row.yr === currentYear), "week", population);
    return { groups: groups.length, points: points.length, validBaselineBuckets: points.filter((point) => point.baselineValid).length };
  }, repetitions);
  const result = { size, audit: { ...audit.timing, issues: audit.result.length, affectedRecords, byProblem }, channel: { ...channel.timing, ...channel.result, population: "synthetic_for_timing_only" }, rssBeforeMb: Math.round(rssBeforeMb), rssAfterMb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
  results.push(result);
  console.log(JSON.stringify(result));
  if (output) writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), referenceDate: nowText, nodeVersion: process.version, sourceRecords: rows.length, status: "partial", results }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
const report = {
  generatedAt: new Date().toISOString(), referenceDate: nowText, nodeVersion: process.version,
  sourceRecords: rows.length, sampleMethod: "evenly_spaced_source_rows", results,
  limits: ["Tempo de cálculo em memória; não mede rede, banco, navegador nem pico real de memória.", "Subamostras podem omitir semanas vizinhas da auditoria. Só a execução com todos os registros preserva o contexto completo.", "Contagens de problemas são resultados das regras automáticas; sugestões exigem conferência na fonte.", "Denominador sintético serve apenas ao benchmark. Não interpretar incidências desse ensaio."],
};
if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
try { main(); } catch { console.error("Benchmark não concluído: arquivo ou parâmetros inválidos. Dados privados e erros brutos omitidos."); process.exitCode = 1; }
