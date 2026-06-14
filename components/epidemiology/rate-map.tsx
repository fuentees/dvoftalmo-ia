"use client";

import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type RateMapRow = {
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

function formatValue(value: unknown, decimals = 0) {
  if (value == null || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
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
  const visible = rows.slice(0, 80);

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
          <div className="grid grid-cols-5 gap-1 sm:grid-cols-8 md:grid-cols-10 xl:grid-cols-8">
            {visible.map((row, index) => {
              const value = row[valueKey];
              const label = row.municipio ?? row.gve ?? `Item ${index + 1}`;
              return (
                <div
                  key={`${label}-${index}`}
                  className="group relative aspect-square rounded-sm border"
                  style={{ backgroundColor: row.riskColor ?? "#94a3b8" }}
                  title={`${label}: ${formatValue(value, 2)} ${valueLabel}`}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-white opacity-0 drop-shadow group-hover:opacity-100">
                    {formatValue(value, 1)}
                  </span>
                </div>
              );
            })}
          </div>
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
