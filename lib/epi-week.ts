import type { EndemicChannelPoint } from "@/services/cevesp-endemic";

/** Converte uma data qualquer na semana epidemiológica (SE 1-53) do ano dela. */
export function dateToEpiWeek(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}

/** Semana epidemiológica real de hoje (não a maior SE presente em algum conjunto de dados). */
export function currentEpiWeek(): { year: number; se: number } {
  const now = new Date();
  return { year: now.getFullYear(), se: dateToEpiWeek(now) };
}

/**
 * Seleciona o ponto do canal endêmico correspondente ao "balde" atual real (SE ou mês,
 * conforme `currentBucket`), em vez do maior balde presente nos dados — um valor invalido
 * no ano corrente (ex: erro de digitação) nao deve ser escolhido como "atual" em pleno meio
 * do periodo. Cai para o balde mais recente disponível caso o atual ainda não tenha dado.
 */
export function pickCurrentPoint<T extends { se: number; currentYear: number | null }>(
  points: T[],
  currentBucket: number
): T | null {
  const withData = points.filter((p) => p.currentYear !== null);
  if (!withData.length) return null;
  const upToNow = withData.filter((p) => p.se <= currentBucket);
  const pool = upToNow.length ? upToNow : withData;
  return pool.reduce((a, b) => (b.se > a.se ? b : a));
}

/** Variante de `pickCurrentPoint` fixada na semana epidemiológica real de hoje. */
export function pickCurrentChannelPoint(points: EndemicChannelPoint[]): EndemicChannelPoint | null {
  return pickCurrentPoint(points, currentEpiWeek().se);
}
