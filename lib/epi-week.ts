import type { EndemicChannelPoint } from "@/services/cevesp-endemic";

/** Semana epidemiológica real de hoje (não a maior SE presente em algum conjunto de dados). */
export function currentEpiWeek(): { year: number; se: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const se = Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
  return { year: now.getFullYear(), se };
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
