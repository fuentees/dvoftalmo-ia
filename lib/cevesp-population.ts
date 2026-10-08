import { createAdminClient } from "@/lib/supabase/admin";
import { listarMunicipiosSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function cevespTerritoryCodes(gve?: string, municipio?: string) {
  let municipalities = gve ? listarMunicipiosPorGve(gve) : listarMunicipiosSp();
  if (municipio) municipalities = municipalities.filter((item) => normalized(item.nome) === normalized(municipio));
  return new Set(municipalities.map((item) => item.codigo));
}

export type CevespPopulationRow = { codigo_ibge: string; ano: number; populacao: number };
export function indexTerritoryPopulation(rows: CevespPopulationRow[], territory: Set<string>) {
  const byYear = new Map<number, Map<string, number>>();
  for (const row of rows) {
    const code = String(row.codigo_ibge).replace(/\D/g, "").slice(0, 6);
    const year = Number(row.ano), value = Number(row.populacao);
    if (!territory.has(code) || !Number.isInteger(year) || !Number.isFinite(value) || value <= 0) continue;
    if (!byYear.has(year)) byYear.set(year, new Map());
    byYear.get(year)!.set(code, value);
  }
  // Partial territory populations must never serve as the whole denominator.
  const totals = new Map([...byYear].filter(([, values]) => territory.size > 0 && values.size === territory.size)
    .map(([year, values]) => [year, [...values.values()].reduce((sum, value) => sum + value, 0)]));
  const years = [...totals.keys()].sort((a, b) => a - b);
  function forYear(year: number) {
    const sourceYear = totals.has(year) ? year : [...years].reverse().find((item) => item <= year) ?? years[0] ?? null;
    return { value: sourceYear == null ? 0 : totals.get(sourceYear)!, sourceYear, exact: sourceYear === year };
  }
  return { byYear: totals, years, latestYear: years.at(-1) ?? null, forYear };
}

export async function loadCevespTerritoryPopulation(options: { gve?: string; municipality?: string } = {}) {
  const admin = createAdminClient();
  const rows: CevespPopulationRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("ibge_municipio_populacao").select("codigo_ibge,ano,populacao")
      .eq("uf", "SP").order("ano").order("codigo_ibge").range(from, from + 999);
    if (error) throw new Error(`Erro ao consultar população IBGE: ${error.message}`);
    rows.push(...(data ?? []) as CevespPopulationRow[]);
    if (!data || data.length < 1000) break;
  }
  return indexTerritoryPopulation(rows, cevespTerritoryCodes(options.gve, options.municipality));
}
