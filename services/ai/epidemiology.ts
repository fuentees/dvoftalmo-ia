export interface EpidemiologySummary {
  rows: number;
  columns: string[];
  missingByColumn: Record<string, number>;
  numericIndicators: Record<string, { min: number; max: number; average: number }>;
}

export function summarizeRows(rows: Array<Record<string, unknown>>): EpidemiologySummary {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const missingByColumn: Record<string, number> = {};
  const numericIndicators: EpidemiologySummary["numericIndicators"] = {};

  for (const column of columns) {
    const values = rows.map((row) => row[column]);
    missingByColumn[column] = values.filter((value) => value === null || value === undefined || value === "").length;
    const numericValues = values.map(Number).filter((value) => Number.isFinite(value));
    if (numericValues.length > 0) {
      numericIndicators[column] = {
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        average: Number((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(2))
      };
    }
  }

  return { rows: rows.length, columns, missingByColumn, numericIndicators };
}
