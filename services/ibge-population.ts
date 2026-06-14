import { createAdminClient } from "@/lib/supabase/admin";

type SidraPopulationRow = {
  V: string;
  D1C: string;
  D1N: string;
  D3C: string;
};

export type IbgePopulationRecord = {
  codigo_ibge: string;
  municipio: string;
  uf: string;
  ano: number;
  populacao: number;
  fonte: string;
  fonte_url: string;
};

const SIDRA_TABLE = "6579";
const SIDRA_VARIABLE = "9324";

export function ibgePopulationSidraUrl(ufCode = "35", year = new Date().getFullYear() - 1) {
  return `https://apisidra.ibge.gov.br/values/t/${SIDRA_TABLE}/n6/in%20n3%20${ufCode}/v/${SIDRA_VARIABLE}/p/${year}?formato=json`;
}

function parseMunicipalityName(value: string) {
  const match = value.match(/^(.*)\s-\s([A-Z]{2})$/);
  return {
    municipio: (match?.[1] ?? value).trim(),
    uf: (match?.[2] ?? "").trim()
  };
}

export async function fetchIbgePopulationFromSidra(ufCode = "35", year = new Date().getFullYear() - 1) {
  const fonteUrl = ibgePopulationSidraUrl(ufCode, year);
  const response = await fetch(fonteUrl);
  if (!response.ok) {
    throw new Error(`IBGE SIDRA ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as SidraPopulationRow[];
  return data.slice(1).map((row) => {
    const parsed = parseMunicipalityName(row.D1N);
    return {
      codigo_ibge: row.D1C,
      municipio: parsed.municipio,
      uf: parsed.uf || "SP",
      ano: Number(row.D3C),
      populacao: Number(row.V),
      fonte: `IBGE/SIDRA tabela ${SIDRA_TABLE}, variavel ${SIDRA_VARIABLE} - Populacao residente estimada`,
      fonte_url: fonteUrl
    } satisfies IbgePopulationRecord;
  }).filter((row) => row.codigo_ibge && Number.isFinite(row.ano) && Number.isFinite(row.populacao));
}

export async function upsertIbgePopulation(records: IbgePopulationRecord[]) {
  if (!records.length) return { upserted: 0 };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("ibge_municipio_populacao")
    .upsert(records, { onConflict: "codigo_ibge,ano" });

  if (error) throw new Error(`Erro ao gravar populacao IBGE: ${error.message}`);
  return { upserted: records.length };
}

export async function syncIbgePopulation(ufCode = "35", year = new Date().getFullYear() - 1) {
  const records = await fetchIbgePopulationFromSidra(ufCode, year);
  const result = await upsertIbgePopulation(records);
  return {
    ...result,
    year,
    ufCode,
    sourceUrl: ibgePopulationSidraUrl(ufCode, year)
  };
}
