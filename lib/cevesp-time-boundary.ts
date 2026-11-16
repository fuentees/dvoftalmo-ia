import { BUSINESS_TIME_ZONE, currentCalendarMonth, currentCalendarYear, currentEpiWeek, weeksInEpiYear } from "./epi-week";

export function businessDateIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Source dates are civil notification dates; future/invalid values never establish freshness. */
export function assessNotificationDate(value: unknown, now = new Date()) {
  const raw = value == null || String(value).trim() === "" ? null : String(value).trim();
  if (!raw) return { value: null, raw, issue: "missing" as const };
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if (!match) return { value: null, raw, issue: "invalid" as const };
  const [year, month, day] = match.slice(1).map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (year <= 1900 || candidate.getUTCFullYear() !== year || candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) return { value: null, raw, issue: "invalid" as const };
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  if (iso > businessDateIso(now)) return { value: null, raw, issue: "future" as const };
  return { value: iso, raw, issue: null };
}

export function observationYears(values: unknown[], now = new Date()) {
  const currentYear = currentCalendarYear(now);
  const numericYears = [...new Set(values.map(Number))].filter((year) => Number.isInteger(year) && year > 1900);
  return {
    years: numericYears.filter((year) => year <= currentYear).sort((a, b) => a - b),
    excludedYears: numericYears.filter((year) => year > currentYear).sort((a, b) => a - b),
  };
}

/** Current-period observations stop at the current local bucket; future source rows stay diagnostics. */
export function observedBucketLimit(year: number, grain: "week" | "month", now = new Date()): number {
  if (!Number.isInteger(year) || year <= 1900 || year > currentCalendarYear(now)) return 0;
  if (year < currentCalendarYear(now)) return grain === "month" ? 12 : weeksInEpiYear(year);
  if (grain === "month") return currentCalendarMonth(now);
  const week = currentEpiWeek(now);
  return week.year === year ? week.se : 0;
}

export function isObservedBucket(year: number, bucket: number, grain: "week" | "month", now = new Date()): boolean {
  return Number.isInteger(bucket) && bucket >= 1 && bucket <= observedBucketLimit(year, grain, now);
}
