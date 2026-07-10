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

/** Faixa aproximada de SEs (início, fim) cobertas por um mês (1-12) de um determinado ano. */
export function monthToEpiWeekRange(year: number, month: number): [number, number] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return [dateToEpiWeek(first), dateToEpiWeek(last)];
}

/**
 * Seleciona o ponto do canal endêmico correspondente à semana epidemiológica atual real,
 * em vez da maior SE presente nos dados — uma linha invalida com SE=53 no ano corrente
 * (ex: erro de digitação) nao deve ser escolhida como "semana atual" em pleno meio do ano.
 * Cai para a SE mais recente disponível caso a semana atual ainda não tenha dado.
 */
export function pickCurrentChannelPoint(points: EndemicChannelPoint[]): EndemicChannelPoint | null {
  const withData = points.filter((p) => p.currentYear !== null);
  if (!withData.length) return null;
  const { se: currentSe } = currentEpiWeek();
  const upToNow = withData.filter((p) => p.se <= currentSe);
  const pool = upToNow.length ? upToNow : withData;
  return pool.reduce((a, b) => (b.se > a.se ? b : a));
}
