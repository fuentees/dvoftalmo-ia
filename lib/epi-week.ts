import type { EndemicChannelPoint } from "@/services/cevesp-endemic";

export const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

function datePartsInTimeZone(date: Date, timeZone = BUSINESS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function localDateFromParts(parts: { year: number; month: number; day: number }) {
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** Converte uma data qualquer na semana epidemiologica (SE 1-53) do ano dela. */
export function dateToEpiWeek(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}

export function dateToEpiWeekYear(date: Date, timeZone = BUSINESS_TIME_ZONE): { year: number; se: number } {
  const businessDate = localDateFromParts(datePartsInTimeZone(date, timeZone));
  return { year: businessDate.getFullYear(), se: dateToEpiWeek(businessDate) };
}

export function currentCalendarYear(date = new Date(), timeZone = BUSINESS_TIME_ZONE): number {
  return datePartsInTimeZone(date, timeZone).year;
}

export function currentCalendarMonth(date = new Date(), timeZone = BUSINESS_TIME_ZONE): number {
  return datePartsInTimeZone(date, timeZone).month;
}

export function formatBusinessDate(date = new Date(), timeZone = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

export function weeksInEpiYear(year: number): number {
  return dateToEpiWeek(new Date(year, 11, 31));
}

export function shiftEpiWeek(year: number, se: number, offset: number): { year: number; se: number } {
  let nextYear = year;
  let nextSe = se + offset;

  while (nextSe < 1) {
    nextYear -= 1;
    nextSe += weeksInEpiYear(nextYear);
  }

  while (nextSe > weeksInEpiYear(nextYear)) {
    nextSe -= weeksInEpiYear(nextYear);
    nextYear += 1;
  }

  return { year: nextYear, se: nextSe };
}

/** Semana epidemiologica real de hoje no fuso de negocio. */
export function currentEpiWeek(date = new Date()): { year: number; se: number } {
  return dateToEpiWeekYear(date, BUSINESS_TIME_ZONE);
}

/**
 * Seleciona o ponto do canal endemico correspondente ao "balde" atual real (SE ou mes),
 * em vez do maior balde presente nos dados.
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

/** Variante de `pickCurrentPoint` fixada na semana epidemiologica real de hoje. */
export function pickCurrentChannelPoint(points: EndemicChannelPoint[]): EndemicChannelPoint | null {
  return pickCurrentPoint(points, currentEpiWeek().se);
}
