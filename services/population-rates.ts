import { cevespTerritoryCodes } from "@/lib/cevesp-population";
import { createAdminClient } from "@/lib/supabase/admin";
import { incidencePer100k, examCoveragePercent } from "@/services/epidemiological-rates";
import { listarMunicipiosSp } from "@/lib/municipios-sp";
import { matchesTracomaGeography, tracomaMunicipality, tracomaRawValue, tracomaCount, tracomaYear, tracomaPositivity, validateTracomaFilters, TRACOMA_EXAMINED_FIELDS, TRACOMA_POSITIVE_FIELDS, type TracomaFilter } from "@/lib/tracoma-data";

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

async function fetchAll(table: string, select: string, build?: (query: SupabasePagedQuery) => SupabasePagedQuery) {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select).order("id").range(from, from + pageSize - 1) as unknown as SupabasePagedQuery;
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
  anoFim?: number;
  gve?: string;
  municipio?: string;
  seInicio?: number;
  seFim?: number;
};

export async function buildCevespRates(filterOrAno?: CevespRatesFilter | number, legacyGve?: string) {
  const filter = typeof filterOrAno === "object"
    ? filterOrAno
    : { ano: filterOrAno, gve: legacyGve };
  const { ano, anoFim, gve, municipio, seInicio, seFim } = filter;
  const population = await loadPopulation();
  if (population.missing) {
    return { missingPopulation: true, message: "Tabela ibge_municipio_populacao ainda nao aplicada no Supabase." };
  }

  const rows = await fetchAll(
    "cevesp_notificacoes",
    '"ANO","SemEpidemio","TotalCaso","MunicipioNotificacao","IbgeNotificacao","GVE_NOME","Excluido"',
    (q) => {
      let next = q;
      if (ano != null && anoFim != null && anoFim > ano) next = next.gte('"ANO"', ano).lte('"ANO"', anoFim);
      else if (ano) next = next.eq('"ANO"', ano);
      else if (anoFim) next = next.lte('"ANO"', anoFim);
      if (gve) next = next.eq('"GVE_NOME"', gve);
      if (municipio) next = next.ilike('"MunicipioNotificacao"', municipio);
      if (seInicio != null) next = next.gte('"SemEpidemio"', seInicio);
      if (seFim != null) next = next.lte('"SemEpidemio"', seFim);
      return next;
    }
  );
  return aggregateCevespRates(rows, population, filter);
}

/** Pure aggregation for independently testing scope, missing counts and denominators. */
export function aggregateCevespRates(rows: Array<Record<string, unknown>>, population: PopulationIndex, filter: CevespRatesFilter = {}) {
  const { ano, anoFim, municipio } = filter;
  const allYears = Array.from(
    new Set(rows.filter((row) => Number(row.Excluido ?? 0) === 0).map((row) => Number(row.ANO)).filter((year) => Number.isInteger(year) && year > 1900))
  ).sort((a, b) => a - b);

  const startYear = ano ?? allYears[0] ?? anoFim ?? 0;
  const endYear = anoFim ?? ano ?? allYears.at(-1) ?? 0;
  const periodYears = startYear && endYear ? Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index) : [];
  const missingYears = periodYears.filter((year) => !allYears.includes(year));
  const isPeriod = periodYears.length > 1;
  const analysisYear = endYear;
  const nYears = periodYears.length || 1;

  const currentRows = isPeriod
    ? rows.filter((row) => Number(row.Excluido ?? 0) === 0)
    : rows.filter((row) => Number(row.ANO) === analysisYear && Number(row.Excluido ?? 0) === 0);

  // Average population across period years for a given municipality
  function avgPopForPeriod(codigoIbge: string | null, municipioName: string) {
    const pops = periodYears.map((yr) =>
      getPopulationForYear(population, { codigoIbge, municipio: municipioName, year: yr })
    );
    const valid = pops.filter((p) => p.value > 0);
    const sourceYears = [...new Set(valid.map((p) => p.sourceYear).filter((year): year is number => year != null))].sort((a, b) => a - b);
    if (!valid.length || valid.length !== periodYears.length) return { value: 0, fallback: true, sourceYears };
    const avg = Math.round(valid.reduce((s, p) => s + p.value, 0) / valid.length);
    return { value: avg, fallback: valid.some((p) => !p.exact), sourceYears };
  }

  const byMunicipality = new Map<string, { municipio: string; codigoIbge: string | null; gve: string; casos: number; invalidCaseRecords: number; years: Set<number> }>();
  for (const row of currentRows) {
    const code = String(row.IbgeNotificacao ?? "").replace(/\D/g, "").slice(0, 6) || null;
    const municipio = String(row.MunicipioNotificacao ?? "Nao informado").trim() || "Nao informado";
    const key = code ?? normalizeText(municipio);
    const current = byMunicipality.get(key) ?? {
      municipio,
      codigoIbge: code,
      gve: String(row.GVE_NOME ?? "Nao informado"),
      casos: 0, invalidCaseRecords: 0, years: new Set<number>()
    };
    const cases = row.TotalCaso == null || String(row.TotalCaso).trim() === "" ? null : Number(row.TotalCaso);
    if (cases != null && Number.isInteger(cases) && cases >= 0) current.casos += cases;
    else current.invalidCaseRecords += 1;
    current.years.add(Number(row.ANO));
    byMunicipality.set(key, current);
  }

  const municipalityRows = Array.from(byMunicipality.values()).map((row) => {
    let populacao: number;
    let populationFallback: boolean;
    let populationSourceYears: number[];
    if (isPeriod) {
      const avg = avgPopForPeriod(row.codigoIbge, row.municipio);
      populacao = avg.value;
      populationFallback = avg.fallback;
      populationSourceYears = avg.sourceYears;
    } else {
      const pop = getPopulationForYear(population, { codigoIbge: row.codigoIbge, municipio: row.municipio, year: analysisYear });
      populacao = pop.value;
      populationFallback = !pop.exact;
      populationSourceYears = pop.sourceYear == null ? [] : [pop.sourceYear];
    }
    // For period: use average annual cases as numerator (cases / nYears)
    const casosAnuais = isPeriod ? row.casos / nYears : row.casos;
    const municipalityMissingYears = periodYears.filter((year) => !row.years.has(year));
    const incidencia100k = row.invalidCaseRecords > 0 || municipalityMissingYears.length > 0 ? null : incidencePer100k(casosAnuais, populacao);
    return {
      municipio: row.municipio,
      codigoIbge: row.codigoIbge,
      gve: row.gve,
      ano: analysisYear,
      casos: row.invalidCaseRecords > 0 ? null : row.casos,
      invalidCaseRecords: row.invalidCaseRecords,
      observedCases: row.casos,
      missingYears: municipalityMissingYears,
      populacao,
      populationFallback,
      populationSourceYears,
      incidencia100k,
      riskColor: riskColor(incidencia100k, [10, 50, 100])
    };
  }).sort((a, b) => Number(b.incidencia100k ?? -1) - Number(a.incidencia100k ?? -1));

  const gveMap = new Map<string, { gve: string; casos: number; populacao: number; invalidCaseRecords: number }>();
  for (const row of municipalityRows) {
    const gve = row.gve || "Nao informado";
    const current = gveMap.get(gve) ?? { gve, casos: 0, populacao: 0, invalidCaseRecords: 0 };
    current.casos += row.observedCases;
    current.invalidCaseRecords += row.invalidCaseRecords;

    gveMap.set(gve, current);
  }

  const gveRows = Array.from(gveMap.values()).map((row) => {
    const codes = cevespTerritoryCodes(row.gve === "Nao informado" ? undefined : row.gve, municipio);
    const years = isPeriod ? periodYears : [analysisYear];
    const populationSourceYears = new Set<number>();
    let populationFallback = false;
    const totals = years.map((year) => {
      const values = [...codes].map((codigoIbge) => getPopulationForYear(population, { codigoIbge, year }));
      for (const value of values) {
        if (value.sourceYear != null) populationSourceYears.add(value.sourceYear);
        if (!value.exact) populationFallback = true;
      }
      return values.length > 0 && values.every((item) => item.value > 0)
        ? values.reduce((sum, item) => sum + item.value, 0) : null;
    });
    const populacao = row.gve !== "Nao informado" && totals.every((value) => value != null)
      ? Math.round(totals.reduce<number>((sum, value) => sum + (value ?? 0), 0) / totals.length) : 0;
    const casosAnuais = isPeriod ? row.casos / nYears : row.casos;
    const incidencia100k = row.invalidCaseRecords > 0 || missingYears.length > 0 ? null : incidencePer100k(casosAnuais, populacao);
    return { ...row, casos: row.invalidCaseRecords > 0 ? null : row.casos, missingYears, populacao, populationFallback,
      populationSourceYears: [...populationSourceYears].sort((a, b) => a - b),
      ano: analysisYear, incidencia100k, riskColor: riskColor(incidencia100k, [10, 50, 100]) };
  }).sort((a, b) => Number(b.incidencia100k ?? -1) - Number(a.incidencia100k ?? -1));

  const populationYears = [...new Set([...municipalityRows, ...gveRows].flatMap((row) => row.populationSourceYears))].sort((a, b) => a - b);
  return {
    missingPopulation: false,
    analysisYear,
    isPeriod,
    periodStart: isPeriod ? startYear : null,
    periodEnd: isPeriod ? endYear : null,
    nYears,
    missingYears,
    warnings: [
      ...(missingYears.length ? [`Anos sem notificação no recorte: ${missingYears.join(", ")}. Ausência não foi interpretada como zero; taxas do período permanecem indisponíveis.`] : []),
      ...(municipalityRows.some((row) => row.invalidCaseRecords > 0) ? ["Há TotalCaso ausente, negativo ou inválido. Contagens e taxas dos territórios afetados permanecem indisponíveis."] : []),
      ...(municipalityRows.some((row) => row.missingYears.length > 0) ? ["Municípios sem observação em todos os anos do período não recebem taxa média anual."] : []),
      ...([...municipalityRows, ...gveRows].some((row) => row.populationFallback) && populationYears.length ? [`População substituta usada por indisponibilidade do ano solicitado. Anos de origem: ${populationYears.join(", ")}; confira a coluna de população de cada território.`] : [])
    ],
    populationYear: populationYears.length === 1 ? populationYears[0] : null,
    populationYears,
    metric: isPeriod
      ? `Incidencia media anual de conjuntivite por 100 mil habitantes (${startYear}–${endYear})`
      : "Incidencia de conjuntivite por 100 mil habitantes",
    methodology: isPeriod
      ? `casos anuais medios CEVESP / populacao media municipal IBGE (${startYear}–${endYear}) x 100.000`
      : "casos CEVESP (TotalCaso) / populacao IBGE do território completo x 100.000; ausência de notificação não confirma zero caso",
    byMunicipality: municipalityRows,
    byGve: gveRows,
    mapRows: municipalityRows
  };
}

export function aggregateSinanTracomaRates(rows: Array<Record<string, unknown>>, populationRows: PopulationRow[], options?: TracomaFilter) {
  validateTracomaFilters(options ?? {});
  const geographicRows = rows.filter((row) => matchesTracomaGeography(row, options));
  const currentRows = geographicRows.filter((row) => {
    const year = tracomaYear(row.ano);
    return year != null && (!options?.yearStart || year >= options.yearStart) && (!options?.yearEnd || year <= options.yearEnd);
  });
  const observedYears = [...new Set(currentRows.map((row) => Number(row.ano)))].sort((a, b) => a - b);
  const start = options?.yearStart ?? observedYears[0] ?? options?.yearEnd ?? 0;
  const end = options?.yearEnd ?? observedYears.at(-1) ?? options?.yearStart ?? 0;
  const periodYears = start && end ? Array.from({ length: end - start + 1 }, (_, index) => start + index) : [];
  const nYears = periodYears.length || 1;
  const isPeriod = periodYears.length > 1;
  const warnings: string[] = [];
  const invalidYears = geographicRows.filter((row) => tracomaYear(row.ano) == null).length;
  if (invalidYears) warnings.push(`${invalidYears} linha(s) com ano ausente, inválido ou futuro foram excluídas.`);
  const populationByCode = new Map<string, PopulationRow[]>();
  for (const row of populationRows) {
    const code = String(row.codigo_ibge).replace(/\D/g, "").slice(0, 6);
    if (!code.startsWith("35") || Number(row.populacao) <= 0 || !Number.isFinite(Number(row.populacao))) continue;
    const list = populationByCode.get(code) ?? [];
    list.push(row);
    populationByCode.set(code, list);
  }
  const populationFor = (code: string, year: number) => {
    const list = [...(populationByCode.get(code) ?? [])].sort((a, b) => Number(a.ano) - Number(b.ano));
    return closestPopulation(list, year);
  };
  const usedYears = new Set<number>();
  function periodPopulation(codes: string[]) {
    let sum = 0;
    let complete = true;
    let fallback = false;
    const sourceYears = new Set<number>();
    for (const code of codes) for (const year of periodYears) {
      const pop = populationFor(code, year);
      if (!pop) { complete = false; continue; }
      sum += Number(pop.populacao);
      sourceYears.add(Number(pop.ano));
      usedYears.add(Number(pop.ano));
      fallback ||= Number(pop.ano) !== year;
    }
    return { value: complete && periodYears.length ? sum / nYears : 0, complete, fallback, sourceYears: [...sourceYears].sort((a, b) => a - b) };
  }
  type Aggregate = { codigoIbge: string; municipio: string; gve: string; anos: Set<number>; examinados: number; positivos: number; missingExaminados: number; missingPositivos: number; invalidPairs: number };
  const municipalities = new Map<string, Aggregate>();
  let unmappedMunicipalities = 0;
  for (const row of currentRows) {
    const municipality = tracomaMunicipality(row);
    if (!municipality.codigo) { unmappedMunicipalities += 1; continue; }
    const current = municipalities.get(municipality.codigo) ?? { codigoIbge: municipality.codigo, municipio: municipality.nome, gve: municipality.gve, anos: new Set<number>(), examinados: 0, positivos: 0, missingExaminados: 0, missingPositivos: 0, invalidPairs: 0 };
    const exam = tracomaCount(tracomaRawValue(row, TRACOMA_EXAMINED_FIELDS));
    const pos = tracomaCount(tracomaRawValue(row, TRACOMA_POSITIVE_FIELDS));
    current.anos.add(Number(row.ano));
    if (exam == null) current.missingExaminados += 1; else current.examinados += exam;
    if (pos == null) current.missingPositivos += 1; else current.positivos += pos;
    if (exam != null && pos != null && pos > exam) current.invalidPairs += 1;
    municipalities.set(municipality.codigo, current);
  }
  const municipalityRows = [...municipalities.values()].map((row) => {
    const population = periodPopulation([row.codigoIbge]);
    const examinados = row.missingExaminados ? null : row.examinados;
    const positivos = row.missingPositivos ? null : row.positivos;
    const missingYears = periodYears.filter((year) => !row.anos.has(year));
    const rateAvailable = population.value > 0 && !missingYears.length && !row.invalidPairs;
    const prevalencia = row.invalidPairs ? null : tracomaPositivity(positivos, examinados);
    return {
      codigoIbge: row.codigoIbge, municipio: row.municipio, gve: row.gve,
      ano: end, anos: [...row.anos].sort((a, b) => a - b), missingYears,
      examinados, positivos, populacao: population.value || null,
      populationFallback: population.fallback, populationSourceYears: population.sourceYears,
      missingExaminados: row.missingExaminados, missingPositivos: row.missingPositivos, invalidPairs: row.invalidPairs,
      prevalencia,
      taxaDeteccao100k: rateAvailable && positivos != null ? incidencePer100k(positivos / nYears, population.value) : null,
      coberturaExame: rateAvailable && examinados != null ? examCoveragePercent(examinados / nYears, population.value) : null,
      riskColor: riskColor(prevalencia, [1, 5, 10])
    };
  }).sort((a, b) => (b.prevalencia ?? -1) - (a.prevalencia ?? -1));
  const gveNames = [...new Set(municipalityRows.map((row) => row.gve))];
  const territory = listarMunicipiosSp().filter((row) => matchesTracomaGeography({ municipio: row.codigo }, options));
  const gveRows = gveNames.map((gve) => {
    const reported = municipalityRows.filter((row) => row.gve === gve);
    const codes = territory.filter((row) => row.gve === gve).map((row) => row.codigo);
    const population = periodPopulation(codes);
    const sum = (key: "positivos" | "examinados") => reported.some((row) => row[key] == null) ? null : reported.reduce((total, row) => total + (row[key] ?? 0), 0);
    const positivos = sum("positivos");
    const examinados = sum("examinados");
    const invalidPairs = reported.reduce((sum, row) => sum + row.invalidPairs, 0);
    const reportingYears = new Set(reported.flatMap((row) => row.anos));
    const missingYears = periodYears.filter((year) => !reportingYears.has(year));
    const rateAvailable = population.value > 0 && !missingYears.length && !invalidPairs;
    const prevalencia = invalidPairs ? null : tracomaPositivity(positivos, examinados);
    return {
      gve, ano: end, positivos, examinados, populacao: population.value || null,
      populationFallback: population.fallback, populationSourceYears: population.sourceYears,
      reportedMunicipalities: reported.length, territoryMunicipalities: codes.length, missingYears, invalidPairs,
      prevalencia,
      taxaDeteccao100k: rateAvailable && positivos != null ? incidencePer100k(positivos / nYears, population.value) : null,
      coberturaExame: rateAvailable && examinados != null ? examCoveragePercent(examinados / nYears, population.value) : null,
      riskColor: riskColor(prevalencia, [1, 5, 10])
    };
  }).sort((a, b) => (b.prevalencia ?? -1) - (a.prevalencia ?? -1));
  const invalidCounts = municipalityRows.reduce((sum, row) => sum + row.missingExaminados + row.missingPositivos, 0);
  const invalidPairs = municipalityRows.reduce((sum, row) => sum + row.invalidPairs, 0);
  if (invalidCounts) warnings.push(`${invalidCounts} campo(s) de positivos/examinados ausentes ou inválidos. Os totais e indicadores correspondentes ficam indisponíveis.`);
  if (invalidPairs) warnings.push(`${invalidPairs} linha(s) com positivos superiores aos examinados. A positividade e as taxas correspondentes foram bloqueadas.`);
  if (unmappedMunicipalities) warnings.push(`${unmappedMunicipalities} linha(s) sem município SP reconhecido foram excluídas; revise o código IBGE na fonte.`);
  if (municipalityRows.some((row) => row.missingYears.length)) warnings.push("Municípios sem registro em algum ano do período têm taxas anuais indisponíveis. Ausência de registro não é interpretada como zero.");
  if (municipalityRows.some((row) => row.populationFallback) || gveRows.some((row) => row.populationFallback)) warnings.push("Há denominadores populacionais de anos diferentes dos registros. Os anos efetivamente usados constam nos dados exportados.");
  if (!populationByCode.size) warnings.push("População IBGE indisponível: a positividade entre examinados continua disponível; taxas populacionais ficam indisponíveis.");
  warnings.push("Positividade = positivos / examinados nos registros disponíveis; não estima prevalência populacional nem valida eliminação pela OMS. Exames podem incluir a mesma pessoa mais de uma vez.");
  warnings.push("As taxas por GVE usam a população de todo o território selecionado, inclusive municípios sem registros. A ausência de registros limita a interpretação da detecção e da atividade de exames.");
  return {
    missingPopulation: !populationByCode.size,
    message: !populationByCode.size ? "População IBGE ausente; indicadores populacionais indisponíveis." : undefined,
    analysisYear: end || null, isPeriod, periodStart: start || null, periodEnd: end || null, nYears,
    populationYear: usedYears.size === 1 ? [...usedYears][0] : null, populationYears: [...usedYears].sort((a, b) => a - b),
    metric: "Positividade entre examinados e indicadores de registros por população",
    methodology: `positividade = positivos / examinados x 100; detecção registrada = positivos / ${nYears} ano(s) / população média do território x 100.000; atividade de exames = examinados / ${nYears} ano(s) / população média x 100`,
    warnings, byMunicipality: municipalityRows, byGve: gveRows, mapRows: municipalityRows
  };
}

export async function buildSinanTracomaRates(options?: TracomaFilter) {
  validateTracomaFilters(options ?? {});
  const population = await loadPopulation();
  const supabase = createAdminClient();
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from("sinan_tracoma_rows").select("source_bank, ano, municipio, ibge, gve, raw").eq("source_bank", "nottraconet").order("id").range(from, from + pageSize - 1);
    if (options?.yearStart) query = query.gte("ano", options.yearStart);
    if (options?.yearEnd) query = query.lte("ano", options.yearEnd);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    if (!data || data.length < pageSize) break;
  }
  return aggregateSinanTracomaRates(rows, population.rows, options);
}
