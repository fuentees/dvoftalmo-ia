import type { ColumnStats, ChartData, CrossTabResult, TrendResult, DataAnalysisResult } from "@/lib/types";
import readXlsxFile from "read-excel-file/node";

type Row = Record<string, string | number | null>;

// ── Parsing ─────────────────────────────────────────────────────────────────

async function parseXlsx(buffer: Buffer): Promise<{ headers: string[]; rows: Row[] }> {
  const raw = (await readXlsxFile(buffer as never) as unknown) as Array<Array<unknown>>;
  if (raw.length < 2) return { headers: [], rows: [] };
  const headers = raw[0].map((h) => String(h ?? "").trim());
  const rows = raw.slice(1).map((row) => {
    const obj: Row = {};
    headers.forEach((h, i) => {
      const v = row[i];
      obj[h] = v === null || v === undefined || v === "" ? null : (typeof v === "number" ? v : String(v));
    });
    return obj;
  });
  return { headers, rows };
}

function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).map((line) => {
    const obj: Row = {};
    const values = line.split(sep).map((v) => v.replace(/^"|"$/g, "").trim());
    headers.forEach((h, i) => {
      const v = values[i] ?? "";
      if (v === "" || v === "NA" || v === "N/A" || v === "null") {
        obj[h] = null;
      } else {
        const n = Number(v);
        obj[h] = Number.isFinite(n) ? n : v;
      }
    });
    return obj;
  });
  return { headers, rows };
}

export async function parseFile(file: File): Promise<{ headers: string[]; rows: Row[] }> {
  if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
    return parseXlsx(Buffer.from(await file.arrayBuffer()));
  }
  const text = await file.text();
  return parseCsv(text);
}

// ── Statistics ───────────────────────────────────────────────────────────────

function numericValues(col: Array<string | number | null>): number[] {
  return col.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function frequencyTable(values: Array<string | null>, topN = 20): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) {
    if (v === null) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, topN)
  );
}

function isDateLike(values: Array<string | number | null>): boolean {
  const samples = values.filter((v): v is string => typeof v === "string").slice(0, 10);
  return samples.filter((v) => /^\d{4}[-/]\d{2}[-/]\d{2}/.test(v)).length > samples.length * 0.5;
}

export function computeColumnStats(col: Array<string | number | null>): ColumnStats {
  const nonNull = col.filter((v) => v !== null);
  const missing = col.length - nonNull.length;
  const nums = numericValues(col);

  if (nums.length > nonNull.length * 0.5) {
    const sorted = [...nums].sort((a, b) => a - b);
    const avg = mean(nums);
    return {
      type: "numeric",
      count: nonNull.length,
      missing,
      mean: Math.round(avg * 100) / 100,
      median: Math.round(median(sorted) * 100) / 100,
      stdDev: Math.round(stdDev(nums, avg) * 100) / 100,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      q1: Math.round(percentile(sorted, 25) * 100) / 100,
      q3: Math.round(percentile(sorted, 75) * 100) / 100
    };
  }

  const strings = col.filter((v): v is string => typeof v === "string");
  if (isDateLike(col)) {
    return { type: "date", count: nonNull.length, missing };
  }

  return {
    type: "categorical",
    count: nonNull.length,
    missing,
    frequencies: frequencyTable(strings)
  };
}

// ── Chart suggestions ─────────────────────────────────────────────────────────

export function suggestCharts(headers: string[], stats: Record<string, ColumnStats>): ChartData[] {
  const charts: ChartData[] = [];
  const categoricals = headers.filter((h) => stats[h]?.type === "categorical");
  const numerics = headers.filter((h) => stats[h]?.type === "numeric");
  const dates = headers.filter((h) => stats[h]?.type === "date");

  for (const cat of categoricals.slice(0, 3)) {
    const freqs = stats[cat]?.frequencies ?? {};
    const entries = Object.entries(freqs).slice(0, 15);
    if (entries.length < 2) continue;
    charts.push({
      type: "bar",
      title: `Frequencia: ${cat}`,
      data: entries.map(([name, value]) => ({ name, value })),
      xKey: "name",
      yKeys: ["value"]
    });
  }

  if (dates.length > 0 && numerics.length > 0) {
    const dateCol = dates[0];
    const numCol = numerics[0];
    charts.push({
      type: "line",
      title: `Tendencia: ${numCol} por ${dateCol}`,
      data: [],
      xKey: dateCol,
      yKeys: [numCol]
    });
  }

  return charts;
}

// ── Cross-tabulation ──────────────────────────────────────────────────────────

export function buildCrossTab(rows: Row[], rowVar: string, colVar: string): CrossTabResult {
  const table: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const r = String(row[rowVar] ?? "N/A");
    const c = String(row[colVar] ?? "N/A");
    if (!table[r]) table[r] = {};
    table[r][c] = (table[r][c] ?? 0) + 1;
  }
  return { rowVar, colVar, table };
}

// ── Trend detection ───────────────────────────────────────────────────────────

export function detectTrend(rows: Row[], valueCol: string, timeCol: string): TrendResult {
  const grouped: Record<string, number[]> = {};
  for (const row of rows) {
    const period = String(row[timeCol] ?? "").slice(0, 7);
    if (!period) continue;
    const val = Number(row[valueCol]);
    if (!Number.isFinite(val)) continue;
    if (!grouped[period]) grouped[period] = [];
    grouped[period].push(val);
  }
  const points = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, value: Math.round(mean(vals) * 100) / 100 }));

  return { variable: valueCol, timeColumn: timeCol, points };
}

// ── Interpretation ────────────────────────────────────────────────────────────

function interpretStats(fileName: string, headers: string[], stats: Record<string, ColumnStats>, rows: Row[]): string[] {
  const lines: string[] = [
    `Arquivo analisado: ${fileName} — ${rows.length} registros, ${headers.length} variaveis.`
  ];

  const numerics = headers.filter((h) => stats[h]?.type === "numeric");
  const categoricals = headers.filter((h) => stats[h]?.type === "categorical");
  const missingCols = headers.filter((h) => (stats[h]?.missing ?? 0) > rows.length * 0.1);

  if (numerics.length) {
    lines.push(`Variaveis numericas (${numerics.length}): ${numerics.slice(0, 5).join(", ")}${numerics.length > 5 ? "..." : ""}.`);
  }
  if (categoricals.length) {
    lines.push(`Variaveis categoricas (${categoricals.length}): ${categoricals.slice(0, 5).join(", ")}${categoricals.length > 5 ? "..." : ""}.`);
  }
  if (missingCols.length) {
    lines.push(`Atencao: ${missingCols.length} coluna(s) com >10% de valores ausentes: ${missingCols.join(", ")}.`);
  }

  for (const col of numerics.slice(0, 3)) {
    const s = stats[col];
    if (s?.mean !== undefined) {
      lines.push(`${col}: media=${s.mean}, mediana=${s.median}, DP=${s.stdDev}, min=${s.min}, max=${s.max}.`);
    }
  }

  return lines;
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function analyzeFile(file: File): Promise<DataAnalysisResult> {
  const { headers, rows } = await parseFile(file);

  const summary: Record<string, ColumnStats> = {};
  for (const h of headers) {
    summary[h] = computeColumnStats(rows.map((r) => r[h] ?? null));
  }

  const charts = suggestCharts(headers, summary);

  const categoricals = headers.filter((h) => summary[h]?.type === "categorical");
  const crossTabs: CrossTabResult[] = [];
  if (categoricals.length >= 2) {
    crossTabs.push(buildCrossTab(rows, categoricals[0], categoricals[1]));
  }

  const numerics = headers.filter((h) => summary[h]?.type === "numeric");
  const dates = headers.filter((h) => summary[h]?.type === "date");
  const trends: TrendResult[] = [];
  if (dates.length > 0 && numerics.length > 0) {
    trends.push(detectTrend(rows, numerics[0], dates[0]));
  }

  return {
    fileName: file.name,
    rows: rows.length,
    columns: headers,
    summary,
    charts,
    crossTabs,
    trends,
    interpretation: interpretStats(file.name, headers, summary, rows)
  };
}

