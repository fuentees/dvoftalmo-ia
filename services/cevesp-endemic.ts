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
    result.push({
      se,
      min: values.length > 0 ? values[0] : 0,
      q1: Number(q1.toFixed(1)),
      median: Number(percentile(values, 50).toFixed(1)),
      q3: Number(q3.toFixed(1)),
      max: values.length > 0 ? values[values.length - 1] : 0,
      currentYear: currMap.has(se) ? currMap.get(se)! : null,
      band: Number(Math.max(0, q3 - q1).toFixed(1))
    });
  }

  return result;
}

async function runEndemicChannelFromCache(options: {
  gve?: string;
  municipality?: string;
} = {}) {
  const supabase = createAdminClient();
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 5;

  let query = supabase
    .from("cevesp_notificacoes")
    .select('"ANO","SemEpidemio","TotalCaso","GVE_NOME","MunicipioNotificacao"')
    .gte("ANO", startYear)
    .lte("ANO", currentYear);

  if (options.gve) query = query.ilike("GVE_NOME", `%${options.gve}%`);
  if (options.municipality) query = query.ilike("MunicipioNotificacao", `%${options.municipality}%`);

  const { data, error } = await query.limit(100000);
  if (error) throw new Error(`Erro ao consultar cache CEVESP: ${error.message}`);

  const histMap = new Map<string, number>();
  const currMap = new Map<number, number>();
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

    const [histRows] = await connection.query(
      `select
        coalesce(SemEpidemio, week(DtNotificacao, 3)) as se,
        year(DtNotificacao) as yr,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where DtNotificacao is not null
        and year(DtNotificacao) between year(date_sub(curdate(), interval 5 year)) and year(date_sub(curdate(), interval 1 year))
        ${extraWhere}
      group by se, yr
      order by yr, se`,
      params
    );

    const [currRows] = await connection.query(
      `select
        coalesce(SemEpidemio, week(DtNotificacao, 3)) as se,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where DtNotificacao is not null
        and year(DtNotificacao) = year(curdate())
        ${extraWhere}
      group by se
      order by se`,
      params
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
