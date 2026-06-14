interface ColumnSummary {
  name: string;
  missing: number;
  type: "number" | "date" | "text" | "boolean" | "mixed";
  topValues: Array<{ value: string; count: number }>;
  numeric?: { min: number; max: number; average: number };
}

type Row = Record<string, unknown>;

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

function weeklySeries(rows: Row[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const rawDate = row.DtNotificacao;
    const date = rawDate ? new Date(String(rawDate)) : null;
    if (!date || Number.isNaN(date.getTime())) continue;

    const firstDay = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - firstDay.getTime()) / 86400000);
    const week = Math.ceil((days + firstDay.getDay() + 1) / 7);
    const key = `${date.getFullYear()}-SE${String(week).padStart(2, "0")}`;
    totals.set(key, (totals.get(key) ?? 0) + toNumber(row.TotalCaso));
  }

  return Array.from(totals.entries())
    .map(([week, total]) => ({ week, total }))
    .sort((a, b) => a.week.localeCompare(b.week));
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

function buildAlerts(rows: Row[], indicators: any) {
  const alerts: Array<{ severity: "alta" | "media" | "baixa"; title: string; description: string }> = [];
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

function buildInterpretation(indicators: any, alerts: any[]) {
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

export function summarizeNotificationRows(rows: Row[], total: number) {
  const totalCases = sumBy(rows, "TotalCaso");
  const sexDistribution = [
    { label: "Masculino", total: sumBy(rows, "SexMasc") },
    { label: "Feminino", total: sumBy(rows, "SexFem") }
  ];
  const ageDistribution = ageFields
    .map((field) => ({ label: field.label, total: sumBy(rows, field.key) }))
    .sort((a, b) => b.total - a.total);
  const weekly = weeklySeries(rows);
  const weeklyStats = stats(weekly.map((item) => item.total));

  const indicators = {
    notifications: rows.length,
    sampledRows: rows.length,
    totalRowsInDatabase: total,
    totalCases,
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
    bulletinSections: {
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
    },
    columns: buildColumnSummaries(rows)
  };
}
