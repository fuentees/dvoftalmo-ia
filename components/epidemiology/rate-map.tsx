"use client";

import { useState } from "react";
import { AlertTriangle, Maximize2, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PagedTable, type PagedColumn } from "@/components/ui/paged-table";
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
  tableColumns: Array<{
    key: keyof RateMapRow;
    label: string;
    decimals?: number;
    suffix?: string;
    percentKey?: keyof RateMapRow;
    percentDecimals?: number;
  }>;
  direction?: "higher-risk" | "higher-better";
  missingPopulation?: boolean;
  message?: string;
};

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatNum(value: unknown, decimals = 0) {
  if (value == null || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCell(row: RateMapRow, col: RateMapProps["tableColumns"][number]) {
  const base = `${formatNum(row[col.key], col.decimals ?? 0)}${col.suffix ?? ""}`;
  if (!col.percentKey) return base;
  const percentValue = row[col.percentKey];
  if (percentValue == null || percentValue === "") return base;
  return `${base} (${formatNum(percentValue, col.percentDecimals ?? 1)}%)`;
}

function buildShapeValueMap(rows: RateMapRow[], valueKey: keyof RateMapRow) {
  const valueMap: Record<string, number> = {};
  for (const row of rows) {
    const value = Number(row[valueKey] ?? 0);
    if (!Number.isFinite(value)) continue;
    const code = String(row.codigoIbge ?? "").replace(/\D/g, "");
    if (code) { valueMap[code] = value; valueMap[code.slice(0, 6)] = value; }
    for (const key of [row.municipio, row.gve]) {
      if (!key) continue;
      valueMap[key] = value;
      valueMap[normalizeKey(key)] = value;
    }
  }
  return valueMap;
}

function colorFromRows(rows: RateMapRow[], valueKey: keyof RateMapRow, direction: "higher-risk" | "higher-better") {
  return (value: number | null) => {
    if (value === null || value === undefined) return "#cbd5e1";
    const match = rows.find((row) => Number(row[valueKey] ?? 0) === value);
    if (direction === "higher-risk" && match?.riskColor && (valueKey === "prevalencia" || valueKey === "incidencia100k")) {
      return match.riskColor;
    }
    if (direction === "higher-better") {
      if (value >= 80) return "#14b8a6";
      if (value >= 50) return "#84cc16";
      if (value >= 20) return "#f59e0b";
      return "#dc2626";
    }
    if (value >= 50) return "#dc2626";
    if (value >= 20) return "#f59e0b";
    if (value >= 5)  return "#84cc16";
    return "#14b8a6";
  };
}

function MapLegend({ direction }: { direction: "higher-risk" | "higher-better" }) {
  if (direction === "higher-better") {
    return (
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#14b8a6]" />adequado</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#84cc16]" />bom</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />baixo</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#dc2626]" />crítico</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#cbd5e1]" />sem dado</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#14b8a6]" />baixo</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#84cc16]" />atenção</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />médio</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#dc2626]" />alto</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#cbd5e1]" />sem dado</span>
    </div>
  );
}

export function RateMap({
  title,
  description,
  rows,
  valueKey,
  valueLabel,
  tableColumns,
  direction = "higher-risk",
  missingPopulation,
  message
}: RateMapProps) {
  const [expanded, setExpanded] = useState(false);

  const shapeType  = rows.some((row) => row.municipio || row.codigoIbge) ? "municipio" : "gve";
  const valueMap   = buildShapeValueMap(rows, valueKey);
  const colorFn    = colorFromRows(rows, valueKey, direction);
  const mappedRows = rows.filter((row) => Number(row[valueKey] ?? 0) > 0).length;

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

  // Build PagedTable columns from tableColumns prop
  const pagedCols: PagedColumn<RateMapRow>[] = tableColumns.map((col) => ({
    key: col.key as string & keyof RateMapRow,
    label: col.label,
    align: (typeof rows[0]?.[col.key] === "number" ? "right" : "left") as "left" | "right",
    render: (_v, row) => formatCell(row, col)
  }));

  const defaultSortKey = (tableColumns.find((c) => c.key === valueKey) ? valueKey : tableColumns[1]?.key ?? tableColumns[0]?.key) as string & keyof RateMapRow;
  const priorityRows = [...rows]
    .filter((row) => {
      const value = row[valueKey];
      if (value == null || value === "") return false;
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return false;
      return direction === "higher-risk" ? numericValue > 0 : true;
    })
    .sort((a, b) => {
      const diff = Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0);
      return direction === "higher-risk" ? diff : -diff;
    })
    .slice(0, 3);
  const priorityTitle = direction === "higher-risk" ? "Prioridade territorial" : "Menor cobertura";
  const priorityDescription = direction === "higher-risk"
    ? "Territórios com maior valor do indicador selecionado."
    : "Territórios com menor valor do indicador selecionado.";
  const territoryName = (row: RateMapRow) => row.municipio ?? row.gve ?? "Território";
  const contextLabel = (row: RateMapRow) => {
    if (row.casos != null) return `${formatNum(row.casos)} caso(s)`;
    if (row.positivos != null || row.examinados != null) {
      return `${formatNum(row.positivos)} positivo(s) / ${formatNum(row.examinados)} examinado(s)`;
    }
    return row.populacao != null ? `Pop. ${formatNum(row.populacao)}` : "Sem volume informado";
  };

  return (
    <>
      {/* Fullscreen map overlay */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-xs text-muted-foreground">{valueLabel}</p>
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="rounded-md border p-1.5 hover:bg-muted"
              aria-label="Fechar mapa"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-4">
            <ChoroplethMap
              dataUrl={`/api/geo/shapefiles?type=${shapeType}`}
              valueMap={valueMap}
              colorScheme={colorFn}
              className="h-full w-full"
            />
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2">
            <MapLegend direction={direction} />
            <p className="text-xs text-muted-foreground">
              {mappedRows.toLocaleString("pt-BR")} territórios com valor calculado
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {priorityRows.length > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{priorityTitle}</CardTitle>
              <CardDescription>{priorityDescription}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {priorityRows.map((row, index) => (
                <div key={`${territoryName(row)}-${index}`} className="rounded-md border bg-background p-3">
                  <div className="text-xs font-medium uppercase text-muted-foreground">#{index + 1}</div>
                  <div className="mt-1 truncate text-sm font-semibold" title={territoryName(row)}>
                    {territoryName(row)}
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {formatNum(row[valueKey], tableColumns.find((col) => col.key === valueKey)?.decimals ?? 1)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{valueLabel} · {contextLabel(row)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Mapa */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </div>
              <button
                onClick={() => setExpanded(true)}
                className="shrink-0 rounded-md border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Expandir mapa"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChoroplethMap
              dataUrl={`/api/geo/shapefiles?type=${shapeType}`}
              valueMap={valueMap}
              colorScheme={colorFn}
            />
            <MapLegend direction={direction} />
            <p className="text-xs text-muted-foreground">
              Unidade: <strong>{valueLabel}</strong>. Camada: {shapeType === "municipio" ? "municípios de SP" : "GVE"}.
              {" "}{mappedRows.toLocaleString("pt-BR")} território(s) com valor calculado. Cinza = sem dado.
            </p>
          </CardContent>
        </Card>

        {/* Tabela paginada + ordenável */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tabela de taxas</CardTitle>
            <CardDescription>
              Ordenada inicialmente pelo indicador selecionado, com volume e denominador para conferência.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <PagedTable<RateMapRow>
              rows={rows}
              columns={pagedCols}
              defaultPageSize={20}
              defaultSortKey={defaultSortKey}
              defaultSortDir="desc"
              rowKey={(row, i) => `${row.municipio ?? row.gve ?? ""}-${i}`}
              emptyText="Nenhum território com dados calculados."
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
