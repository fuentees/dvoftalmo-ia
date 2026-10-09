/**
 * Separa as pendências de qualidade por quem resolve:
 * - pronta:  a auditoria já sabe o valor certo; a central só aprova.
 * - decisao: duplicidade; alguém precisa escolher qual registro vale.
 * - unidade: só quem notificou sabe o valor certo (faixa etária, sexo, datas...).
 */
export type QualityBucket = "pronta" | "decisao" | "unidade";

export const QUALITY_BUCKETS: QualityBucket[] = ["pronta", "decisao", "unidade"];

export function qualityBucket(record: { problem: string; suggestions?: unknown[] }): QualityBucket {
  if (record.suggestions?.length) return "pronta";
  if (record.problem === "duplicata" || record.problem === "duplicata_conflito") return "decisao";
  return "unidade";
}

export function isQualityBucket(value: string | null | undefined): value is QualityBucket {
  return value === "pronta" || value === "decisao" || value === "unidade";
}
