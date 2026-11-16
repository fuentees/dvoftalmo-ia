"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART } from "@/lib/chart-palette";
import { BarList, SplitBar } from "@/components/charts/bar-list";

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
  /** Partes a desenhar (padrão: todas): curva semanal, rankings territoriais e perfil (idade/sexo). */
  parts?: Array<"curva" | "territorio" | "perfil">;
}

/** Faixas etárias na ordem das idades ("Menor de 1 ano", "1 a 4 anos", ..., "15 anos ou mais"). */
function ordenarFaixas(itens: DistItem[]) {
  const idade = (rotulo: string) => (/menor|< ?1/i.test(rotulo) ? -1 : Number(rotulo.match(/\d+/)?.[0] ?? 999));
  return [...itens].sort((a, b) => idade(a.label) - idade(b.label));
}

export function EpidemicCharts({
  weeklySeries,
  weeklyAverage,
  selectedYear,
  ageDistribution,
  sexDistribution,
  topMunicipalities,
  topGves,
  parts
}: EpidemicChartsProps) {
  const show = (part: "curva" | "territorio" | "perfil") => !parts || parts.includes(part);
  // Historical comparison is meaningful for a single selected year.
  // Otherwise preserve the observed year/week case counts, including explicit zero.
  const hasHistoricalAverage = selectedYear != null && weeklyAverage.length > 0;
  const chartData =
    hasHistoricalAverage
      ? weeklyAverage.map((avg) => {
          const yearWeek = selectedYear ? `${selectedYear}-${avg.se}` : null;
          const yearPoint = yearWeek ? weeklySeries.find((w) => w.week === yearWeek) : null;
          return { se: avg.se, average: avg.average, yearTotal: yearPoint?.total ?? null };
        })
      : weeklySeries.map((item) => ({
          se: selectedYear != null ? item.week.replace(/^\d{4}-/, "") : item.week,
          average: null as number | null,
          yearTotal: item.total
        }));

  const chartDesc = hasHistoricalAverage
    ? `Barras: total ${selectedYear} · Linha: média histórica`
    : "Casos informados por ano e semana epidemiológica no recorte. Média histórica indisponível para esta comparação.";
  return (
    <div className="space-y-4">
      {show("curva") && chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Curva epidêmica semanal</CardTitle>
            <CardDescription>{chartDesc}</CardDescription>
          </CardHeader>
          <CardContent className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="se" tick={{ fontSize: 12, fill: CHART.muted }} tickLine={false} axisLine={{ stroke: CHART.grid }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fontSize: 12, fill: CHART.muted }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => v.toLocaleString("pt-BR")} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      value,
                      name === "yearTotal" ? selectedYear != null ? String(selectedYear) : "Casos no recorte" : "Média histórica"
                    ]}
                  />
                  <Legend
                    formatter={(value: string) =>
                      value === "yearTotal" ? selectedYear != null ? String(selectedYear) : "Casos no recorte" : "Média histórica"
                    }
                  />
                  <Bar dataKey="yearTotal" fill={CHART.primary} name="yearTotal" opacity={0.85} radius={[3, 3, 0, 0]} />
                  {hasHistoricalAverage && <Line
                    type="monotone"
                    dataKey="average"
                    stroke={CHART.ink}
                    strokeWidth={2}
                    dot={false}
                    name="average"
                    strokeDasharray="6 3"
                  />}
                </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {show("territorio") && <div className="grid gap-4 xl:grid-cols-2">
        {topMunicipalities.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Municípios com mais casos</CardTitle>
              <CardDescription>Os 10 primeiros no período, com a parte de cada um no total</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList items={topMunicipalities.map((i) => ({ label: i.name, value: i.total }))} maxItems={10} />
            </CardContent>
          </Card>
        )}

        {topGves.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>GVEs com mais casos</CardTitle>
              <CardDescription>Os 10 primeiros no período, com a parte de cada um no total</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList items={topGves.map((i) => ({ label: i.name, value: i.total }))} maxItems={10} />
            </CardContent>
          </Card>
        )}
      </div>}

      {show("perfil") && <div className="grid gap-4 xl:grid-cols-2">
        {ageDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Faixa etária</CardTitle>
              <CardDescription>Casos por faixa, na ordem das idades</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList items={ordenarFaixas(ageDistribution).map((i) => ({ label: i.label, value: Number(i.total) || 0 }))} />
            </CardContent>
          </Card>
        )}

        {sexDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Sexo</CardTitle>
              <CardDescription>Parte de cada sexo entre os casos com sexo informado</CardDescription>
            </CardHeader>
            <CardContent>
              <SplitBar items={sexDistribution.map((i) => ({ label: i.label, value: Number(i.total) || 0 }))} />
            </CardContent>
          </Card>
        )}
      </div>}
    </div>
  );
}
