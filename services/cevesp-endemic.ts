import { createAdminClient } from "@/lib/supabase/admin";
import { currentCalendarYear } from "@/lib/epi-week";
import { createNotificationConnection, getNotificationTableName, isNotificationConnectionError } from "@/lib/external/notification-db";
import { loadCevespTerritoryPopulation } from "@/lib/cevesp-population";
import { MIN_BASELINE_YEARS } from "@/lib/cevesp-channel";

const identifierPattern = /^[a-zA-Z0-9_]+$/;

function quoteIdentifier(value: string) {
  if (!identifierPattern.test(value)) throw new Error(`Identificador invalido: ${value}`);
  return `\`${value}\``;
}

export interface EndemicChannelPoint {
  se: number;
  baselineCount: number;
  baselineValid: boolean;
  invalidBaselineYears: number;
  invalidCurrentCaseRecords: number;
  min: number;
  /** Limite inferior do coeficiente de incidencia por 100 mil hab. = media − 2×DP. */
  q1: number;
  /** Media historica do coeficiente de incidencia por 100 mil hab. */
  median: number;
  /** Desvio-padrão amostral da incidencia historica por 100 mil hab. */
  stddev: number;
  /** Limite superior do coeficiente de incidencia por 100 mil hab. = media + 2×DP. */
  q3: number;
  max: number;
  currentYear: number | null;
  currentIncidence: number | null;
  population: number | null;
  populationYear: number | null;
  band: number;
  metric: "incidence_per_100k";
  baseline: Array<{
    year: number;
    cases: number;
    population: number;
    populationYear: number | null;
    incidence: number;
  }>;
}

/** Média aritmética. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Desvio-padrão amostral (divisor n-1, igual ao `sd()` do R). */
function stddev(values: number[], avg: number): number {
  const n = values.length;
  if (n < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

function incidencePer100k(cases: number, population: number) {
  if (!population || population <= 0) return null;
  return (cases / population) * 100_000;
}

function roundIncidence(value: number) {
  return Number(value.toFixed(2));
}

export type EndemicChannelGrain = "week" | "month";

function bucketCountFor(grain: EndemicChannelGrain) {
  return grain === "month" ? 12 : 53;
}

type EndemicCaseGroup = { yr: number; se: number; cases: number | null; invalidCaseRecords: number };

function appendEndemicCaseRows(groups: Map<string, EndemicCaseGroup>, rows: Array<Record<string, unknown>>, grain: EndemicChannelGrain) {
  const maximum = bucketCountFor(grain);
  for (const row of rows) {
    if (Number(row.Excluido ?? 0) !== 0) continue;
    const year = Number(row.ANO);
    let bucket = Number(grain === "month" ? row.Mes : row.SemEpidemio);
    if (grain === "month" && !(bucket >= 1 && bucket <= 12)) bucket = Number(String(row.DtNotificacao ?? "").slice(5, 7));
    if (!Number.isInteger(year) || year <= 1900 || !Number.isInteger(bucket) || bucket < 1 || bucket > maximum) continue;
    const key = `${year}-${bucket}`;
    const group = groups.get(key) ?? { yr: year, se: bucket, cases: 0, invalidCaseRecords: 0 };
    const value = row.TotalCaso == null || String(row.TotalCaso).trim() === "" ? null : Number(row.TotalCaso);
    if (value == null || !Number.isInteger(value) || value < 0) {
      group.invalidCaseRecords += 1;
      group.cases = null;
    } else if (group.cases != null) {
      group.cases += value;
    }
    groups.set(key, group);
  }
}

/** Validate each source record before aggregation; an invalid member invalidates its whole year/bucket. */
export function aggregateEndemicCaseRows(rows: Array<Record<string, unknown>>, grain: EndemicChannelGrain): EndemicCaseGroup[] {
  const groups = new Map<string, EndemicCaseGroup>();
  appendEndemicCaseRows(groups, rows, grain);
  return [...groups.values()];
}

function hasValidAggregatedCases(row: Record<string, unknown>) {
  const value = row.cases == null || String(row.cases).trim() === "" ? null : Number(row.cases);
  return value != null && Number.isInteger(value) && value >= 0 && Number(row.invalidCaseRecords ?? row.invalid_case_records ?? 0) === 0;
}

export function buildChannel(
  hist: Array<Record<string, unknown>>,
  curr: Array<Record<string, unknown>>,
  grain: EndemicChannelGrain,
  population: Awaited<ReturnType<typeof loadCevespTerritoryPopulation>>
) {
  const maxBucket = bucketCountFor(grain);

  // Observed zero is valid; a missing bucket is never synthesized as zero.
  const invalidBaselineYears = new Map<number, number>();
  const invalidCurrentRecords = new Map<number, number>();
  const observedBuckets = new Set<number>();
  const seMap = new Map<number, Array<{ year: number; cases: number; population: number; populationYear: number | null; incidence: number }>>();
  for (const row of hist) {
    const se = Number(row.se ?? 0);
    const year = Number(row.yr ?? row.year ?? row.ano ?? 0);
    if (Number.isInteger(se) && se >= 1 && se <= maxBucket) observedBuckets.add(se);
    if (!hasValidAggregatedCases(row)) {
      invalidBaselineYears.set(se, (invalidBaselineYears.get(se) ?? 0) + 1);
      continue;
    }
    const cases = Number(row.cases);
    const pop = population.forYear(year);
    const incidence = incidencePer100k(cases, pop.value);
    if (
      se >= 1 &&
      se <= maxBucket &&
      Number.isFinite(cases) &&
      cases >= 0 &&
      Number.isInteger(year) &&
      incidence != null
    ) {
      const existing = seMap.get(se) ?? [];
      existing.push({
        year,
        cases,
        population: pop.value,
        populationYear: pop.sourceYear,
        incidence,
      });
      seMap.set(se, existing);
    }
  }

  const currMap = new Map<number, number>();
  const currIncidenceMap = new Map<number, number>();
  const currentPopulation = new Map<number, ReturnType<typeof population.forYear>>();
  for (const row of curr) {
    const se = Number(row.se ?? 0);
    const year = Number(row.yr ?? row.year ?? row.ano ?? 0);
    if (Number.isInteger(se) && se >= 1 && se <= maxBucket) observedBuckets.add(se);
    if (!hasValidAggregatedCases(row)) {
      invalidCurrentRecords.set(se, Number(row.invalidCaseRecords ?? row.invalid_case_records ?? 1));
      continue;
    }
    const cases = Number(row.cases);
    const pop = population.forYear(year);
    const incidence = incidencePer100k(cases, pop.value);
    if (se >= 1 && se <= maxBucket && Number.isFinite(cases) && cases >= 0) {
      currMap.set(se, cases);
      currentPopulation.set(se, pop);
      if (incidence != null) currIncidenceMap.set(se, incidence);
    }
  }

  if (!observedBuckets.size) return [];
  const maxSe = maxBucket;

  const result: EndemicChannelPoint[] = [];
  for (let se = 1; se <= maxSe; se++) {
    const baseline = (seMap.get(se) ?? []).sort((a, b) => a.year - b.year);
    const values = baseline.map((item) => item.incidence).sort((a, b) => a - b);

    // Faixa esperada: média ± 2×desvio-padrão do coeficiente de incidência
    // histórico do bucket (SE ou mês), calculado direto sobre os valores brutos.
    const media = mean(values);
    const desvio = stddev(values, media);
    const limiteSuperior = media + 2 * desvio;
    const limiteInferior = Math.max(media - 2 * desvio, 0);

    result.push({
      se,
      baselineCount: baseline.length,
      baselineValid: baseline.length >= MIN_BASELINE_YEARS,
      invalidBaselineYears: invalidBaselineYears.get(se) ?? 0,
      invalidCurrentCaseRecords: invalidCurrentRecords.get(se) ?? 0,
      min: values.length > 0 ? roundIncidence(values[0]) : 0,
      q1: roundIncidence(limiteInferior),
      median: roundIncidence(media),
      stddev: roundIncidence(desvio),
      q3: roundIncidence(limiteSuperior),
      max: values.length > 0 ? roundIncidence(values[values.length - 1]) : 0,
      currentYear: currMap.has(se) ? currMap.get(se)! : null,
      currentIncidence: currIncidenceMap.has(se) ? roundIncidence(currIncidenceMap.get(se)!) : null,
      population: currentPopulation.get(se)?.value || null,
      populationYear: currentPopulation.get(se)?.sourceYear ?? null,
      band: roundIncidence(Math.max(0, limiteSuperior - limiteInferior)),
      metric: "incidence_per_100k",
      baseline: baseline.map((item) => ({
        ...item,
        incidence: roundIncidence(item.incidence),
      })),
    });
  }

  return result;
}

async function runEndemicChannelFromCache(options: {
  gve?: string;
  municipality?: string;
  year?: number;
  grain?: EndemicChannelGrain;
} = {}) {
  const supabase = createAdminClient();
  const grain = options.grain ?? "week";
  const currentYear = options.year ?? currentCalendarYear();
  const startYear = currentYear - 10;
  const population = await loadCevespTerritoryPopulation(options);

  // Legacy RPCs return only sums, which lose null/negative source values.
  // Read source records and validate before summing; no deployed migration is required.
  const groups = new Map<string, EndemicCaseGroup>();
  const bucketColumn = grain === "month" ? "Mes" : "SemEpidemio";
  const selectCols = grain === "month"
    ? `"ANO","${bucketColumn}","DtNotificacao","TotalCaso","Excluido","GVE_NOME","MunicipioNotificacao"`
    : `"ANO","${bucketColumn}","TotalCaso","Excluido","GVE_NOME","MunicipioNotificacao"`;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("cevesp_notificacoes")
      .select(selectCols)
      .or("Excluido.is.null,Excluido.eq.0")
      .order("id")
      .gte("ANO", startYear)
      .lte("ANO", currentYear)
      .range(from, from + pageSize - 1);

    if (options.gve) query = query.eq("GVE_NOME", options.gve);
    if (options.municipality) query = query.ilike("MunicipioNotificacao", options.municipality);

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao consultar cache CEVESP: ${error.message}`);

    appendEndemicCaseRows(groups, (data ?? []) as unknown as Array<Record<string, unknown>>, grain);

    if (!data || data.length < pageSize) break;
  }

  const aggregated = [...groups.values()];
  const hist = aggregated.filter((row) => row.yr < currentYear);
  const curr = aggregated.filter((row) => row.yr === currentYear);

  return buildChannel(hist, curr, grain, population);
}

export async function runEndemicChannel(options: {
  gve?: string;
  municipality?: string;
  year?: number;
  grain?: EndemicChannelGrain;
} = {}): Promise<EndemicChannelPoint[]> {
  const grain = options.grain ?? "week";
  let table: string;
  let connection: Awaited<ReturnType<typeof createNotificationConnection>>;
  try {
    table = quoteIdentifier(getNotificationTableName());
    connection = await createNotificationConnection();
  } catch (error) {
    if (isNotificationConnectionError(error) || !process.env.NOTIFY_DB_HOST) {
      return runEndemicChannelFromCache(options);
    }
    throw error;
  }

  try {
    const filterParts: string[] = [];
    const params: unknown[] = [];

    if (options.gve) {
      filterParts.push("GVE_NOME = ?");
      params.push(options.gve);
    }
    if (options.municipality) {
      filterParts.push("MunicipioNotificacao = ?");
      params.push(options.municipality);
    }

    const extraWhere = filterParts.length ? `and ${filterParts.join(" and ")}` : "";
    const bucketExpr = grain === "month"
      ? "coalesce(Mes, month(DtNotificacao))"
      : "SemEpidemio";

    const refYear = options.year ?? currentCalendarYear();
    const population = await loadCevespTerritoryPopulation(options);
    const [histRows] = await connection.query(
      `select
        ${bucketExpr} as se,
        coalesce(ANO, year(DtNotificacao)) as yr,
        sum(TotalCaso) as cases,
        sum(case when TotalCaso is null or trim(cast(TotalCaso as char)) = '' or TotalCaso < 0 or TotalCaso <> floor(TotalCaso) then 1 else 0 end) as invalid_case_records
      from ${table}
      where coalesce(Excluido, 0) = 0
        and coalesce(ANO, year(DtNotificacao)) between ? and ?
        ${extraWhere}
      group by se, yr
      order by yr, se`,
      [refYear - 10, refYear - 1, ...params]
    );

    const [currRows] = await connection.query(
      `select
        ${bucketExpr} as se,
        coalesce(ANO, year(DtNotificacao)) as yr,
        sum(TotalCaso) as cases,
        sum(case when TotalCaso is null or trim(cast(TotalCaso as char)) = '' or TotalCaso < 0 or TotalCaso <> floor(TotalCaso) then 1 else 0 end) as invalid_case_records
      from ${table}
      where coalesce(Excluido, 0) = 0
        and coalesce(ANO, year(DtNotificacao)) = ?
        ${extraWhere}
      group by se, yr
      order by se`,
      [refYear, ...params]
    );

    return buildChannel(histRows as Array<Record<string, unknown>>, currRows as Array<Record<string, unknown>>, grain, population);
  } catch (error) {
    if (isNotificationConnectionError(error)) {
      return runEndemicChannelFromCache(options);
    }
    throw error;
  } finally {
    await connection.end();
  }
}
