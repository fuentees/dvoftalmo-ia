/** SELECT-only reconciliation. Output never contains record keys, names or territories. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

export type ReconciliationRow = Record<string, unknown>;
const NUMERIC_FIELDS = ["ANO", "Mes", "SemEpidemio", "TotalCaso", "SexMasc", "SexFem", "FxMenorUmAno", "FxUmQuatro", "FxCincoNove", "FxDezQuatorze", "FxQuizeOuMais", "NuSurto", "NuColetaMaterialBio", "NuAcaoEducativa", "NuTreinamento", "NuEncamimento"] as const;
const TEXT_FIELDS = ["DtNotificacao", "dt_notificacao_raw", "created_at_origem", "MunicipioNotificacao", "IbgeNotificacao", "GVE_NOME", "Unid_notificacao", "nCNES", "Surto"] as const;
const FIELDS = [...NUMERIC_FIELDS, ...TEXT_FIELDS, "Excluido"] as const;
const CACHE_COLUMNS = ["id", "row_key", "ID", "synced_at", ...FIELDS].join(",");

function finiteNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function invalidValue(value: unknown) {
  return { type: typeof value, value: typeof value === "number" && !Number.isFinite(value) ? String(value) : value };
}

function fieldValue(field: string, row: ReconciliationRow): unknown {
  if (field === "Excluido") {
    if (row[field] == null) return 0;
    const flag = String(row[field]).trim().toUpperCase();
    if (["", "0", "N", "FALSE"].includes(flag)) return 0;
    if (["1", "S", "TRUE"].includes(flag)) return 1;
    return { invalidExcludedFlag: invalidValue(row[field]) };
  }
  if ((NUMERIC_FIELDS as readonly string[]).includes(field)) {
    const number = finiteNumber(row[field]);
    return number ?? (row[field] == null || (typeof row[field] === "string" && String(row[field]).trim() === "") ? null : { invalidNumeric: invalidValue(row[field]) });
  }
  if (row[field] == null || String(row[field]).trim() === "") return null;
  const text = String(row[field]).trim();
  if (field === "DtNotificacao" || field === "created_at_origem") {
    const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/);
    const date = match ? new Date(`${match[1]}T00:00:00Z`) : null;
    const valid = Boolean(match && date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] &&
      (match[2] == null || (Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 && Number(match[5] ?? 0) < 24 && Number(match[6] ?? 0) < 60)));
    if (!valid) return { invalidDate: text };
    return field === "DtNotificacao" ? match![1] : text.replace("T", " ");
  }
  return text;
}

function identity(row: ReconciliationRow): string | null {
  if (row.ID != null && String(row.ID).trim()) return `id:${String(row.ID).trim()}`;
  return row.row_key != null && String(row.row_key).trim() ? String(row.row_key).trim() : null;
}

export type Aggregate = {
  records: number;
  activeRecords: number;
  excludedRecords: number;
  unknownExclusionRecords: number;
  activeKnownCases: number;
  activeInvalidCaseRecords: number;
};
const emptyAggregate = (): Aggregate => ({ records: 0, activeRecords: 0, excludedRecords: 0, unknownExclusionRecords: 0, activeKnownCases: 0, activeInvalidCaseRecords: 0 });
export type DatasetIndex = {
  total: Aggregate;
  byYear: Record<string, Aggregate>;
  missingIdentity: number;
  duplicateIdentityRows: number;
  missingMysqlId: number;
  latestSyncedAt: string | null;
  fingerprints: Map<string, string>;
};

export function indexDataset(rows: ReconciliationRow[]): DatasetIndex {
  const result: DatasetIndex = { total: emptyAggregate(), byYear: {}, missingIdentity: 0, duplicateIdentityRows: 0, missingMysqlId: 0, latestSyncedAt: null, fingerprints: new Map() };
  appendDataset(result, rows);
  return result;
}

export function appendDataset(result: DatasetIndex, rows: ReconciliationRow[]) {
  for (const row of rows) {
    const year = finiteNumber(row.ANO);
    const yearLabel = year != null && Number.isInteger(year) && year >= 1990 && year <= 2100 ? String(year) : "sem_ano_valido";
    result.byYear[yearLabel] ??= emptyAggregate();
    const exclusion = fieldValue("Excluido", row);
    const active = exclusion === 0;
    const cases = finiteNumber(row.TotalCaso);
    const validCases = cases != null && Number.isInteger(cases) && cases >= 0;
    for (const aggregate of [result.total, result.byYear[yearLabel]]) {
      aggregate.records++;
      if (active) {
        aggregate.activeRecords++;
        if (validCases) aggregate.activeKnownCases += cases!;
        else aggregate.activeInvalidCaseRecords++;
      } else if (exclusion === 1) aggregate.excludedRecords++;
      else aggregate.unknownExclusionRecords++;
    }
    if (row.ID == null || !String(row.ID).trim()) result.missingMysqlId++;
    const key = identity(row);
    if (key == null) result.missingIdentity++;
    else {
      if (result.fingerprints.has(key)) result.duplicateIdentityRows++;
      const canonical = FIELDS.map((field) => fieldValue(field, row));
      result.fingerprints.set(key, createHash("sha256").update(JSON.stringify(canonical)).digest("hex"));
    }
    const syncedAt = row.synced_at == null ? null : String(row.synced_at);
    if (syncedAt && (!result.latestSyncedAt || syncedAt > result.latestSyncedAt)) result.latestSyncedAt = syncedAt;
  }
}

export function publicSummary(index: DatasetIndex) {
  return {
    total: index.total, byYear: index.byYear,
    uniqueIdentities: index.fingerprints.size, missingIdentity: index.missingIdentity,
    duplicateIdentityRows: index.duplicateIdentityRows, missingMysqlId: index.missingMysqlId,
    latestSyncedAt: index.latestSyncedAt,
  };
}

export function compareDatasets(source: DatasetIndex, cache: DatasetIndex) {
  let matchingRecords = 0, changedRecords = 0, sourceOnlyRecords = 0, cacheOnlyRecords = 0;
  for (const [key, fingerprint] of source.fingerprints) {
    const cached = cache.fingerprints.get(key);
    if (cached == null) sourceOnlyRecords++;
    else if (cached === fingerprint) matchingRecords++;
    else changedRecords++;
  }
  for (const key of cache.fingerprints.keys()) if (!source.fingerprints.has(key)) cacheOnlyRecords++;
  const unambiguousIdentity = source.missingIdentity + cache.missingIdentity + source.duplicateIdentityRows + cache.duplicateIdentityRows === 0;
  return {
    matchingRecords, changedRecords, sourceOnlyRecords, cacheOnlyRecords, unambiguousIdentity,
    sameComparableData: unambiguousIdentity && changedRecords + sourceOnlyRecords + cacheOnlyRecords === 0,
    fieldsCompared: FIELDS,
    note: "Comparação de identidade e campos analíticos; não certifica correção clínica, dados pessoais ou completude da fonte original.",
  };
}

export function readJsonRows(path: string): ReconciliationRow[] {
  return readJsonSnapshot(path).rows;
}

function readJsonSnapshot(path: string): { rows: ReconciliationRow[]; sha256: string } {
  const buffer = readFileSync(path);
  const data: unknown = JSON.parse(buffer.toString("utf8"));
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("invalid_export_structure");
  return { rows: data as ReconciliationRow[], sha256: createHash("sha256").update(buffer).digest("hex") };
}

/** Additional guard: the client may only issue GET/HEAD requests. No RPC/import/sync. */
async function readOnlyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("read_only_method_required");
  return fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
}

export function createReadOnlyCacheClient() {
  if (existsSync(".env.local")) config({ path: ".env.local", quiet: true });
  else config({ quiet: true });
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("cache_credentials_unavailable");
  return createClient(base.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), key, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: readOnlyFetch },
  });
}

async function readCache() {
  const client = createReadOnlyCacheClient();
  const countAt = async () => {
    const { count, error } = await client.from("cevesp_notificacoes").select("id", { count: "exact", head: true });
    if (error || count == null) throw new Error("cache_count_failed");
    return count;
  };
  const beforeCount = await countAt();
  const index = indexDataset([]);
  let pages = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("cevesp_notificacoes").select(CACHE_COLUMNS).order("id").range(from, from + 999);
    if (error) throw new Error("cache_select_failed");
    appendDataset(index, (data ?? []) as unknown as ReconciliationRow[]);
    pages++;
    if (pages % 25 === 0) console.error(`Leitura SELECT: ${index.total.records} registros processados.`);
    if (!data || data.length < 1000) break;
  }
  const afterCount = await countAt();
  return { index, pages, beforeCount, afterCount, consistentCounts: beforeCount === afterCount && afterCount === index.total.records };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => arg.startsWith("--file="))?.slice(7) ?? "analise-cevesp/cevesp-export-completo.json";
  const output = args.find((arg) => arg.startsWith("--out="))?.slice(6);
  const started = performance.now();
  const snapshot = readJsonSnapshot(file);
  const source = indexDataset(snapshot.rows);
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(), mode: args.includes("--cache") ? "read_only_cache_comparison" : "local_only",
    normalizationVersion: "typed-numeric-preserved-invalid-validated-date-timestamp-exclusion-v3",
    source: publicSummary(source), sourceFileSha256: snapshot.sha256,
  };
  if (args.includes("--cache")) {
    try {
      const cache = await readCache();
      report.cache = publicSummary(cache.index);
      report.cacheRead = { pages: cache.pages, beforeCount: cache.beforeCount, afterCount: cache.afterCount, consistentCounts: cache.consistentCounts, note: "SELECTs paginados não são um snapshot transacional; contagens estáveis não excluem mudanças simultâneas de conteúdo." };
      report.comparison = compareDatasets(source, cache.index);
    } catch (error) {
      const safeCodes = new Set(["cache_credentials_unavailable", "cache_count_failed", "cache_select_failed", "read_only_method_required"]);
      const errorCode = error instanceof Error && safeCodes.has(error.message) ? error.message : "cache_read_failed";
      report.cache = { status: "unavailable", errorCode, reason: "Não foi possível concluir a leitura do cache; reconciliação não concluída. Credenciais e mensagens de erro privadas foram omitidas." };
      process.exitCode = 2;
    }
  }
  report.elapsedMs = Math.round(performance.now() - started);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) writeFileSync(output, json, { encoding: "utf8", mode: 0o600 });
  console.log(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => { console.error("Reconciliação não concluída: arquivo ou configuração inválidos. Nenhum registro ou segredo foi exibido."); process.exitCode = 1; });
}
