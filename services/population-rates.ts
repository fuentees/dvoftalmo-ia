import { createAdminClient } from "@/lib/supabase/admin";
import { incidencePer100k, prevalencePercent, examCoveragePercent } from "@/services/epidemiological-rates";
import { nomeMunicipio, gvePorCodigo } from "@/lib/municipios-sp";

type PopulationRow = {
  codigo_ibge: string;
  municipio: string;
  uf: string;
  ano: number;
  populacao: number;
};

type SupabasePagedQuery = PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
}> & {
  eq(column: string, value: unknown): SupabasePagedQuery;
  gte(column: string, value: unknown): SupabasePagedQuery;
  ilike(column: string, pattern: string): SupabasePagedQuery;
  lte(column: string, value: unknown): SupabasePagedQuery;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toNumber(value: unknown) {
  if (value == null || value === "") return 0;
  const parsed = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawObject(row: Record<string, unknown>) {
  const raw = row.raw;
  return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
}

function rawValue(row: Record<string, unknown>, candidates: string[]) {
  const raw = rawObject(row);
  const keys = Object.keys(raw);
  for (const candidate of candidates) {
    const key = keys.find((item) => item.toLowerCase() === candidate.toLowerCase());
    if (key && raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
  }
  return null;
}

async function fetchAll(table: string, select: string, build?: (query: SupabasePagedQuery) => SupabasePagedQuery) {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1) as unknown as SupabasePagedQuery;
    if (build) query = build(query);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function loadPopulation() {
  try {
    const rows = await fetchAll("ibge_municipio_populacao", "codigo_ibge, municipio, uf, ano, populacao");
    const typed = rows as unknown as PopulationRow[];
    const latestYear = Math.max(...typed.map((row) => Number(row.ano)).filter(Number.isFinite), 0);
    const years = Array.from(new Set(typed.map((row) => Number(row.ano)).filter(Number.isFinite))).sort((a, b) => a - b);
    const byCodeYear = new Map<string, PopulationRow>();
    const byNameYear = new Map<string, PopulationRow>();
    const byCode = new Map<string, PopulationRow[]>();
    const byName = new Map<string, PopulationRow[]>();

    for (const row of typed) {
      const year = Number(row.ano);
      const code = String(row.codigo_ibge).replace(/\D/g, "").slice(0, 6);
      const name = normalizeText(row.municipio);
      byCodeYear.set(`${code}:${year}`, row);
      byNameYear.set(`${name}:${year}`, row);
      byCode.set(code, [...(byCode.get(code) ?? []), row]);
      byName.set(name, [...(byName.get(name) ?? []), row]);
    }

    for (const list of [...byCode.values(), ...byName.values()]) {
      list.sort((a, b) => Number(a.ano) - Number(b.ano));
    }

    return { latestYear, years, rows: typed, byCode, byName, byCodeYear, byNameYear };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ibge_municipio_populacao") || msg.includes("schema cache") || msg.includes("PGRST")) {
      return {
        latestYear: null,
        years: [],
        rows: [],
        byCode: new Map<string, PopulationRow[]>(),
        byName: new Map<string, PopulationRow[]>(),
        byCodeYear: new Map<string, PopulationRow>(),
        byNameYear: new Map<string, PopulationRow>(),
        missing: true
      };
    }
    throw error;
  }
}

type PopulationIndex = Awaited<ReturnType<typeof loadPopulation>>;

function closestPopulation(rows: PopulationRow[] | undefined, year: number) {
  if (!rows?.length) return null;
  const exact = rows.find((row) => Number(row.ano) === year);
  if (exact) return exact;
  const previous = [...rows].reverse().find((row) => Number(row.ano) <= year);
  if (previous) return previous;
  return rows[0] ?? null;
}

function getPopulationForYear(
  population: PopulationIndex,
  params: { codigoIbge?: string | null; municipio?: string | null; year: number }
) {
  const code = String(params.codigoIbge ?? "").replace(/\D/g, "").slice(0, 6);
  const name = normalizeText(params.municipio);
  const exact = code
    ? population.byCodeYear.get(`${code}:${params.year}`)
    : population.byNameYear.get(`${name}:${params.year}`);
  const fallback = code
    ? closestPopulation(population.byCode.get(code), params.year)
    : closestPopulation(population.byName.get(name), params.year);
  const row = exact ?? fallback ?? null;
  return {
    row,
    value: Number(row?.populacao ?? 0),
    sourceYear: row ? Number(row.ano) : null,
    exact: Boolean(exact)
  };
}

function riskColor(value: number | null, thresholds: [number, number, number]) {
  if (value == null) return "#94a3b8";
  if (value >= thresholds[2]) return "#dc2626";
  if (value >= thresholds[1]) return "#f59e0b";
  if (value >= thresholds[0]) return "#84cc16";
  return "#14b8a6";
}

export type CevespRatesFilter = {
  ano?: number;
  gve?: string;
  municipio?: string;
  seInicio?: number;
  seFim?: number;
};

export async function buildCevespRates(filterOrAno?: CevespRatesFilter | number, legacyGve?: string) {
  const filter = typeof filterOrAno === "object"
    ? filterOrAno
    : { ano: filterOrAno, gve: legacyGve };
  const { ano, gve, municipio, seInicio, seFim } = filter;
  const population = await loadPopulation();
  if (population.missing) {
    return { missingPopulation: true, message: "Tabela ibge_municipio_populacao ainda nao aplicada no Supabase." };
  }

  const rows = await fetchAll(
    "cevesp_notificacoes",
    '"ANO","SemEpidemio","TotalCaso","MunicipioNotificacao","IbgeNotificacao","GVE_NOME","Excluido"',
    (q) => {
      let next = q;
      if (ano) next = next.eq('"ANO"', ano);
      if (gve) next = next.eq('"GVE_NOME"', gve);
      if (municipio) next = next.ilike('"MunicipioNotificacao"', `%${municipio}%`);
      if (seInicio != null) next = next.gte('"SemEpidemio"', seInicio);
      if (seFim != null) next = next.lte('"SemEpidemio"', seFim);
      return next;
    }
  );
  const allYears = Array.from(
    new Set(rows.map((row) => Number(row.ANO)).filter((year) => Number.isInteger(year) && year > 1900))
  ).sort((a, b) => a - b);

  // Period mode: no year filter selected and data spans multiple years
  const isPeriod = !ano && allYears.length > 1;
  const analysisYear = ano ?? (allYears.length ? allYears[allYears.length - 1] : 0);
  const nYears = isPeriod ? allYears.length : 1;

  const currentRows = isPeriod
    ? rows.filter((row) => Number(row.Excluido ?? 0) === 0)
    : rows.filter((row) => Number(row.ANO) === analysisYear && Number(row.Excluido ?? 0) === 0);

  // Average population across period years for a given municipality
  function avgPopForPeriod(codigoIbge: string | null, municipioName: string) {
    const pops = allYears.map((yr) =>
      getPopulationForYear(population, { codigoIbge, municipio: municipioName, year: yr })
    );
    const valid = pops.filter((p) => p.value > 0);
    if (!valid.length) return { value: 0, fallback: false };
    const avg = Math.round(valid.reduce((s, p) => s + p.value, 0) / valid.length);
    return { value: avg, fallback: valid.some((p) => !p.exact) };
  }

  const byMunicipality = new Map<string, { municipio: string; codigoIbge: string | null; gve: string; casos: number }>();
  for (const row of currentRows) {
    const code = String(row.IbgeNotificacao ?? "").replace(/\D/g, "").slice(0, 6) || null;
    const municipio = String(row.MunicipioNotificacao ?? "Nao informado").trim() || "Nao informado";
    const key = code ?? normalizeText(municipio);
    const current = byMunicipality.get(key) ?? {
      municipio,
      codigoIbge: code,
      gve: String(row.GVE_NOME ?? "Nao informado"),
      casos: 0
    };
    current.casos += toNumber(row.TotalCaso);
    byMunicipality.set(key, current);
  }

  const municipalityRows = Array.from(byMunicipality.values()).map((row) => {
    let populacao: number;
    let populationFallback: boolean;
    if (isPeriod) {
      const avg = avgPopForPeriod(row.codigoIbge, row.municipio);
      populacao = avg.value;
      populationFallback = avg.fallback;
    } else {
      const pop = getPopulationForYear(population, { codigoIbge: row.codigoIbge, municipio: row.municipio, year: analysisYear });
      populacao = pop.value;
      populationFallback = !pop.exact;
    }
    // For period: use average annual cases as numerator (cases / nYears)
    const casosAnuais = isPeriod ? row.casos / nYears : row.casos;
    const incidencia100k = incidencePer100k(casosAnuais, populacao);
    return {
      municipio: row.municipio,
      codigoIbge: row.codigoIbge,
      gve: row.gve,
      ano: analysisYear,
      casos: row.casos,
      populacao,
      populationFallback,
      incidencia100k,
      riskColor: riskColor(incidencia100k, [10, 50, 100])
    };
  }).sort((a, b) => Number(b.incidencia100k ?? -1) - Number(a.incidencia100k ?? -1));

  const gveMap = new Map<string, { gve: string; casos: number; populacao: number }>();
  for (const row of municipalityRows) {
    const gve = row.gve || "Nao informado";
    const current = gveMap.get(gve) ?? { gve, casos: 0, populacao: 0 };
    current.casos += row.casos;
    current.populacao += row.populacao;
    gveMap.set(gve, current);
  }

  const gveRows = Array.from(gveMap.values()).map((row) => {
    const casosAnuais = isPeriod ? row.casos / nYears : row.casos;
    return {
      ...row,
      ano: analysisYear,
      incidencia100k: incidencePer100k(casosAnuais, row.populacao),
      riskColor: riskColor(incidencePer100k(casosAnuais, row.populacao), [10, 50, 100])
    };
  }).sort((a, b) => Number(b.incidencia100k ?? -1) - Number(a.incidencia100k ?? -1));

  return {
    missingPopulation: false,
    analysisYear,
    isPeriod,
    periodStart: isPeriod ? allYears[0] : null,
    periodEnd: isPeriod ? allYears[allYears.length - 1] : null,
    nYears,
    populationYear: isPeriod ? null : population.latestYear,
    populationYears: population.years,
    metric: isPeriod
      ? `Incidencia media anual de conjuntivite por 100 mil habitantes (${allYears[0]}–${allYears[allYears.length - 1]})`
      : "Incidencia de conjuntivite por 100 mil habitantes",
    methodology: isPeriod
      ? `casos anuais medios CEVESP / populacao media municipal IBGE (${allYears[0]}–${allYears[allYears.length - 1]}) x 100.000`
      : "casos CEVESP (TotalCaso) / populacao municipal IBGE x 100.000",
    byMunicipality: municipalityRows,
    byGve: gveRows,
    mapRows: municipalityRows
  };
}

export async function buildSinanTracomaRates(options?: {
  municipio?: string;
  gve?: string;
  yearStart?: number;
  yearEnd?: number;
}) {
  const population = await loadPopulation();
  if (population.missing) {
    return { missingPopulation: true, message: "Tabela ibge_municipio_populacao ainda nao aplicada no Supabase." };
  }

  const rows = await fetchAll(
    "sinan_tracoma_rows",
    "source_bank, ano, municipio, raw",
    (query) => {
      let next = query.eq("source_bank", "nottraconet");
      if (options?.municipio) next = next.ilike("municipio", `%${options.municipio}%`);
      if (options?.yearStart) next = next.gte("ano", options.yearStart);
      if (options?.yearEnd) next = next.lte("ano", options.yearEnd);
      return next;
    }
  );
  const years = rows.map((row) => Number(row.ano)).filter((year) => Number.isInteger(year) && year > 1900);
  const minYear = years.length ? Math.min(...years) : 0;
  const maxYear = years.length ? Math.max(...years) : 0;
  const analysisYear = maxYear;
  const selectedGve = String(options?.gve ?? "").trim();
  const currentRows = rows.filter((row) => {
    if (!selectedGve) return true;
    const code = String(row.municipio ?? rawValue(row, ["ID_MUNICIP", "CO_MUNICIP"]) ?? "").replace(/\D/g, "").slice(0, 6);
    return (gvePorCodigo(code) ?? "Nao informado") === selectedGve;
  });

  const byMunicipalityYear = new Map<string, { codigoIbge: string; municipio: string; gve: string; ano: number; examinados: number; positivos: number }>();
  for (const row of currentRows) {
    const code = String(row.municipio ?? rawValue(row, ["ID_MUNICIP", "CO_MUNICIP"]) ?? "").replace(/\D/g, "").slice(0, 6);
    if (!code) continue;
    const ano = Number(row.ano);
    if (!Number.isInteger(ano) || ano <= 1900) continue;
    const key = `${code}:${ano}`;
    const current = byMunicipalityYear.get(key) ?? {
      codigoIbge: code,
      municipio: nomeMunicipio(code),
      gve: gvePorCodigo(code) ?? "Nao informado",
      ano,
      examinados: 0,
      positivos: 0
    };
    current.examinados += toNumber(rawValue(row, ["NU_CASOEXA", "NU_EXAMINA", "EXAMINADOS"]));
    current.positivos += toNumber(rawValue(row, ["NU_CASOPOS", "NU_CAS_POS", "POSITIVOS"]));
    byMunicipalityYear.set(key, current);
  }

  const isPeriod = minYear !== maxYear && minYear > 0;
  const nYearsTracoma = isPeriod ? (maxYear - minYear + 1) : 1;

  const byMunicipality = new Map<string, {
    codigoIbge: string;
    municipio: string;
    gve: string;
    anos: number[];
    examinados: number;
    positivos: number;
    populacaoSum: number;
    populacaoCount: number;
    populationFallback: boolean;
  }>();

  for (const row of byMunicipalityYear.values()) {
    const pop = getPopulationForYear(population, { codigoIbge: row.codigoIbge, year: row.ano });
    const current = byMunicipality.get(row.codigoIbge) ?? {
      codigoIbge: row.codigoIbge,
      municipio: row.municipio,
      gve: row.gve,
      anos: [],
      examinados: 0,
      positivos: 0,
      populacaoSum: 0,
      populacaoCount: 0,
      populationFallback: false
    };
    current.anos.push(row.ano);
    current.examinados += row.examinados;
    current.positivos += row.positivos;
    if (pop.value > 0) { current.populacaoSum += pop.value; current.populacaoCount += 1; }
    current.populationFallback = current.populationFallback || !pop.exact;
    byMunicipality.set(row.codigoIbge, current);
  }

  const municipalityRows = Array.from(byMunicipality.values()).map((row) => {
    const uniqueAnosMuni = new Set(row.anos).size;
    const nAnosMuni = Math.max(uniqueAnosMuni, 1);
    // Average annual population
    const populacao = row.populacaoCount > 0 ? Math.round(row.populacaoSum / row.populacaoCount) : 0;
    // Average annual positivos/examinados as numerators for rates
    const positivosAnuais = row.positivos / nAnosMuni;
    const examinadosAnuais = row.examinados / nAnosMuni;
    const prevalencia = prevalencePercent(row.positivos, row.examinados);
    const taxaDeteccao100k = incidencePer100k(positivosAnuais, populacao);
    const coberturaExame = examCoveragePercent(examinadosAnuais, populacao);
    return {
      codigoIbge: row.codigoIbge,
      municipio: row.municipio,
      gve: row.gve,
      ano: analysisYear,
      anos: Array.from(new Set(row.anos)).sort((a, b) => a - b),
      examinados: row.examinados,
      positivos: row.positivos,
      populacao,
      populationFallback: row.populationFallback,
      prevalencia,
      taxaDeteccao100k,
      coberturaExame,
      riskColor: riskColor(prevalencia, [1, 5, 10])
    };
  }).sort((a, b) => Number(b.prevalencia ?? -1) - Number(a.prevalencia ?? -1));

  // GVE aggregation: average annual numerators over average population
  const gveMap = new Map<string, { gve: string; examinados: number; positivos: number; populacao: number; count: number }>();
  for (const row of municipalityRows) {
    const current = gveMap.get(row.gve) ?? { gve: row.gve, examinados: 0, positivos: 0, populacao: 0, count: 0 };
    current.examinados += row.examinados;
    current.positivos += row.positivos;
    current.populacao += row.populacao;
    current.count += 1;
    gveMap.set(row.gve, current);
  }

  const gveRows = Array.from(gveMap.values()).map((row) => {
    const posAnuaisGve = isPeriod ? row.positivos / nYearsTracoma : row.positivos;
    const examAnuaisGve = isPeriod ? row.examinados / nYearsTracoma : row.examinados;
    return {
      gve: row.gve,
      examinados: row.examinados,
      positivos: row.positivos,
      populacao: row.populacao,
      ano: analysisYear,
      prevalencia: prevalencePercent(row.positivos, row.examinados),
      taxaDeteccao100k: incidencePer100k(posAnuaisGve, row.populacao),
      coberturaExame: examCoveragePercent(examAnuaisGve, row.populacao),
      riskColor: riskColor(prevalencePercent(row.positivos, row.examinados), [1, 5, 10])
    };
  }).sort((a, b) => Number(b.prevalencia ?? -1) - Number(a.prevalencia ?? -1));

  return {
    missingPopulation: false,
    analysisYear: maxYear,
    isPeriod,
    periodStart: minYear || null,
    periodEnd: maxYear || null,
    nYears: nYearsTracoma,
    populationYear: isPeriod ? null : population.latestYear,
    populationYears: population.years,
    metric: isPeriod
      ? `Prevalencia, taxa de deteccao media anual e cobertura (${minYear}–${maxYear})`
      : "Prevalencia entre examinados, taxa de deteccao e cobertura de exame",
    methodology: isPeriod
      ? `prevalencia = positivos / examinados x 100; taxa = positivos anuais medios / pop. media IBGE x 100.000; cobertura = examinados anuais medios / pop. media IBGE x 100`
      : "prevalencia = positivos / examinados x 100; taxa de deteccao = positivos / populacao x 100.000; cobertura = examinados / populacao x 100",
    byMunicipality: municipalityRows,
    byGve: gveRows,
    mapRows: municipalityRows
  };
}
