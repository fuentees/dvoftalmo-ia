import { listarMunicipiosSp } from "@/lib/municipios-sp";

export type TracomaFilter = { municipio?: string; gve?: string; yearStart?: number; yearEnd?: number };
export type TracomaRow = Record<string, unknown>;

export function normalizeTracomaText(value: unknown) {
  return String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

const municipalities = listarMunicipiosSp();
const byCode = new Map(municipalities.map((row) => [row.codigo, row]));
const byName = new Map(municipalities.map((row) => [normalizeTracomaText(row.nome), row]));

export function tracomaRawValue(row: TracomaRow, candidates: readonly string[]) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw as TracomaRow : row;
  for (const candidate of candidates) {
    const key = Object.keys(raw).find((key) => key.toUpperCase() === candidate.toUpperCase());
    if (key && raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
  }
  return null;
}

export function tracomaMunicipality(row: TracomaRow) {
  const candidates = [row.ibge, row.municipio, tracomaRawValue(row, ["CO_MUNICIP", "ID_MUNICIP", "IBGE"]), tracomaRawValue(row, ["NM_MUNICIP", "MUNICIPIO", "MUNICIPIO_NOTIFICACAO", "MUN_NOT"])];
  for (const value of candidates) {
    const text = String(value ?? "").trim();
    const code = /^\d{6,7}$/.test(text) ? text.slice(0, 6) : "";
    const found = byCode.get(code) ?? byName.get(normalizeTracomaText(text));
    if (found) return { codigo: found.codigo, nome: found.nome, gve: found.gve };
  }
  return { codigo: "", nome: String(row.municipio ?? "Não informado").trim() || "Não informado", gve: String(row.gve ?? "Não informado").trim() || "Não informado" };
}

export function matchesTracomaGeography(row: TracomaRow, filter?: TracomaFilter) {
  const municipality = tracomaMunicipality(row);
  if (filter?.municipio) {
    const wanted = tracomaMunicipality({ municipio: filter.municipio });
    if (wanted.codigo ? municipality.codigo !== wanted.codigo : normalizeTracomaText(municipality.nome) !== normalizeTracomaText(wanted.nome)) return false;
  }
  return !filter?.gve || normalizeTracomaText(municipality.gve) === normalizeTracomaText(filter.gve);
}

// Counts must be finite, non-negative integers; blanks are unknown, never zero.
export function tracomaCount(value: unknown): number | null {
  if (value == null || typeof value === "boolean" || String(value).trim() === "") return null;
  let text = String(value).trim();
  if (/^\d{1,3}(\.\d{3})+(,0+)?$/.test(text)) text = text.replace(/\./g, "");
  text = text.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export const TRACOMA_POSITIVE_FIELDS = ["NU_CASOPOS", "NU_CAS_POS", "NU_POSITIV", "NU_POSITIVOS", "NU_POS", "CASOPOS", "CAS_POS", "CASOS_POS", "POSITIVOS", "N_POSITIVO", "QT_POS", "QTD_POS", "TOTAL_POS", "TOT_POS"] as const;
export const TRACOMA_EXAMINED_FIELDS = ["NU_CASOEXA", "CASOEXA", "CASOS_EXAMINADOS", "NU_EXAMINA", "NU_EXAMIN", "EXAMINADOS", "TOTAL_EXAMINADOS"] as const;

export function tracomaYear(value: unknown, currentYear = new Date().getFullYear()) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1975 && year <= currentYear ? year : null;
}

export function validateTracomaFilters(filter: { yearStart?: unknown; yearEnd?: unknown; municipio?: string; gve?: string }): TracomaFilter {
  const parseYear = (value: unknown) => {
    if (value == null || value === "") return undefined;
    const year = tracomaYear(value);
    if (year == null) throw new Error(`Informe um ano inteiro entre 1975 e ${new Date().getFullYear()}.`);
    return year;
  };
  const yearStart = parseYear(filter.yearStart);
  const yearEnd = parseYear(filter.yearEnd);
  if (yearStart != null && yearEnd != null && yearStart > yearEnd) throw new Error("O ano inicial deve ser menor ou igual ao ano final.");
  if ((filter.municipio?.length ?? 0) > 120 || (filter.gve?.length ?? 0) > 120) throw new Error("Filtro geográfico inválido.");
  return { yearStart, yearEnd, municipio: filter.municipio?.trim() || undefined, gve: filter.gve?.trim() || undefined };
}

export function tracomaPositivity(positivos: number | null, examinados: number | null) {
  return positivos != null && examinados != null && examinados > 0 && positivos <= examinados ? (positivos / examinados) * 100 : null;
}
