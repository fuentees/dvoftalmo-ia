"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface WeekPoint {
  week: string;
  total: number;
}

interface DistItem {
  label: string;
  total: number;
}

interface RankItem {
  name: string;
  total: number;
}

interface WeekAvgPoint {
  se: string;
  average: number;
}

interface EpidemicChartsProps {
  weeklySeries: WeekPoint[];
  weeklyAverage: WeekAvgPoint[];
  selectedYear?: number | null;
  ageDistribution: DistItem[];
  sexDistribution: DistItem[];
  topMunicipalities: RankItem[];
  topGves: RankItem[];
}

export function EpidemicCharts({
  weeklySeries,
  weeklyAverage,
  selectedYear,
  ageDistribution,
  sexDistribution,
  topMunicipalities,
  topGves
}: EpidemicChartsProps) {
  // Build chart data: always keyed by SE (SE01–SE53) from weeklyAverage.
  // Falls back to weeklySeries when weeklyAverage is not available.
  const chartData =
    weeklyAverage.length > 0
      ? weeklyAverage.map((avg) => {
          const yearWeek = selectedYear ? `${selectedYear}-${avg.se}` : null;
          const yearPoint = yearWeek ? weeklySeries.find((w) => w.week === yearWeek) : null;
          return { se: avg.se, average: avg.average, yearTotal: yearPoint?.total ?? null };
        })
      : weeklySeries.map((item) => ({
          se: item.week.replace(/^\d{4}-/, ""),
          average: item.total,
          yearTotal: null as number | null
        }));

  const showYearBars =
    selectedYear != null && chartData.some((d) => d.yearTotal != null && d.yearTotal > 0);

  const chartDesc = showYearBars
    ? `Barras: total ${selectedYear} · Linha: média histórica`
    : "Média de casos por semana epidemiológica (todos os anos)";
  const ageTotal = ageDistribution.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
  const sexTotal = sexDistribution.reduce((sum, item) => sum + Number(item.total ?? 0), 0);
  const ageChartData = ageDistribution.map((item) => ({
    ...item,
    percent: ageTotal ? (item.total / ageTotal) * 100 : 0
  }));
  const sexChartData = sexDistribution.map((item) => ({
    ...item,
    percent: sexTotal ? (item.total / sexTotal) * 100 : 0,
    percentLabel: sexTotal ? `${((item.total / sexTotal) * 100).toFixed(1)}%` : "0%"
  }));

  return (
    <div className="space-y-4">
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Curva epidêmica semanal</CardTitle>
            <CardDescription>{chartDesc}</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              {showYearBars ? (
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="se" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      value,
                      name === "yearTotal" ? String(selectedYear) : "Média histórica"
                    ]}
                  />
                  <Legend
                    formatter={(value: string) =>
                      value === "yearTotal" ? String(selectedYear) : "Média histórica"
                    }
                  />
                  <Bar dataKey="yearTotal" fill="#0f766e" name="yearTotal" opacity={0.85} radius={[3, 3, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="average"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={false}
                    name="average"
                    strokeDasharray="6 3"
                  />
                </ComposedChart>
              ) : (
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="se" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => [value, "Média"]} />
                  <Area
                    type="monotone"
                    dataKey="average"
                    stroke="#0f766e"
                    fill="#99f6e4"
                    name="Média histórica"
                    strokeWidth={2}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {topMunicipalities.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Top municípios</CardTitle>
              <CardDescription>Municípios com mais casos no período</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topMunicipalities.slice(0, 10)} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => [value, "Casos"]} />
                  <Bar dataKey="total" fill="#ca8a04" name="Casos" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {topGves.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Top GVEs</CardTitle>
              <CardDescription>GVEs com mais casos no período</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topGves.slice(0, 10)} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => [value, "Casos"]} />
                  <Bar dataKey="total" fill="#0f766e" name="Casos" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {ageDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Distribuição por faixa etária</CardTitle>
              <CardDescription>Casos e participação percentual no recorte</CardDescription>
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ageChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number, name: string, item) => [
                      name === "total"
                        ? `${value.toLocaleString("pt-BR")} (${Number(item.payload.percent ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`
                        : value,
                      "Casos"
                    ]}
                  />
                  <Bar dataKey="total" fill="#0f766e" name="Casos" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {sexDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Distribuição por sexo</CardTitle>
              <CardDescription>Comparação em barras para evitar leitura ambígua</CardDescription>
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sexChartData} layout="vertical" margin={{ left: 12, right: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="label" type="category" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, name: string, item) => [
                      `${value.toLocaleString("pt-BR")} (${Number(item.payload.percent ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`,
                      "Casos"
                    ]}
                  />
                  <Bar dataKey="total" fill="#2563eb" name="Casos" radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="percentLabel" position="right" className="fill-muted-foreground text-[11px]" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
