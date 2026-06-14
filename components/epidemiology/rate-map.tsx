"use client";

import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChoroplethMap } from "@/components/epidemiology/choropleth-map";

export type RateMapRow = {
  codigoIbge?: string | null;
  ano?: number;
  municipio?: string;
  gve?: string;
  casos?: number;
  positivos?: number;
  examinados?: number;
  populacao?: number;
  incidencia100k?: number | null;
  prevalencia?: number | null;
  taxaDeteccao100k?: number | null;
  coberturaExame?: number | null;
  riskColor?: string;
};

type RateMapProps = {
  title: string;
  description: string;
  rows: RateMapRow[];
  valueKey: keyof RateMapRow;
  valueLabel: string;
  tableColumns: Array<{ key: keyof RateMapRow; label: string; decimals?: number }>;
  missingPopulation?: boolean;
  message?: string;
};

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatValue(value: unknown, decimals = 0) {
  if (value == null || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function buildShapeValueMap(rows: RateMapRow[], valueKey: keyof RateMapRow) {
  const valueMap: Record<string, number> = {};
  for (const row of rows) {
    const value = Number(row[valueKey] ?? 0);
    if (!Number.isFinite(value)) continue;

    const code = String(row.codigoIbge ?? "").replace(/\D/g, "");
    if (code) {
      valueMap[code] = value;
      valueMap[code.slice(0, 6)] = value;
    }

    for (const key of [row.municipio, row.gve]) {
      if (!key) continue;
      valueMap[key] = value;
      valueMap[normalizeKey(key)] = value;
    }
  }
  return valueMap;
}

function colorFromRows(rows: RateMapRow[], valueKey: keyof RateMapRow) {
  return (value: number | null) => {
    if (value === null || value === undefined) return "#cbd5e1";
    const match = rows.find((row) => Number(row[valueKey] ?? 0) === value);
    if (match?.riskColor) return match.riskColor;
    if (value >= 50) return "#dc2626";
    if (value >= 20) return "#f59e0b";
    if (value >= 5) return "#84cc16";
    return "#14b8a6";
  };
}

export function RateMap({
  title,
  description,
  rows,
  valueKey,
  valueLabel,
  tableColumns,
  missingPopulation,
  message
}: RateMapProps) {
  const shapeType = rows.some((row) => row.municipio || row.codigoIbge) ? "municipio" : "gve";
  const valueMap = buildShapeValueMap(rows, valueKey);

  if (missingPopulation) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900">
            <AlertTriangle className="h-5 w-5" />
            População IBGE indisponível
          </CardTitle>
          <CardDescription className="text-amber-800">{message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!rows.length) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChoroplethMap
            dataUrl={`/api/geo/shapefiles?type=${shapeType}`}
            valueMap={valueMap}
            colorScheme={colorFromRows(rows, valueKey)}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Unidade do mapa: {valueLabel}. Areas sem correspondencia aparecem em cinza.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#14b8a6]" />baixo</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#84cc16]" />atenção</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />médio</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#dc2626]" />alto</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tabela de taxas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left">
                  {tableColumns.map((column) => (
                    <th key={String(column.key)} className="px-3 py-2 font-medium">{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, index) => (
                  <tr key={`${row.municipio ?? row.gve}-${index}`} className="border-b last:border-0">
                    {tableColumns.map((column) => (
                      <td key={String(column.key)} className="px-3 py-2">
                        {formatValue(row[column.key], column.decimals)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
