const DEMOGRAPHIC_FIELDS = [
  "SexMasc", "SexFem", "FxMenorUmAno", "FxUmQuatro", "FxCincoNove",
  "FxDezQuatorze", "FxQuizeOuMais"
] as const;

/** Heuristic, not proof of a historical import. Never use it to rewrite source data. */
export function isProbableTotalOnly(row: Record<string, unknown>): boolean {
  if (row.TotalCaso == null || String(row.TotalCaso).trim() === "") return false;
  const total = Number(row.TotalCaso);
  if (!Number.isInteger(total) || total < 0) return false;
  return DEMOGRAPHIC_FIELDS.every((field) => {
    const value = row[field];
    return value == null || String(value).trim() === "" || Number(value) === 0;
  });
}
