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
  const totalExamined = Number(record.total_examinados ?? record.total_examined ?? 0);
  if (!totalExamined) return null;

  const tfCases = Number(record.casos_tf ?? record.tf_cases ?? 0);
  const ttCases = Number(record.casos_tt ?? record.tt_cases ?? 0);
  const tfPrev = totalExamined > 0 ? (tfCases / totalExamined) * 100 : 0;
  const ttPrev = totalExamined > 0 ? (ttCases / totalExamined) * 100 : 0;

  return {
    municipality: String(record.municipio ?? record.municipality ?? "Nao informado"),
    uf: String(record.uf ?? "SP"),
    examYear: Number(record.ano ?? record.year ?? new Date().getFullYear()),
    totalExamined,
    tfCases,
    ttCases,
    tfPrevalence: Math.round(tfPrev * 100) / 100,
    ttPrevalence: Math.round(ttPrev * 100) / 100,
    whoTfThreshold: WHO_TF_THRESHOLD,
    whoTtThreshold: WHO_TT_THRESHOLD,
    tfEliminated: tfPrev < WHO_TF_THRESHOLD,
    ttEliminated: ttPrev < WHO_TT_THRESHOLD,
    azithromycinDoses: Math.round(totalExamined * 0.8),
    populationCoverage: Number(record.cobertura ?? record.coverage ?? 80)
  };
}

function getMockSurveys(options: TracomaQueryOptions): TracomaSurveyResult[] {
  return [
    {
      municipality: options.municipality ?? "Municipio Exemplo A",
      uf: options.uf ?? "SP",
      examYear: options.yearFrom ?? new Date().getFullYear() - 1,
      totalExamined: 450,
      tfCases: 18,
      ttCases: 1,
      tfPrevalence: 4.0,
      ttPrevalence: 0.22,
      whoTfThreshold: WHO_TF_THRESHOLD,
      whoTtThreshold: WHO_TT_THRESHOLD,
      tfEliminated: true,
      ttEliminated: false,
      azithromycinDoses: 360,
      populationCoverage: 80
    },
    {
      municipality: "Municipio Exemplo B",
      uf: options.uf ?? "SP",
      examYear: options.yearFrom ?? new Date().getFullYear() - 1,
      totalExamined: 380,
      tfCases: 32,
      ttCases: 0,
      tfPrevalence: 8.42,
      ttPrevalence: 0.0,
      whoTfThreshold: WHO_TF_THRESHOLD,
      whoTtThreshold: WHO_TT_THRESHOLD,
      tfEliminated: false,
      ttEliminated: true,
      azithromycinDoses: 304,
      populationCoverage: 80
    }
  ];
}

export async function fetchTracomaSurveys(options: TracomaQueryOptions = {}): Promise<TracomaSurveyResult[]> {
  if (!isRedCapConfigured()) {
    return getMockSurveys(options);
  }

  const filterParts: string[] = [];
  if (options.municipality) filterParts.push(`[municipio] = "${options.municipality}"`);
  if (options.uf) filterParts.push(`[uf] = "${options.uf}"`);
  if (options.yearFrom) filterParts.push(`[ano] >= "${options.yearFrom}"`);
  if (options.yearTo) filterParts.push(`[ano] <= "${options.yearTo}"`);

  const records = await redcapExport({
    content: "record",
    forms: options.form ? [options.form] : [process.env.REDCAP_TRACOMA_FORM ?? "levantamento_tracoma"],
    filterLogic: filterParts.length ? filterParts.join(" AND ") : undefined
  });

  return records.map(mapRecord).filter((r): r is TracomaSurveyResult => r !== null);
}

export function estimateAzithromycin(opts: {
  targetPopulation: number;
  coveragePercent?: number;
  childrenRatio?: number;
}): AzithromycinEstimate {
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
      "Calculo conforme diretriz OMS/OPAS (azitromicina 20 mg/kg, faixas de peso padrao).",
      "Adicione 10-15% de reserva tecnica para perdas e reposicao."
    ]
  };
}

export function buildTracomaContextSummary(surveys: TracomaSurveyResult[]): string {
  if (!surveys.length) return "Nenhum dado de tracoma disponivel para o periodo/municipio solicitado.";

  const eliminated = surveys.filter((s) => s.tfEliminated && s.ttEliminated).length;
  const tfOnly = surveys.filter((s) => s.tfEliminated && !s.ttEliminated).length;
  const none = surveys.filter((s) => !s.tfEliminated && !s.ttEliminated).length;

  const lines = [
    `Levantamentos de tracoma: ${surveys.length} municipio(s) analisado(s).`,
    `Eliminacao completa (TF<5% E TT<0,2%): ${eliminated} municipio(s).`,
    `Apenas TF eliminado: ${tfOnly} municipio(s).`,
    `Nenhum criterio OMS atingido: ${none} municipio(s).`,
    "",
    "Dados por municipio:"
  ];

  for (const s of surveys) {
    lines.push(
      `- ${s.municipality} (${s.examYear}): ` +
      `TF=${s.tfPrevalence}% ${s.tfEliminated ? "[ELIMINADO]" : "[ATIVO]"}, ` +
      `TT=${s.ttPrevalence}% ${s.ttEliminated ? "[ELIMINADO]" : "[ATIVO]"}, ` +
      `examinados=${s.totalExamined}`
    );
  }

  return lines.join("\n");
}

export async function runTracomaContextQuery(message: string): Promise<{
  surveys: TracomaSurveyResult[];
  summary: string;
}> {
  const lower = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const municipioMatch = lower.match(/(?:municipio|munic)\s+(?:de\s+)?([a-z\s]+?)(?:\s+(?:em|no|na|dos|das|de|com|para)\b|$)/);
  const municipio = municipioMatch?.[1]?.trim();
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;

  const surveys = await fetchTracomaSurveys({
    municipality: municipio,
    yearFrom: year,
    yearTo: year
  });

  return { surveys, summary: buildTracomaContextSummary(surveys) };
}
