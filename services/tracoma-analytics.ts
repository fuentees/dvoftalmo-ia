import type { TracomaSurveyResult } from "@/lib/types";
import { redcapExport, isRedCapConfigured, type RedCapRecord } from "@/lib/external/redcap-client";

export const WHO_TF_THRESHOLD = 5.0;
export const WHO_TT_THRESHOLD = 0.2;

export interface TracomaQueryOptions {
  municipality?: string;
  uf?: string;
  yearFrom?: number;
  yearTo?: number;
  form?: string;
}

export interface AzithromycinEstimate {
  population: number;
  coveragePercent: number;
  treatmentTarget: number;
  tablets250mg: number;
  tablets500mg: number;
  totalTablets: number;
  notes: string[];
}

function mapRecord(record: RedCapRecord): TracomaSurveyResult | null {
  const requiredValues = [record.casos_tf ?? record.tf_cases, record.casos_tt ?? record.tt_cases];
  if (requiredValues.some(value => value == null || String(value).trim() === "")) return null;
  const totalExamined = Number(record.total_examinados ?? record.total_examined ?? 0);
  if (!Number.isInteger(totalExamined) || totalExamined <= 0) return null;

  const tfCases = Number(record.casos_tf ?? record.tf_cases ?? NaN);
  const ttCases = Number(record.casos_tt ?? record.tt_cases ?? NaN);
  const examYear = Number(record.ano ?? record.year ?? NaN);
  if (![tfCases, ttCases].every(n => Number.isInteger(n) && n >= 0 && n <= totalExamined)
    || !Number.isInteger(examYear) || examYear < 1900 || examYear > 2100) return null;
  const rawCoverage = record.cobertura ?? record.coverage;
  const coverage = rawCoverage == null || rawCoverage === "" ? NaN : Number(rawCoverage);
  const tfPrev = totalExamined > 0 ? (tfCases / totalExamined) * 100 : 0;
  const ttPrev = totalExamined > 0 ? (ttCases / totalExamined) * 100 : 0;

  return {
    municipality: String(record.municipio ?? record.municipality ?? "Nao informado"),
    uf: String(record.uf ?? "SP"),
    examYear,
    totalExamined,
    tfCases,
    ttCases,
    tfPrevalence: Math.round(tfPrev * 100) / 100,
    ttPrevalence: Math.round(ttPrev * 100) / 100,
    whoTfThreshold: WHO_TF_THRESHOLD,
    whoTtThreshold: WHO_TT_THRESHOLD,
    // Aggregate counts do not establish WHO age-specific elimination criteria.
    tfEliminated: null,
    ttEliminated: null,
    azithromycinDoses: null,
    populationCoverage: Number.isFinite(coverage) && coverage >= 0 && coverage <= 100 ? coverage : null
  };
}

export const REDCAP_CONFIGURED = isRedCapConfigured();

export async function fetchTracomaSurveys(options: TracomaQueryOptions = {}): Promise<{ data: TracomaSurveyResult[]; isMock: boolean }> {
  for (const year of [options.yearFrom, options.yearTo]) {
    if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
      throw new Error("Informe anos inteiros entre 1900 e 2100.");
    }
  }
  if (options.yearFrom !== undefined && options.yearTo !== undefined && options.yearFrom > options.yearTo) {
    throw new Error("O ano inicial deve ser menor ou igual ao ano final.");
  }
  if (!isRedCapConfigured()) {
    throw new Error("Dados de tracoma indisponíveis: configure REDCAP_API_URL e REDCAP_API_TOKEN. Nenhum dado de exemplo foi utilizado.");
  }

  const filterParts: string[] = [];
  // Quoted values must not alter REDCap's filter expression.
  for (const value of [options.municipality, options.uf]) {
    if (value && /["\\\r\n]/.test(value)) throw new Error("Filtro de município ou UF inválido.");
  }
  if (options.municipality) filterParts.push(`[municipio] = "${options.municipality}"`);
  if (options.uf) filterParts.push(`[uf] = "${options.uf}"`);
  if (options.yearFrom) filterParts.push(`[ano] >= "${options.yearFrom}"`);
  if (options.yearTo) filterParts.push(`[ano] <= "${options.yearTo}"`);

  const records = await redcapExport({
    content: "record",
    forms: options.form ? [options.form] : [process.env.REDCAP_TRACOMA_FORM ?? "levantamento_tracoma"],
    filterLogic: filterParts.length ? filterParts.join(" AND ") : undefined
  });

  const data = records.map(mapRecord).filter((r): r is TracomaSurveyResult => r !== null);
  if (data.length !== records.length) {
    throw new Error("REDCap contém registros sem ano, examinados ou contagens válidas. Corrija a base antes de interpretar os indicadores.");
  }
  return { data, isMock: false };
}

export function estimateAzithromycin(opts: {
  targetPopulation: number;
  coveragePercent?: number;
  childrenRatio?: number;
}): AzithromycinEstimate {
  if (!Number.isSafeInteger(opts.targetPopulation) || opts.targetPopulation < 1) {
    throw new Error("População alvo deve ser um inteiro positivo.");
  }
  if (opts.coveragePercent !== undefined && (!Number.isFinite(opts.coveragePercent) || opts.coveragePercent < 0 || opts.coveragePercent > 100)) {
    throw new Error("Cobertura deve estar entre 0 e 100%.");
  }
  if (opts.childrenRatio !== undefined && (!Number.isFinite(opts.childrenRatio) || opts.childrenRatio < 0 || opts.childrenRatio > 1)) {
    throw new Error("Proporção de crianças deve estar entre 0 e 1.");
  }
  const coverage = (opts.coveragePercent ?? 80) / 100;
  const target = Math.ceil(opts.targetPopulation * coverage);
  const childRatio = opts.childrenRatio ?? 0.25;
  const children = Math.round(target * childRatio);
  const adults = target - children;
  const tablets250mg = children * 2;
  const tablets500mg = adults * 2;

  return {
    population: opts.targetPopulation,
    coveragePercent: opts.coveragePercent ?? 80,
    treatmentTarget: target,
    tablets250mg,
    tablets500mg,
    totalTablets: tablets250mg + tablets500mg,
    notes: [
      `Meta de cobertura: ${opts.coveragePercent ?? 80}% → ${target} pessoas a tratar.`,
      `Criancas (${Math.round(childRatio * 100)}% estimado): ${children} × 2 comp. 250 mg = ${tablets250mg} comprimidos.`,
      `Adultos: ${adults} × 2 comp. 500 mg = ${tablets500mg} comprimidos.`,
      "Simulação logística com hipóteses fixas de comprimidos por pessoa; não é um cálculo clínico validado nem uma prescrição. A dose pediátrica exige peso e avaliação profissional.",
      "Adicione 10-15% de reserva tecnica para perdas e reposicao."
    ]
  };
}

