/** Operational minimum for a descriptive historical band, not a clinical diagnostic criterion. */
export const MIN_BASELINE_YEARS = 5;
export const CHANNEL_METHODOLOGY = "Média ± 2 desvios-padrão amostrais dos 10 anos anteriores, com pelo menos 5 anos observados por período. Inclui registros explícitos de zero; ausência de registro permanece ausente. Nenhum ano é excluído automaticamente. A faixa é descritiva e não confirma epidemia nem eficácia de controle.";

export type ChannelZone = "acima" | "esperado" | "abaixo" | "insuficiente" | "sem dado";
export function classifyChannelPoint(point: { currentIncidence: number | null; q1: number; q3: number; baseline: unknown[] }): ChannelZone {
  if (point.currentIncidence == null || !Number.isFinite(point.currentIncidence)) return "sem dado";
  if (point.baseline.length < MIN_BASELINE_YEARS) return "insuficiente";
  if (point.currentIncidence > point.q3) return "acima";
  if (point.currentIncidence < point.q1) return "abaixo";
  return "esperado";
}
export const CHANNEL_ZONE_LABELS: Record<ChannelZone, string> = {
  acima: "Acima da faixa histórica", esperado: "Dentro da faixa histórica", abaixo: "Abaixo da faixa histórica",
  insuficiente: "Histórico insuficiente", "sem dado": "Sem dado de incidência"
};
