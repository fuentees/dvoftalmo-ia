interface ColumnSummary {
  name: string;
  missing: number;
  type: "number" | "date" | "text" | "boolean" | "mixed";
  topValues: Array<{ value: string; count: number }>;
  numeric?: { min: number; max: number; average: number };
}

type Row = Record<string, unknown>;
type RankItem = { name: string; total: number };
type DistributionItem = { label: string; total: number };
type WeeklyPoint = { week: string; total: number };
type WeeklyAvgPoint = { se: string; average: number };
type ReportAlert = { severity: "alta" | "media" | "baixa"; title: string; description: string };
type NotificationIndicators = {
  notifications: number;
  sampledRows: number;
  totalRowsInDatabase: number;
  totalCases: number;
  reportingMunicipalities: number;
  topMunicipalities: RankItem[];
  topGves: RankItem[];
  topUnits: RankItem[];
  sexDistribution: DistributionItem[];
  ageDistribution: DistributionItem[];
  outbreakNotifications: number;
  outbreakTotal: number;
  biologicalCollectionNotifications: number;
  biologicalCollectionTotal: number;
  educationalActions: number;
  trainings: number;
  symptomaticStaffRemoval: number;
  specializedReferrals: number;
  weeklySeries: WeeklyPoint[];
  weeklyAverage: WeeklyAvgPoint[];
  weeklyStats: { average: number; median: number; standardDeviation: number };
  trend: {
    firstWeek: WeeklyPoint;
    lastWeek: WeeklyPoint;
    percentageGrowth: number | null;
  } | null;
};

const ageFields = [
  { key: "FxMenorUmAno", label: "Menor de 1 ano" },
  { key: "FxUmQuatro", label: "1 a 4 anos" },
  { key: "FxCincoNove", label: "5 a 9 anos" },
  { key: "FxDezQuatorze", label: "10 a 14 anos" },
  { key: "FxQuizeOuMais", label: "15 anos ou mais" }
];

function inferType(values: unknown[]): ColumnSummary["type"] {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (present.length === 0) return "mixed";

  const numeric = present.filter((value) => Number.isFinite(Number(value))).length;
  const dates = present.filter((value) => !Number.isNaN(Date.parse(String(value)))).length;
  const booleans = present.filter((value) => typeof value === "boolean" || ["0", "1", "true", "false", "sim", "nao", "não"].includes(String(value).toLowerCase())).length;

  if (numeric / present.length > 0.9) return "number";
  if (dates / present.length > 0.9) return "date";
  if (booleans / present.length > 0.9) return "boolean";
  return "text";
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isYes(value: unknown) {
  return ["1", "s", "sim", "true", "x", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function topValues(values: unknown[], limit = 8) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const key = String(value).slice(0, 120);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function sumBy(rows: Row[], key: string) {
  return rows.reduce((sum, row) => sum + toNumber(row[key]), 0);
}

function groupSum(rows: Row[], groupKey: string, valueKey = "TotalCaso", limit = 10) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const group = String(row[groupKey] ?? "Nao informado").trim() || "Nao informado";
    totals.set(group, (totals.get(group) ?? 0) + toNumber(row[valueKey]));
  }

  return Array.from(totals.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function weekKeyFromRow(row: Row) {
  const ano = toNumber(row.ANO);
  const se = toNumber(row.SemEpidemio);
  if (ano > 1900 && se >= 1 && se <= 53) {
    return `${ano}-SE${String(se).padStart(2, "0")}`;
  }

  const rawDate = row.DtNotificacao;
  const date = rawDate ? new Date(String(rawDate)) : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const firstDay = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - firstDay.getTime()) / 86400000);
  const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
  return `${date.getFullYear()}-SE${String(week).padStart(2, "0")}`;
}

function weeklySeries(rows: Row[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = weekKeyFromRow(row);
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + toNumber(row.TotalCaso));
  }

  return Array.from(totals.entries())
    .map(([week, total]) => ({ week, total }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

function weeklyAverageSeries(rows: Row[]): WeeklyAvgPoint[] {
  // Step 1: aggregate total per (ANO, SE)
  const byAnoSe = new Map<string, number>();
  for (const row of rows) {
    const key = weekKeyFromRow(row);
    if (!key) continue;
    byAnoSe.set(key, (byAnoSe.get(key) ?? 0) + toNumber(row.TotalCaso));
  }

  // Step 2: for each SE, sum across years and count distinct years
  const seTotal = new Map<string, number>();
  const seYears = new Map<string, Set<string>>();
  for (const [key, total] of byAnoSe) {
    const m = key.match(/^(\d{4})-(SE\d{2})$/);
    if (!m) continue;
    const [, ano, se] = m;
    seTotal.set(se, (seTotal.get(se) ?? 0) + total);
    if (!seYears.has(se)) seYears.set(se, new Set());
    seYears.get(se)!.add(ano);
  }

  return Array.from(seTotal.entries())
    .map(([se, total]) => ({
      se,
      average: Math.round(total / (seYears.get(se)?.size ?? 1))
    }))
    .sort((a, b) => a.se.localeCompare(b.se));
}

function stats(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { average: 0, median: 0, standardDeviation: 0 };
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
  const variance = sorted.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / sorted.length;
  return {
    average: Number(average.toFixed(2)),
    median: Number(median.toFixed(2)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(2))
  };
}

function buildColumnSummaries(rows: Row[]) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return columns.map((name) => {
    const values = rows.map((row) => row[name]);
    const type = inferType(values);
    const numericValues = values.map(toNumber).filter((value) => Number.isFinite(value));

    return {
      name,
      type,
      missing: values.filter((value) => value === null || value === undefined || value === "").length,
      topValues: topValues(values),
      numeric:
        numericValues.length > 0
          ? {
              min: Math.min(...numericValues),
              max: Math.max(...numericValues),
              average: Number((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(2))
            }
          : undefined
    } satisfies ColumnSummary;
  });
}

function buildAlerts(rows: Row[], indicators: NotificationIndicators) {
  const alerts: ReportAlert[] = [];
  const rowsWithoutEducation = rows.filter((row) => toNumber(row.NuAcaoEducativa) === 0).length;
  const rowsWithoutTraining = rows.filter((row) => toNumber(row.NuTreinamento) === 0).length;
  const outbreaksWithoutCollection = rows.filter((row) => isYes(row.Surto) && toNumber(row.NuColetaMaterialBio) === 0 && !isYes(row.ColetaMaterialBio)).length;
  const recurrentOutbreakUnits = groupSum(rows.filter((row) => isYes(row.Surto)), "Unid_notificacao", "NuSurto", 8).filter((item) => item.total >= 2);
  const totalCases = indicators.totalCases || 1;

  if (outbreaksWithoutCollection > 0) {
    alerts.push({
      severity: "alta",
      title: "Surtos sem investigacao laboratorial registrada",
      description: `${outbreaksWithoutCollection} notificacoes com surto nao apresentam coleta biologica registrada, indicando oportunidade de fortalecer a investigacao etiologica.`
    });
  }

  if (rowsWithoutEducation / Math.max(rows.length, 1) > 0.4) {
    alerts.push({
      severity: "media",
      title: "Baixa frequencia de acoes educativas",
      description: `${rowsWithoutEducation} notificacoes nao registram acoes educativas, o que pode fragilizar medidas de controle e prevencao em unidades notificadoras.`
    });
  }

  if (rowsWithoutTraining / Math.max(rows.length, 1) > 0.5) {
    alerts.push({
      severity: "media",
      title: "Treinamento de equipes pouco registrado",
      description: `${rowsWithoutTraining} notificacoes nao registram treinamento, sugerindo necessidade de reforco das equipes para identificacao, notificacao e manejo de surtos.`
    });
  }

  for (const unit of recurrentOutbreakUnits.slice(0, 3)) {
    alerts.push({
      severity: "alta",
      title: "Unidade com surtos recorrentes",
      description: `${unit.name} concentra ${unit.total} registros de surtos, devendo ser priorizada para investigacao epidemiologica e revisao das medidas de controle.`
    });
  }

  const dominantAge = indicators.ageDistribution[0];
  if (dominantAge && dominantAge.total / totalCases > 0.45) {
    alerts.push({
      severity: "baixa",
      title: "Concentracao em faixa etaria especifica",
      description: `A faixa ${dominantAge.label} concentra ${dominantAge.total} casos, sugerindo investigar ambientes coletivos e exposicoes comuns desse grupo.`
    });
  }

  return alerts;
}

function buildInterpretation(indicators: NotificationIndicators, alerts: ReportAlert[]) {
  const topMunicipality = indicators.topMunicipalities[0];
  const topGve = indicators.topGves[0];
  const dominantAge = indicators.ageDistribution[0];
  const outbreakRate = indicators.notifications > 0 ? (indicators.outbreakNotifications / indicators.notifications) * 100 : 0;

  return [
    `Foram analisadas ${indicators.sampledRows} notificacoes, correspondendo a ${indicators.totalCases} casos registrados na base avaliada.`,
    topMunicipality
      ? `O municipio com maior concentracao de casos foi ${topMunicipality.name}, com ${topMunicipality.total} casos, devendo ser observado quanto a agregacao espacial e possivel transmissao em instituicoes coletivas.`
      : "Nao foi possivel identificar municipio predominante nos dados analisados.",
    topGve
      ? `No recorte regional, o GVE ${topGve.name} concentrou ${topGve.total} casos, indicando prioridade para acompanhamento regional e qualificacao das notificacoes.`
      : "Nao foi possivel identificar GVE predominante nos dados analisados.",
    dominantAge
      ? `Observa-se maior ocorrencia na faixa etaria ${dominantAge.label}, com ${dominantAge.total} casos, o que orienta medidas educativas direcionadas aos ambientes frequentados por esse grupo.`
      : "A distribuicao etaria nao pode ser interpretada por ausencia ou baixa completude dos campos de faixa etaria.",
    `A proporcao de notificacoes classificadas como surto foi de ${outbreakRate.toFixed(1)}%, parametro importante para monitoramento de agregados e resposta oportuna.`,
    alerts.length > 0
      ? "Os alertas identificados apontam situacoes que merecem investigacao epidemiologica, especialmente quanto a recorrencia de surtos, baixa coleta laboratorial e ausencia de medidas educativas."
      : "Nao foram identificados alertas automaticos relevantes na base avaliada, sem prejuizo da avaliacao tecnica local."
  ];
}

// ── Types for RPC path ────────────────────────────────────────────────────────

export type RpcRelatorioData = {
  total_notifications: number;
  total_cases: number;
  reporting_municipalities: number;
  outbreak_notifications: number;
  outbreak_total: number;
  bio_collection_notifications: number;
  bio_collection_total: number;
  educational_actions: number;
  trainings: number;
  symptomatic_removal: number;
  specialized_referrals: number;
  sex_masc: number;
  sex_fem: number;
  fx_menor_um: number;
  fx_1_4: number;
  fx_5_9: number;
  fx_10_14: number;
  fx_15_mais: number;
  weekly_avg?: number;
  weekly_median?: number;
  weekly_stddev?: number;
  weekly_series: Array<{ ano: number; se: number; total: number }>;
  top_municipios: Array<{ name: string; total: number }>;
  top_gves: Array<{ name: string; total: number }>;
  top_units: Array<{ name: string; total: number }>;
};

const bulletinSections = {
  situacaoEpidemiologica:
    "A analise considera registros do sistema CEVESP de Oftalmologia, com foco na distribuicao temporal, geografica e populacional dos casos de conjuntivite notificados.",
  investigacaoSurtos:
    "A investigacao de surtos deve priorizar unidades com recorrencia, municipios com maior concentracao de casos e notificacoes sem coleta biologica quando houver indicacao epidemiologica.",
  recomendacoes: [
    "Reforcar educacao em saude sobre higiene das maos, etiqueta respiratoria e nao compartilhamento de objetos pessoais.",
    "Orientar afastamento de sintomaticos em instituicoes coletivas conforme avaliacao local.",
    "Qualificar o preenchimento dos campos de surto, coleta biologica, medidas adotadas e encaminhamentos.",
    "Monitorar semanalmente municipios e unidades com crescimento incomum de casos.",
    "Estimular coleta laboratorial em surtos selecionados para caracterizacao etiologica."
  ]
};

export function summarizeFromRpc(
  rpc: RpcRelatorioData,
  weeklyAvgRpc: Array<{ se: number; media: number }>,
  previousYear: { ano: number; totalCases: number; notifications: number; reportingMunicipalities: number } | null
) {
  const fxValues = [rpc.fx_menor_um, rpc.fx_1_4, rpc.fx_5_9, rpc.fx_10_14, rpc.fx_15_mais];
  const ageDistribution = ageFields
    .map((f, i) => ({ label: f.label, total: Number(fxValues[i] ?? 0) }))
    .sort((a, b) => b.total - a.total);

  const weeklySeries: WeeklyPoint[] = (rpc.weekly_series ?? []).map((w) => ({
    week: `${w.ano}-SE${String(w.se).padStart(2, "0")}`,
    total: Number(w.total)
  }));

  const weeklyAverage: WeeklyAvgPoint[] = weeklyAvgRpc.map((m) => ({
    se: `SE${String(m.se).padStart(2, "0")}`,
    average: Number(m.media)
  }));

  const indicators: NotificationIndicators = {
    notifications: Number(rpc.total_notifications),
    sampledRows: Number(rpc.total_notifications),
    totalRowsInDatabase: Number(rpc.total_notifications),
    totalCases: Number(rpc.total_cases),
    reportingMunicipalities: Number(rpc.reporting_municipalities),
    topMunicipalities: (rpc.top_municipios ?? []).map((m) => ({ name: m.name, total: Number(m.total) })),
    topGves: (rpc.top_gves ?? []).map((g) => ({ name: g.name, total: Number(g.total) })),
    topUnits: (rpc.top_units ?? []).map((u) => ({ name: u.name, total: Number(u.total) })),
    sexDistribution: [
      { label: "Masculino", total: Number(rpc.sex_masc) },
      { label: "Feminino", total: Number(rpc.sex_fem) }
    ],
    ageDistribution,
    outbreakNotifications: Number(rpc.outbreak_notifications),
    outbreakTotal: Number(rpc.outbreak_total),
    biologicalCollectionNotifications: Number(rpc.bio_collection_notifications),
    biologicalCollectionTotal: Number(rpc.bio_collection_total),
    educationalActions: Number(rpc.educational_actions),
    trainings: Number(rpc.trainings),
    symptomaticStaffRemoval: Number(rpc.symptomatic_removal),
    specializedReferrals: Number(rpc.specialized_referrals),
    weeklySeries,
    weeklyAverage,
    weeklyStats: stats(weeklySeries.map((w) => w.total)),
    trend:
      weeklySeries.length >= 2
        ? {
            firstWeek: weeklySeries[0],
            lastWeek: weeklySeries[weeklySeries.length - 1],
            percentageGrowth:
              weeklySeries[0].total > 0
                ? Number((((weeklySeries[weeklySeries.length - 1].total - weeklySeries[0].total) / weeklySeries[0].total) * 100).toFixed(1))
                : null
          }
        : null
  };

  return {
    generatedAt: new Date().toISOString(),
    specialty: "Vigilancia Epidemiologica das Conjuntivites - CEVESP",
    totalRowsInDatabase: Number(rpc.total_notifications),
    sampledRows: Number(rpc.total_notifications),
    indicators,
    alerts: [] as ReportAlert[],
    interpretation: buildInterpretation(indicators, []),
    bulletinSections,
    columns: [] as ColumnSummary[],
    previousYear
  };
}

export function summarizeNotificationRows(rows: Row[], total: number, allYearsRows?: Row[]) {
  const totalCases = sumBy(rows, "TotalCaso");
  const sexDistribution = [
    { label: "Masculino", total: sumBy(rows, "SexMasc") },
    { label: "Feminino", total: sumBy(rows, "SexFem") }
  ];
  const ageDistribution = ageFields
    .map((field) => ({ label: field.label, total: sumBy(rows, field.key) }))
    .sort((a, b) => b.total - a.total);
  const weekly = weeklySeries(rows);
  const weeklyAvg = weeklyAverageSeries(allYearsRows ?? rows);
  const weeklyStats = stats(weekly.map((item) => item.total));

  const indicators = {
    notifications: rows.length,
    sampledRows: rows.length,
    totalRowsInDatabase: total,
    totalCases,
    reportingMunicipalities: new Set(
      rows.map((row) => String(row.MunicipioNotificacao ?? "").trim()).filter(Boolean)
    ).size,
    topMunicipalities: groupSum(rows, "MunicipioNotificacao", "TotalCaso", 10),
    topGves: groupSum(rows, "GVE_NOME", "TotalCaso", 10),
    topUnits: groupSum(rows, "Unid_notificacao", "TotalCaso", 10),
    sexDistribution,
    ageDistribution,
    outbreakNotifications: rows.filter((row) => isYes(row.Surto)).length,
    outbreakTotal: sumBy(rows, "NuSurto"),
    biologicalCollectionNotifications: rows.filter((row) => isYes(row.ColetaMaterialBio) || toNumber(row.NuColetaMaterialBio) > 0).length,
    biologicalCollectionTotal: sumBy(rows, "NuColetaMaterialBio"),
    educationalActions: sumBy(rows, "NuAcaoEducativa"),
    trainings: sumBy(rows, "NuTreinamento"),
    symptomaticStaffRemoval: rows.filter((row) => isYes(row.AfastamentoProfSintomatico)).length,
    specializedReferrals: sumBy(rows, "NuEncamimento"),
    weeklySeries: weekly,
    weeklyAverage: weeklyAvg,
    weeklyStats,
    trend:
      weekly.length >= 2
        ? {
            firstWeek: weekly[0],
            lastWeek: weekly[weekly.length - 1],
            percentageGrowth:
              weekly[0].total > 0 ? Number((((weekly[weekly.length - 1].total - weekly[0].total) / weekly[0].total) * 100).toFixed(1)) : null
          }
        : null
  };

  const alerts = buildAlerts(rows, indicators);

  return {
    generatedAt: new Date().toISOString(),
    specialty: "Vigilancia Epidemiologica das Conjuntivites - CEVESP",
    totalRowsInDatabase: total,
    sampledRows: rows.length,
    indicators,
    alerts,
    interpretation: buildInterpretation(indicators, alerts),
    bulletinSections,
    columns: buildColumnSummaries(rows)
  };
}
