import { createAdminClient } from "@/lib/supabase/admin";
import { createNotificationConnection, getNotificationTableName, isNotificationConnectionError } from "@/lib/external/notification-db";

const identifierPattern = /^[a-zA-Z0-9_]+$/;

function quoteIdentifier(value: string) {
  if (!identifierPattern.test(value)) throw new Error(`Identificador invalido: ${value}`);
  return `\`${value}\``;
}

export interface EndemicChannelPoint {
  se: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  currentYear: number | null;
  band: number;
  /** EARS C2 / simplified-Farrington epidemic threshold (μ + z·√(φ·μ), z≈2.576). */
  farrington: number;
}

/**
 * Simplified EARS C2 / Farrington epidemic threshold.
 * Uses values from a ±windowSe week window across historical years.
 * Returns μ + z·√(φ·μ) where φ = max(1, σ²/μ) (quasi-Poisson overdispersion).
 * z = 2.576 → one-sided 99.5% CI (standard Farrington).
 */
function farringtonThreshold(values: number[], z = 2.576): number {
  if (values.length < 3) return Infinity;
  const n  = values.length;
  const mu = values.reduce((s, v) => s + v, 0) / n;
  if (mu <= 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mu) ** 2, 0) / (n - 1);
  const phi = Math.max(1, variance / mu); // overdispersion factor
  return Number((mu + z * Math.sqrt(phi * mu)).toFixed(1));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function buildChannel(
  hist: Array<Record<string, unknown>>,
  curr: Array<Record<string, unknown>>
) {
  // seMap: se → [cases per year]
  const seMap = new Map<number, number[]>();
  for (const row of hist) {
    const se = Number(row.se ?? 0);
    const cases = Number(row.cases ?? 0);
    if (se >= 1 && se <= 53 && Number.isFinite(cases)) {
      const existing = seMap.get(se) ?? [];
      existing.push(cases);
      seMap.set(se, existing);
    }
  }

  const currMap = new Map<number, number>();
  for (const row of curr) {
    const se = Number(row.se ?? 0);
    const cases = Number(row.cases ?? 0);
    if (se >= 1 && se <= 53) currMap.set(se, cases);
  }

  const allSe = Array.from(new Set([...seMap.keys(), ...currMap.keys()])).sort((a, b) => a - b);
  const maxSe = allSe.length > 0 ? Math.max(...allSe) : 52;

  const result: EndemicChannelPoint[] = [];
  for (let se = 1; se <= maxSe; se++) {
    const values = (seMap.get(se) ?? []).sort((a, b) => a - b);
    const q1 = percentile(values, 25);
    const q3 = percentile(values, 75);

    // Farrington window: ±2 SEs around this SE across all historical years
    const windowValues: number[] = [];
    for (let delta = -2; delta <= 2; delta++) {
      const neighbor = se + delta;
      if (neighbor >= 1 && neighbor <= 53) {
        windowValues.push(...(seMap.get(neighbor) ?? []));
      }
    }
    const fThreshold = farringtonThreshold(windowValues);

    result.push({
      se,
      min: values.length > 0 ? values[0] : 0,
      q1: Number(q1.toFixed(1)),
      median: Number(percentile(values, 50).toFixed(1)),
      q3: Number(q3.toFixed(1)),
      max: values.length > 0 ? values[values.length - 1] : 0,
      currentYear: currMap.has(se) ? currMap.get(se)! : null,
      band: Number(Math.max(0, q3 - q1).toFixed(1)),
      farrington: Number.isFinite(fThreshold) ? fThreshold : q3,
    });
  }

  return result;
}

async function runEndemicChannelFromCache(options: {
  gve?: string;
  municipality?: string;
  year?: number;
} = {}) {
  const supabase = createAdminClient();
  const currentYear = options.year ?? new Date().getFullYear();
  const startYear = currentYear - 10;

  const histMap = new Map<string, number>();
  const currMap = new Map<number, number>();

  // Fast path: cevesp_agrupado retorna ~300 linhas (6 anos × 53 SE) vs ~100k linhas brutas
  try {
    const { data, error } = await supabase.rpc("cevesp_agrupado", {
      p_grain: "week", p_metric: "total_casos", p_dim: null,
      p_ano_start: startYear, p_ano_end: currentYear,
      p_gve: options.gve ?? null, p_municipio: options.municipality ?? null,
      p_se_start: null, p_se_end: null
    }).limit(10000);
    if (!error && data && Array.isArray(data) && data.length > 0) {
      for (const r of data as Array<{ ano: number; se: number | null; total: number }>) {
        const year = r.ano;
        const se = r.se ?? 0;
        const cases = Number(r.total);
        if (!Number.isFinite(year) || se < 1 || se > 53) continue;
        if (year >= startYear && year <= currentYear - 1) {
          const key = `${year}-${se}`;
          histMap.set(key, (histMap.get(key) ?? 0) + cases);
        } else if (year === currentYear) {
          currMap.set(se, (currMap.get(se) ?? 0) + cases);
        }
      }
      const hist = Array.from(histMap.entries()).map(([key, cases]) => {
        const [, se] = key.split("-").map(Number);
        return { se, cases };
      });
      const curr = Array.from(currMap.entries()).map(([se, cases]) => ({ se, cases }));
      return buildChannel(hist, curr);
    }
  } catch { /* fallback */ }

  // Fallback lento: paginação de ~100k linhas
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("cevesp_notificacoes")
      .select('"ANO","SemEpidemio","TotalCaso","GVE_NOME","MunicipioNotificacao"')
      .gte("ANO", startYear)
      .lte("ANO", currentYear)
      .range(from, from + pageSize - 1);

    if (options.gve) query = query.ilike("GVE_NOME", `%${options.gve}%`);
    if (options.municipality) query = query.ilike("MunicipioNotificacao", `%${options.municipality}%`);

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao consultar cache CEVESP: ${error.message}`);

    for (const row of data ?? []) {
      const year = Number(row.ANO ?? 0);
      const se = Number(row.SemEpidemio ?? 0);
      const cases = Number(row.TotalCaso ?? 0);
      if (!Number.isFinite(year) || !Number.isFinite(se) || se < 1 || se > 53) continue;
      if (year >= startYear && year <= currentYear - 1) {
        const key = `${year}-${se}`;
        histMap.set(key, (histMap.get(key) ?? 0) + cases);
      } else if (year === currentYear) {
        currMap.set(se, (currMap.get(se) ?? 0) + cases);
      }
    }

    if (!data || data.length < pageSize) break;
  }

  const hist = Array.from(histMap.entries()).map(([key, cases]) => {
    const [, se] = key.split("-").map(Number);
    return { se, cases };
  });
  const curr = Array.from(currMap.entries()).map(([se, cases]) => ({ se, cases }));

  return buildChannel(hist, curr);
}

export async function runEndemicChannel(options: {
  gve?: string;
  municipality?: string;
  year?: number;
} = {}): Promise<EndemicChannelPoint[]> {
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
      filterParts.push("GVE_NOME like ?");
      params.push(`%${options.gve}%`);
    }
    if (options.municipality) {
      filterParts.push("MunicipioNotificacao like ?");
      params.push(`%${options.municipality}%`);
    }

    const extraWhere = filterParts.length ? `and ${filterParts.join(" and ")}` : "";

    const refYear = options.year ?? new Date().getFullYear();
    const [histRows] = await connection.query(
      `select
        coalesce(SemEpidemio, week(DtNotificacao, 3)) as se,
        year(DtNotificacao) as yr,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where DtNotificacao is not null
        and year(DtNotificacao) between ? and ?
        ${extraWhere}
      group by se, yr
      order by yr, se`,
      [refYear - 10, refYear - 1, ...params]
    );

    const [currRows] = await connection.query(
      `select
        coalesce(SemEpidemio, week(DtNotificacao, 3)) as se,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where DtNotificacao is not null
        and year(DtNotificacao) = ?
        ${extraWhere}
      group by se
      order by se`,
      [refYear, ...params]
    );

    return buildChannel(histRows as Array<Record<string, unknown>>, currRows as Array<Record<string, unknown>>);
  } catch (error) {
    if (isNotificationConnectionError(error)) {
      return runEndemicChannelFromCache(options);
    }
    throw error;
  } finally {
    await connection.end();
  }
}
