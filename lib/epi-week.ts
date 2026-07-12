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

function startOfEpiWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function startOfFirstEpiWeek(year: number): Date {
  return startOfEpiWeek(new Date(year, 0, 4));
}

function epiWeekYear(date: Date): number {
  const weekStart = startOfEpiWeek(date);
  const majorityDay = new Date(weekStart);
  majorityDay.setDate(weekStart.getDate() + 3);
  return majorityDay.getFullYear();
}

/** Converte uma data qualquer na semana epidemiologica oficial (domingo a sabado). */
export function dateToEpiWeek(date: Date): number {
  const year = epiWeekYear(date);
  const weekStart = startOfEpiWeek(date);
  const firstWeekStart = startOfFirstEpiWeek(year);
  return Math.round((weekStart.getTime() - firstWeekStart.getTime()) / (7 * 86_400_000)) + 1;
}

export function dateToEpiWeekYear(date: Date, timeZone = BUSINESS_TIME_ZONE): { year: number; se: number } {
  const businessDate = localDateFromParts(datePartsInTimeZone(date, timeZone));
  return { year: epiWeekYear(businessDate), se: dateToEpiWeek(businessDate) };
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
  return Math.round((startOfFirstEpiWeek(year + 1).getTime() - startOfFirstEpiWeek(year).getTime()) / (7 * 86_400_000));
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
