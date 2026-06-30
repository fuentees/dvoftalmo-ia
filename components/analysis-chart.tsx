"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart2, TrendingUp } from "lucide-react";

const PALETTE = [
  "#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed",
  "#0891b2", "#be185d", "#059669", "#ea580c", "#4f46e5",
  "#b45309", "#0f766e",
];

const MAX_SERIES = 10;
const MAX_RANK = 20;

type Shape =
  | { kind: "pivot";    dimCol: string; yearCols: string[] }
  | { kind: "monthly";  dimCol: string; yearCols: string[] }
  | { kind: "rank";     dimCol: string; valueCol: string }
  | { kind: "timeseries"; dimCol: string; valueCol: string };

function detectShape(columns: string[], rows: Array<Record<string, unknown>>): Shape | null {
  if (columns.length < 2 || rows.length === 0) return null;
  const [dimCol, ...rest] = columns;
  const yearCols = rest.filter((c) => /^\d{4}$/.test(c));

  // Pivot: first col = dimension label, remaining cols include year numbers
  if (yearCols.length >= 1) {
    const isMes = dimCol === "Mes" || dimCol === "Mês";
    return isMes
      ? { kind: "monthly", dimCol, yearCols }
      : { kind: "pivot", dimCol, yearCols };
  }

  // 2-column: [label, value]
  if (columns.length === 2) {
    const temporal = /^(ano|semana|mes|mês|se\b)/i.test(dimCol) || dimCol === "Ano";
    return temporal
      ? { kind: "timeseries", dimCol, valueCol: rest[0] }
      : { kind: "rank", dimCol, valueCol: rest[0] };
  }

  return null;
}

function buildChartData(
  shape: Shape | null,
  rows: Array<Record<string, unknown>>,
) {
  if (!shape) return { data: [], series: [], xKey: "", truncated: false };

  const isTotal = (row: Record<string, unknown>) =>
    Object.values(row).some((v) => String(v).toLowerCase() === "total");

  if (shape.kind === "pivot") {
    // row-per-dimension → row-per-year transformation
    const dataRows = rows.filter((r) => !isTotal(r));
    // sort by Total desc to get top series
    const sorted = [...dataRows].sort((a, b) => Number(b.Total ?? 0) - Number(a.Total ?? 0));
    const topRows = sorted.slice(0, MAX_SERIES);
    const truncated = sorted.length > MAX_SERIES;
    const seriesNames = topRows.map((r) => String(r[shape.dimCol] ?? ""));

    const data = shape.yearCols.map((yr) => {
      const point: Record<string, unknown> = { ano: yr };
      for (const row of topRows) {
        point[String(row[shape.dimCol])] = Number(row[yr] ?? 0);
      }
      return point;
    });

    return { data, series: seriesNames, xKey: "ano", truncated };
  }

  if (shape.kind === "monthly") {
    // rows are already per-month, series = years
    const data = rows.filter((r) => !isTotal(r)).map((r) => {
      const point: Record<string, unknown> = { [shape.dimCol]: r[shape.dimCol] };
      for (const yr of shape.yearCols) point[yr] = Number(r[yr] ?? 0);
      return point;
    });
    return { data, series: shape.yearCols, xKey: shape.dimCol, truncated: false };
  }

  if (shape.kind === "rank") {
    const data = rows
      .filter((r) => !isTotal(r))
      .sort((a, b) => Number(b[shape.valueCol] ?? 0) - Number(a[shape.valueCol] ?? 0))
      .slice(0, MAX_RANK)
      .map((r) => ({ [shape.dimCol]: String(r[shape.dimCol] ?? ""), Valor: Number(r[shape.valueCol] ?? 0) }));
    const truncated = rows.filter((r) => !isTotal(r)).length > MAX_RANK;
    return { data, series: ["Valor"], xKey: shape.dimCol, truncated };
  }

  // timeseries
  const data = rows
    .filter((r) => !isTotal(r))
    .map((r) => ({ [shape.dimCol]: String(r[shape.dimCol] ?? ""), Valor: Number(r[shape.valueCol] ?? 0) }));
  return { data, series: ["Valor"], xKey: shape.dimCol, truncated: false };
}

type AnalysisChartProps = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  title?: string;
};

export function AnalysisChart({ columns, rows, title }: AnalysisChartProps) {
  const [mode, setMode] = useState<"line" | "bar">("line");

  const shape = useMemo(() => detectShape(columns, rows), [columns, rows]);
  const { data, series, xKey, truncated } = useMemo(
    () => buildChartData(shape, rows),
    [shape, rows],
  );

  if (!shape || data.length === 0) return null;

  const isHorizontal = shape.kind === "rank";
  const canToggle = !isHorizontal;

  // Estimate label width for horizontal bars
  const maxLabelLen = isHorizontal
    ? Math.max(...data.map((d) => String(d[xKey] ?? "").length), 10)
    : 0;
  const yWidth = isHorizontal ? Math.min(maxLabelLen * 6.5 + 8, 180) : 52;

  const fmt = (v: unknown) => Number(v).toLocaleString("pt-BR");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title ?? "Visualização"}</p>
        {canToggle && (
          <div className="flex overflow-hidden rounded border text-xs">
            <button
              onClick={() => setMode("line")}
              className={`flex items-center gap-1 px-2 py-1 transition-colors ${mode === "line" ? "bg-muted font-semibold" : "hover:bg-muted/50"}`}
            >
              <TrendingUp className="h-3 w-3" /> Linha
            </button>
            <button
              onClick={() => setMode("bar")}
              className={`flex items-center gap-1 border-l px-2 py-1 transition-colors ${mode === "bar" ? "bg-muted font-semibold" : "hover:bg-muted/50"}`}
            >
              <BarChart2 className="h-3 w-3" /> Barras
            </button>
          </div>
        )}
      </div>

      {truncated && (
        <p className="text-xs text-muted-foreground">
          Exibindo as {shape.kind === "rank" ? MAX_RANK : MAX_SERIES} séries com maior total. Consulte a tabela para o conjunto completo.
        </p>
      )}

      <div className={isHorizontal ? `h-[${Math.min(data.length * 28 + 40, 520)}px]` : "h-72"} style={isHorizontal ? { height: Math.min(data.length * 28 + 40, 520) } : { height: 288 }}>
        <ResponsiveContainer width="100%" height="100%">
          {isHorizontal ? (
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
              <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10 }} width={yWidth} />
              <Tooltip formatter={fmt} />
              <Bar dataKey="Valor" fill={PALETTE[0]} radius={[0, 3, 3, 0]} />
            </BarChart>
          ) : mode === "bar" ? (
            <BarChart data={data} margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={yWidth} tickFormatter={fmt} />
              <Tooltip formatter={fmt} />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={yWidth} tickFormatter={fmt} />
              <Tooltip formatter={fmt} />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((s, i) => (
                <Line
                  key={s}
                  type="monotone"
                  dataKey={s}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={data.length <= 15}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
