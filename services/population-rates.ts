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

async function fetchAll(table: string, select: string, build?: (query: any) => any) {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
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

export async function buildCevespRates(ano?: number, gve?: string) {
  const population = await loadPopulation();
  if (population.missing) {
    return { missingPopulation: true, message: "Tabela ibge_municipio_populacao ainda nao aplicada no Supabase." };
  }

  const rows = await fetchAll(
    "cevesp_notificacoes",
    '"ANO","TotalCaso","MunicipioNotificacao","IbgeNotificacao","GVE_NOME","Excluido"',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => {
      let next = q;
      if (ano) next = next.eq('"ANO"', ano);
      if (gve) next = next.eq('"GVE_NOME"', gve);
      return next;
    }
  );
  const years = rows.map((row) => Number(row.ANO)).filter((year) => Number.isInteger(year) && year > 1900);
  const analysisYear = ano ?? (years.length ? Math.max(...years) : 0);
  const currentRows = rows.filter((row) => Number(row.ANO) === analysisYear && Number(row.Excluido ?? 0) === 0);

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
    const pop = getPopulationForYear(population, {
      codigoIbge: row.codigoIbge,
      municipio: row.municipio,
      year: analysisYear
    });
    const populacao = pop.value;
    const incidencia100k = incidencePer100k(row.casos, populacao);
    return {
      municipio: row.municipio,
      codigoIbge: row.codigoIbge,
      gve: row.gve,
      ano: analysisYear,
      casos: row.casos,
      populacao,
      populationYear: pop.sourceYear,
      populationFallback: !pop.exact,
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

  const gveRows = Array.from(gveMap.values()).map((row) => ({
    ...row,
    ano: analysisYear,
    incidencia100k: incidencePer100k(row.casos, row.populacao),
    riskColor: riskColor(incidencePer100k(row.casos, row.populacao), [10, 50, 100])
  })).sort((a, b) => Number(b.incidencia100k ?? -1) - Number(a.incidencia100k ?? -1));

  return {
    missingPopulation: false,
    analysisYear,
    populationYear: population.latestYear,
    populationYears: population.years,
    metric: "Incidencia de conjuntivite por 100 mil habitantes",
    methodology: "casos CEVESP (TotalCaso) / populacao municipal IBGE x 100.000",
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

  const byMunicipality = new Map<string, {
    codigoIbge: string;
    municipio: string;
    gve: string;
    anos: number[];
    examinados: number;
    positivos: number;
    populacao: number;
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
      populacao: 0,
      populationFallback: false
    };
    current.anos.push(row.ano);
    current.examinados += row.examinados;
    current.positivos += row.positivos;
    current.populacao += pop.value;
    current.populationFallback = current.populationFallback || !pop.exact;
    byMunicipality.set(row.codigoIbge, current);
  }

  const municipalityRows = Array.from(byMunicipality.values()).map((row) => {
    const prevalencia = prevalencePercent(row.positivos, row.examinados);
    const taxaDeteccao100k = incidencePer100k(row.positivos, row.populacao);
    const coberturaExame = examCoveragePercent(row.examinados, row.populacao);
    return {
      codigoIbge: row.codigoIbge,
      municipio: row.municipio,
      gve: row.gve,
      ano: analysisYear,
      anos: Array.from(new Set(row.anos)).sort((a, b) => a - b),
      examinados: row.examinados,
      positivos: row.positivos,
      populacao: row.populacao,
      populationFallback: row.populationFallback,
      prevalencia,
      taxaDeteccao100k,
      coberturaExame,
      riskColor: riskColor(prevalencia, [1, 5, 10])
    };
  }).sort((a, b) => Number(b.prevalencia ?? -1) - Number(a.prevalencia ?? -1));

  const gveMap = new Map<string, { gve: string; examinados: number; positivos: number; populacao: number }>();
  for (const row of municipalityRows) {
    const current = gveMap.get(row.gve) ?? { gve: row.gve, examinados: 0, positivos: 0, populacao: 0 };
    current.examinados += row.examinados;
    current.positivos += row.positivos;
    current.populacao += row.populacao;
    gveMap.set(row.gve, current);
  }

  const gveRows = Array.from(gveMap.values()).map((row) => ({
    ...row,
    ano: analysisYear,
    prevalencia: prevalencePercent(row.positivos, row.examinados),
    taxaDeteccao100k: incidencePer100k(row.positivos, row.populacao),
    coberturaExame: examCoveragePercent(row.examinados, row.populacao),
    riskColor: riskColor(prevalencePercent(row.positivos, row.examinados), [1, 5, 10])
  })).sort((a, b) => Number(b.prevalencia ?? -1) - Number(a.prevalencia ?? -1));

  return {
    missingPopulation: false,
    analysisYear: maxYear,
    periodStart: minYear || null,
    periodEnd: maxYear || null,
    populationYear: population.latestYear,
    populationYears: population.years,
    metric: "Prevalencia entre examinados, taxa de deteccao e cobertura de exame",
    methodology: "prevalencia = positivos / examinados x 100; taxa de deteccao = positivos / populacao x 100.000; cobertura = examinados / populacao x 100",
    byMunicipality: municipalityRows,
    byGve: gveRows,
    mapRows: municipalityRows
  };
}
