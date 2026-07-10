export type ChartData = {
  chartType: "bar" | "area" | "pie";
  title: string;
  data: Array<{ label: string; value: number }>;
};

const LABEL_RE = /gve|municipio|munic|drs|uvis|nome|semana|se\b|ano|mes|subgrupo/i;
const VALUE_RE = /total|casos|caso|count|coleta|surto|trein|acao|afasta|enca|faixa|sex/i;
const CODE_RE  = /ibge|codigo|cnes|numero|^id$/i;
const TIME_RE  = /semana|se\b|ano|mes/i;

/** Deriva um gráfico simples (bar/area/pie) a partir de linhas tabulares do CEVESP. */
export function extractChartData(
  rows: Record<string, unknown>[],
  columns: string[],
  metricLabel: string,
  timeLabel: string
): ChartData | null {
  if (rows.length < 2) return null;

  const safe = columns.filter((c) => !CODE_RE.test(c));
  let labelCol = safe.find((c) => LABEL_RE.test(c));
  let valueCol = safe.find((c) => VALUE_RE.test(c) && c !== labelCol);

  if (!labelCol) labelCol = safe.find((c) => typeof rows[0]?.[c] === "string") ?? safe[0];
  if (!valueCol) valueCol = safe.find((c) => c !== labelCol && typeof rows[0]?.[c] === "number") ?? safe[1];
  if (!labelCol || !valueCol) return null;

  const data = rows
    .slice(0, 12)
    .map((r) => ({ label: String(r[labelCol!] ?? ""), value: Number(r[valueCol!] ?? 0) }))
    .filter((d) => d.label && !isNaN(d.value) && d.value > 0);

  if (data.length < 2) return null;

  const isTime = TIME_RE.test(labelCol);
  const chartType = isTime ? "area" : data.length <= 5 ? "pie" : "bar";

  return { chartType, title: `${metricLabel} — ${timeLabel}`, data };
}
