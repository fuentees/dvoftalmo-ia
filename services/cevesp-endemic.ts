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
  /** Limite inferior = exp(médiaLog − 2×desvioLog) − 1 (nunca abaixo de 0). */
  q1: number;
  /** Média geométrica histórica (não mais mediana, apesar do nome do campo). */
  median: number;
  /** Limite superior = exp(médiaLog + 2×desvioLog) − 1. */
  q3: number;
  max: number;
  currentYear: number | null;
  band: number;
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

export type EndemicChannelGrain = "week" | "month";

function bucketCountFor(grain: EndemicChannelGrain) {
  return grain === "month" ? 12 : 53;
}

function buildChannel(
  hist: Array<Record<string, unknown>>,
  curr: Array<Record<string, unknown>>,
  grain: EndemicChannelGrain
) {
  const maxBucket = bucketCountFor(grain);

  // seMap: bucket (SE ou mês) → [cases per year]. Soma de TotalCaso por (ano, balde)
  // pode vir negativa no cache (registros de correção/estorno) — travada em 0 aqui,
  // pois um valor negativo quebraria log(cases+1) mais abaixo (log de zero/negativo
  // = -Infinity/NaN).
  const seMap = new Map<number, number[]>();
  for (const row of hist) {
    const se = Number(row.se ?? 0);
    const cases = Math.max(Number(row.cases ?? 0), 0);
    if (se >= 1 && se <= maxBucket && Number.isFinite(cases)) {
      const existing = seMap.get(se) ?? [];
      existing.push(cases);
      seMap.set(se, existing);
    }
  }

  const currMap = new Map<number, number>();
  for (const row of curr) {
    const se = Number(row.se ?? 0);
    const cases = Math.max(Number(row.cases ?? 0), 0);
    if (se >= 1 && se <= maxBucket && Number.isFinite(cases)) currMap.set(se, cases);
  }

  const allSe = Array.from(new Set([...seMap.keys(), ...currMap.keys()])).sort((a, b) => a - b);
  const maxSe = allSe.length > 0 ? Math.min(Math.max(...allSe), maxBucket) : maxBucket;

  const result: EndemicChannelPoint[] = [];
  for (let se = 1; se <= maxSe; se++) {
    const values = (seMap.get(se) ?? []).sort((a, b) => a - b);

    // Estatísticas em escala log(casos+1): séries epidemiológicas semanais são
    // tipicamente assimétricas (1-2 anos de surto na janela histórica inflam o
    // desvio-padrão bem acima da média), o que faz o limite inferior em escala
    // linear colapsar em 0 quase sempre. Calculando em log e revertendo com
    // exp, o limite inferior só fica perto de 0 quando o histórico realmente
    // é baixo e estável — não sempre que há um ano de surto na amostra.
    const logValues = values.map((v) => Math.log(v + 1));
    const logMedia  = mean(logValues);
    const logDesvio = stddev(logValues, logMedia);

    const media           = Math.expm1(logMedia);
    const limiteSuperior  = Math.expm1(logMedia + 2 * logDesvio);
    const limiteInferior  = Math.max(Math.expm1(logMedia - 2 * logDesvio), 0);

    result.push({
      se,
      min: values.length > 0 ? values[0] : 0,
      q1: Number(limiteInferior.toFixed(1)),
      median: Number(media.toFixed(1)),
      q3: Number(limiteSuperior.toFixed(1)),
      max: values.length > 0 ? values[values.length - 1] : 0,
      currentYear: currMap.has(se) ? currMap.get(se)! : null,
      band: Number(Math.max(0, limiteSuperior - limiteInferior).toFixed(1)),
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
  const maxBucket = bucketCountFor(grain);
  const currentYear = options.year ?? new Date().getFullYear();
  const startYear = currentYear - 10;

  const histMap = new Map<string, number>();
  const currMap = new Map<number, number>();

  // Fast path: cevesp_agrupado retorna ~300 linhas (6 anos × 53 SE, ou 6 anos × 12 meses)
  // vs ~100k linhas brutas
  try {
    const { data, error } = await supabase.rpc("cevesp_agrupado", {
      p_grain: grain, p_metric: "total_casos", p_dim: null,
      p_ano_start: startYear, p_ano_end: currentYear,
      p_gve: options.gve ?? null, p_municipio: options.municipality ?? null,
      p_se_start: null, p_se_end: null
    }).limit(10000);
    if (!error && data && Array.isArray(data) && data.length > 0) {
      for (const r of data as Array<{ ano: number; se: number | null; mes: number | null; total: number }>) {
        const year = r.ano;
        const bucket = grain === "month" ? (r.mes ?? 0) : (r.se ?? 0);
        const cases = Number(r.total);
        if (!Number.isFinite(year) || bucket < 1 || bucket > maxBucket) continue;
        if (year >= startYear && year <= currentYear - 1) {
          const key = `${year}-${bucket}`;
          histMap.set(key, (histMap.get(key) ?? 0) + cases);
        } else if (year === currentYear) {
          currMap.set(bucket, (currMap.get(bucket) ?? 0) + cases);
        }
      }
      const hist = Array.from(histMap.entries()).map(([key, cases]) => {
        const [, se] = key.split("-").map(Number);
        return { se, cases };
      });
      const curr = Array.from(currMap.entries()).map(([se, cases]) => ({ se, cases }));
      return buildChannel(hist, curr, grain);
    }
  } catch { /* fallback */ }

  // Fallback lento: paginação de ~100k linhas. Para o grain de mês, a coluna "Mes"
  // pode vir nula com frequência não desprezível (já documentado em outras partes
  // do app) — por isso também buscamos DtNotificacao e calculamos o mês a partir
  // dela quando "Mes" estiver vazio, igual já é feito pra SemEpidemio/semana.
  const bucketColumn = grain === "month" ? "Mes" : "SemEpidemio";
  const selectCols = grain === "month"
    ? `"ANO","${bucketColumn}","DtNotificacao","TotalCaso","GVE_NOME","MunicipioNotificacao"`
    : `"ANO","${bucketColumn}","TotalCaso","GVE_NOME","MunicipioNotificacao"`;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("cevesp_notificacoes")
      .select(selectCols)
      .gte("ANO", startYear)
      .lte("ANO", currentYear)
      .range(from, from + pageSize - 1);

    if (options.gve) query = query.ilike("GVE_NOME", `%${options.gve}%`);
    if (options.municipality) query = query.ilike("MunicipioNotificacao", `%${options.municipality}%`);

    const { data, error } = await query;
    if (error) throw new Error(`Erro ao consultar cache CEVESP: ${error.message}`);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const year = Number(row.ANO ?? 0);
      let bucket = Number(row[bucketColumn] ?? 0);
      if (grain === "month" && !(bucket >= 1 && bucket <= 12) && row.DtNotificacao) {
        // Extrai o mês por parsing de string ("YYYY-MM-DD"), não via Date/getMonth():
        // esse último le em horario local do processo, e um DATE sem timezone (ex:
        // "2024-03-01") pode virar fevereiro se o processo rodar em UTC negativo.
        bucket = Number(String(row.DtNotificacao).slice(5, 7));
      }
      const cases = Number(row.TotalCaso ?? 0);
      if (!Number.isFinite(year) || !Number.isFinite(bucket) || bucket < 1 || bucket > maxBucket) continue;
      if (year >= startYear && year <= currentYear - 1) {
        const key = `${year}-${bucket}`;
        histMap.set(key, (histMap.get(key) ?? 0) + cases);
      } else if (year === currentYear) {
        currMap.set(bucket, (currMap.get(bucket) ?? 0) + cases);
      }
    }

    if (!data || data.length < pageSize) break;
  }

  const hist = Array.from(histMap.entries()).map(([key, cases]) => {
    const [, se] = key.split("-").map(Number);
    return { se, cases };
  });
  const curr = Array.from(currMap.entries()).map(([se, cases]) => ({ se, cases }));

  return buildChannel(hist, curr, grain);
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
      filterParts.push("GVE_NOME like ?");
      params.push(`%${options.gve}%`);
    }
    if (options.municipality) {
      filterParts.push("MunicipioNotificacao like ?");
      params.push(`%${options.municipality}%`);
    }

    const extraWhere = filterParts.length ? `and ${filterParts.join(" and ")}` : "";
    const bucketExpr = grain === "month"
      ? "coalesce(Mes, month(DtNotificacao))"
      : "coalesce(SemEpidemio, week(DtNotificacao, 3))";

    const refYear = options.year ?? new Date().getFullYear();
    const [histRows] = await connection.query(
      `select
        ${bucketExpr} as se,
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
        ${bucketExpr} as se,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where DtNotificacao is not null
        and year(DtNotificacao) = ?
        ${extraWhere}
      group by se
      order by se`,
      [refYear, ...params]
    );

    return buildChannel(histRows as Array<Record<string, unknown>>, currRows as Array<Record<string, unknown>>, grain);
  } catch (error) {
    if (isNotificationConnectionError(error)) {
      return runEndemicChannelFromCache(options);
    }
    throw error;
  } finally {
    await connection.end();
  }
}
