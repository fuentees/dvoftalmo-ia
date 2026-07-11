import { createAdminClient } from "@/lib/supabase/admin";
import { createNotificationConnection, getNotificationTableName, isNotificationConnectionError } from "@/lib/external/notification-db";
import { listarMunicipiosPorGve } from "@/lib/municipios-sp";

const identifierPattern = /^[a-zA-Z0-9_]+$/;

function quoteIdentifier(value: string) {
  if (!identifierPattern.test(value)) throw new Error(`Identificador invalido: ${value}`);
  return `\`${value}\``;
}

export interface EndemicChannelPoint {
  se: number;
  min: number;
  /** Limite inferior do coeficiente de incidencia por 100 mil hab. = media − 2×DP. */
  q1: number;
  /** Media historica do coeficiente de incidencia por 100 mil hab. */
  median: number;
  /** Limite superior do coeficiente de incidencia por 100 mil hab. = media + 2×DP. */
  q3: number;
  max: number;
  currentYear: number | null;
  currentIncidence: number | null;
  population: number | null;
  band: number;
  metric: "incidence_per_100k";
}

type PopulationRow = {
  codigo_ibge?: string | null;
  municipio?: string | null;
  ano?: number | string | null;
  populacao?: number | string | null;
};

const EXCLUDED_BASELINE_YEARS = new Set([2011, 2021, 2022]);

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

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

async function loadScopedPopulation(options: {
  gve?: string;
  municipality?: string;
}) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ibge_municipio_populacao")
    .select("codigo_ibge, municipio, ano, populacao")
    .limit(100000);

  if (error) throw new Error(`Erro ao consultar populacao IBGE: ${error.message}`);

  const selectedMunicipality = normalizeText(options.municipality);
  const gveMunicipalities = options.gve
    ? new Set(listarMunicipiosPorGve(options.gve).map((item) => normalizeText(item.nome)))
    : null;

  const rows = ((data ?? []) as PopulationRow[]).filter((row) => {
    const name = normalizeText(row.municipio);
    if (selectedMunicipality) return name === selectedMunicipality || name.includes(selectedMunicipality);
    if (gveMunicipalities) return gveMunicipalities.has(name);
    return true;
  });

  const byYear = new Map<number, number>();
  for (const row of rows) {
    const year = Number(row.ano);
    const population = Number(row.populacao ?? 0);
    if (Number.isInteger(year) && year > 1900 && Number.isFinite(population) && population > 0) {
      byYear.set(year, (byYear.get(year) ?? 0) + population);
    }
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const latestYear = years.at(-1) ?? null;

  function forYear(year: number) {
    if (byYear.has(year)) return { value: byYear.get(year)!, sourceYear: year, exact: true };
    const previous = [...years].reverse().find((item) => item <= year);
    if (previous != null) return { value: byYear.get(previous)!, sourceYear: previous, exact: false };
    const first = years[0];
    return first != null
      ? { value: byYear.get(first)!, sourceYear: first, exact: false }
      : { value: 0, sourceYear: null, exact: false };
  }

  return { byYear, years, latestYear, forYear };
}

function buildChannel(
  hist: Array<Record<string, unknown>>,
  curr: Array<Record<string, unknown>>,
  grain: EndemicChannelGrain,
  population: Awaited<ReturnType<typeof loadScopedPopulation>>
) {
  const maxBucket = bucketCountFor(grain);

  // seMap: bucket (SE ou mês) → [incidencia por 100 mil hab. por ano].
  // O canal de controle deve ser calculado sobre coeficiente de incidencia, não
  // sobre casos absolutos, para acompanhar a planilha epidemiologica de referencia.
  // O ano de 2011 é excluido da linha de base por ser ano epidemico extremo.
  // Os anos 2021 e 2022 também são excluidos por forte efeito da pandemia na
  // procura/registro de conjuntivites, o que derruba artificialmente a incidencia
  // esperada e distorce os desvios-padrão dos anos posteriores.
  //
  // Apenas 2026 em diante passou a
  // registrar notificações explícitas de 0 caso; nos anos históricos anteriores,
  // zero costuma significar ausência desse tipo de registro, não zero epidemiológico.
  // Por isso zeros históricos não entram na média/desvio. Já o ano de referência
  // preserva zero quando ele existe no banco, para mostrar a curva atual corretamente.
  // Soma de TotalCaso por (ano, balde) também pode vir negativa no cache (registros
  // de correção/estorno) — travada em 0 (e portanto já excluída do histórico) por segurança.
  const seMap = new Map<number, number[]>();
  for (const row of hist) {
    const se = Number(row.se ?? 0);
    const year = Number(row.yr ?? row.year ?? row.ano ?? 0);
    const cases = Math.max(Number(row.cases ?? 0), 0);
    const pop = population.forYear(year);
    const incidence = incidencePer100k(cases, pop.value);
    if (
      se >= 1 &&
      se <= maxBucket &&
      Number.isFinite(cases) &&
      cases > 0 &&
      incidence != null &&
      !EXCLUDED_BASELINE_YEARS.has(year)
    ) {
      const existing = seMap.get(se) ?? [];
      existing.push(incidence);
      seMap.set(se, existing);
    }
  }

  const currMap = new Map<number, number>();
  const currIncidenceMap = new Map<number, number>();
  for (const row of curr) {
    const se = Number(row.se ?? 0);
    const year = Number(row.yr ?? row.year ?? row.ano ?? 0);
    const cases = Math.max(Number(row.cases ?? 0), 0);
    const pop = population.forYear(year);
    const incidence = incidencePer100k(cases, pop.value);
    if (se >= 1 && se <= maxBucket && Number.isFinite(cases)) {
      currMap.set(se, cases);
      if (incidence != null) currIncidenceMap.set(se, incidence);
    }
  }

  const allSe = Array.from(new Set([...seMap.keys(), ...currMap.keys()])).sort((a, b) => a - b);
  const maxSe = allSe.length > 0 ? Math.min(Math.max(...allSe), maxBucket) : maxBucket;

  const result: EndemicChannelPoint[] = [];
  for (let se = 1; se <= maxSe; se++) {
    const values = (seMap.get(se) ?? []).sort((a, b) => a - b);

    // Faixa esperada: média ± 2×desvio-padrão dos casos históricos do bucket
    // (SE ou mês), calculado direto sobre os valores brutos.
    const media = mean(values);
    const desvio = stddev(values, media);
    const limiteSuperior = media + 2 * desvio;
    const limiteInferior = Math.max(media - 2 * desvio, 0);

    result.push({
      se,
      min: values.length > 0 ? roundIncidence(values[0]) : 0,
      q1: roundIncidence(limiteInferior),
      median: roundIncidence(media),
      q3: roundIncidence(limiteSuperior),
      max: values.length > 0 ? roundIncidence(values[values.length - 1]) : 0,
      currentYear: currMap.has(se) ? currMap.get(se)! : null,
      currentIncidence: currIncidenceMap.has(se) ? roundIncidence(currIncidenceMap.get(se)!) : null,
      population: population.latestYear ? population.forYear(population.latestYear).value : null,
      band: roundIncidence(Math.max(0, limiteSuperior - limiteInferior)),
      metric: "incidence_per_100k",
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
  const population = await loadScopedPopulation(options);

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
        const [yr, se] = key.split("-").map(Number);
        return { yr, se, cases };
      });
      const curr = Array.from(currMap.entries()).map(([se, cases]) => ({ yr: currentYear, se, cases }));
      return buildChannel(hist, curr, grain, population);
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

    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
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
    const [yr, se] = key.split("-").map(Number);
    return { yr, se, cases };
  });
  const curr = Array.from(currMap.entries()).map(([se, cases]) => ({ yr: currentYear, se, cases }));

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
    const population = await loadScopedPopulation(options);
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
        year(DtNotificacao) as yr,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where DtNotificacao is not null
        and year(DtNotificacao) = ?
        ${extraWhere}
      group by se
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
