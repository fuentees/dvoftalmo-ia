"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EndemicChannelPoint } from "@/services/cevesp-endemic";

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

interface EpidemicChartsProps {
  weeklySeries: WeekPoint[];
  ageDistribution: DistItem[];
  sexDistribution: DistItem[];
  topMunicipalities: RankItem[];
  topGves: RankItem[];
}

const SEX_COLORS = ["#2563eb", "#dc2626"];

export function EpidemicCharts({
  weeklySeries,
  ageDistribution,
  sexDistribution,
  topMunicipalities,
  topGves
}: EpidemicChartsProps) {
  const weekData = weeklySeries.map((item) => ({
    ...item,
    se: item.week.replace(/^\d{4}-/, "")
  }));

  return (
    <div className="space-y-4">
      {weekData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Curva epidêmica semanal</CardTitle>
            <CardDescription>Total de casos por semana epidemiológica</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weekData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="se" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis />
                <Tooltip formatter={(value: number) => [value, "Casos"]} />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#0f766e"
                  fill="#99f6e4"
                  name="Casos"
                  strokeWidth={2}
                />
              </AreaChart>
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
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ageDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip formatter={(value: number) => [value, "Casos"]} />
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
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sexDistribution}
                    dataKey="total"
                    nameKey="label"
                    outerRadius={85}
                    label={({ label, percent }: { label: string; percent: number }) =>
                      `${label} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {sexDistribution.map((_, i) => (
                      <Cell key={i} fill={SEX_COLORS[i % SEX_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [value, name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

interface EndemicChannelChartProps {
  data: EndemicChannelPoint[];
}

export function EndemicChannelChart({ data }: EndemicChannelChartProps) {
  const currentWeek = new Date();
  const startOfYear = new Date(currentWeek.getFullYear(), 0, 1);
  const days = Math.floor((currentWeek.getTime() - startOfYear.getTime()) / 86400000);
  const currentSe = Math.ceil((days + startOfYear.getDay() + 1) / 7);

  const chartData = data.map((point) => ({
    se: `SE${String(point.se).padStart(2, "0")}`,
    seNum: point.se,
    q1: point.q1,
    band: point.band,
    median: point.median,
    max: point.max,
    anoAtual: point.currentYear
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canal endêmico</CardTitle>
        <CardDescription>
          Faixa interquartil (Q1–Q3) dos últimos 5 anos × ano atual. SE atual: {currentSe}.
        </CardDescription>
      </CardHeader>
      <CardContent className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="se" tick={{ fontSize: 10 }} interval={3} />
            <YAxis />
            <Tooltip
              formatter={(value: unknown, name: string) => {
                const labels: Record<string, string> = {
                  q1: "Q1 (hist.)",
                  band: "Canal Q1–Q3",
                  median: "Mediana (hist.)",
                  max: "Máximo (hist.)",
                  anoAtual: "Ano atual"
                };
                return [value != null ? String(value) : "—", labels[name] ?? name];
              }}
            />
            <Legend
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  q1: "Q1",
                  band: "Canal Q1–Q3",
                  median: "Mediana histórica",
                  max: "Máximo histórico",
                  anoAtual: "Ano atual"
                };
                return labels[value] ?? value;
              }}
            />
            <Area
              type="monotone"
              dataKey="q1"
              stackId="canal"
              stroke="none"
              fill="transparent"
              legendType="none"
            />
            <Area
              type="monotone"
              dataKey="band"
              stackId="canal"
              stroke="none"
              fill="#0f766e"
              fillOpacity={0.2}
              name="band"
            />
            <Line
              type="monotone"
              dataKey="median"
              stroke="#0f766e"
              strokeDasharray="6 3"
              dot={false}
              name="median"
              strokeWidth={1.5}
            />
            <Line
              type="monotone"
              dataKey="max"
              stroke="#ca8a04"
              strokeDasharray="3 3"
              dot={false}
              name="max"
              strokeWidth={1}
            />
            <Line
              type="monotone"
              dataKey="anoAtual"
              stroke="#dc2626"
              dot={false}
              name="anoAtual"
              strokeWidth={2.5}
              connectNulls={false}
            />
            <ReferenceLine
              x={`SE${String(currentSe).padStart(2, "0")}`}
              stroke="#94a3b8"
              strokeDasharray="4 2"
              label={{ value: "SE atual", position: "top", fontSize: 10, fill: "#94a3b8" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
