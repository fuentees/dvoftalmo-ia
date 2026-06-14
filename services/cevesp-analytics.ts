import { z } from "zod";
import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";
import { generateCompletion } from "@/services/ai/provider";

const identifierPattern = /^[a-zA-Z0-9_]+$/;

const metrics = {
  total_casos: { label: "Total de casos", sql: "sum(coalesce(TotalCaso, 0))" },
  notificacoes: { label: "Notificacoes", sql: "count(*)" },
  unidades_notificadoras: { label: "Unidades notificadoras", sql: "count(distinct Unid_notificacao)" },
  municipios_notificadores: { label: "Municipios notificadores", sql: "count(distinct MunicipioNotificacao)" },
  surtos: {
    label: "Surtos",
    sql: "sum(case when lower(coalesce(Surto, '')) in ('1','s','sim','true','x') or coalesce(NuSurto, 0) > 0 then 1 else 0 end)"
  },
  numero_surtos: { label: "Numero de surtos informados", sql: "sum(coalesce(NuSurto, 0))" },
  coletas: { label: "Coletas biologicas", sql: "sum(coalesce(NuColetaMaterialBio, 0))" },
  acoes_educativas: { label: "Acoes educativas", sql: "sum(coalesce(NuAcaoEducativa, 0))" },
  treinamentos: { label: "Treinamentos", sql: "sum(coalesce(NuTreinamento, 0))" },
  afastamentos: {
    label: "Afastamentos de profissionais sintomaticos",
    sql: "sum(case when lower(coalesce(AfastamentoProfSintomatico, '')) in ('1','s','sim','true','x') then 1 else 0 end)"
  },
  encaminhamentos: { label: "Encaminhamentos", sql: "sum(coalesce(NuEncamimento, 0))" },
  menor_1_ano: { label: "Casos menores de 1 ano", sql: "sum(coalesce(FxMenorUmAno, 0))" },
  faixa_1_4: { label: "Casos de 1 a 4 anos", sql: "sum(coalesce(FxUmQuatro, 0))" },
  faixa_5_9: { label: "Casos de 5 a 9 anos", sql: "sum(coalesce(FxCincoNove, 0))" },
  faixa_10_14: { label: "Casos de 10 a 14 anos", sql: "sum(coalesce(FxDezQuatorze, 0))" },
  faixa_15_mais: { label: "Casos de 15 anos ou mais", sql: "sum(coalesce(FxQuizeOuMais, 0))" },
  sexo_masculino: { label: "Casos sexo masculino", sql: "sum(coalesce(SexMasc, 0))" },
  sexo_feminino: { label: "Casos sexo feminino", sql: "sum(coalesce(SexFem, 0))" },
  registros_excluidos: { label: "Registros excluidos", sql: "sum(case when coalesce(Excluido, 0) <> 0 then 1 else 0 end)" }
} as const;

const dimensions = {
  ano_cadastro: { label: "Ano informado", column: "ANO" },
  mes_cadastro: { label: "Mes informado", column: "Mes" },
  semana_epidemiologica: { label: "Semana epidemiologica", column: "SemEpidemio" },
  gve: { label: "GVE", column: "GVE_NOME" },
  gve_numero: { label: "Numero GVE", column: "gve_numero" },
  macro_gve: { label: "Macro GVE", column: "CodMacroGVE" },
  subgrupo_ve: { label: "Subgrupo VE", column: "SUBGRUPOS_VE" },
  drs: { label: "DRS", column: "DRS_NOME" },
  drs_numero: { label: "Numero DRS", column: "drs_numero" },
  municipio: { label: "Municipio", column: "MunicipioNotificacao" },
  ibge: { label: "IBGE", column: "IbgeNotificacao" },
  unidade: { label: "Unidade notificadora", column: "Unid_notificacao" },
  cnes: { label: "CNES", column: "nCNES" },
  uvis: { label: "UVIS", column: "UVIS" },
  nome_notificante: { label: "Nome notificante", column: "Nome_notificante" },
  cargo_funcao: { label: "Cargo/funcao", column: "CargoFuncao" },
  surto: { label: "Surto", column: "Surto" },
  coleta_biologica: { label: "Coleta biologica", column: "ColetaMaterialBio" },
  medida_adotada: { label: "Medida adotada", column: "MedidaAdotada" },
  afastamento: { label: "Afastamento profissional sintomatico", column: "AfastamentoProfSintomatico" },
  excluido: { label: "Excluido", column: "Excluido" },
  editavel: { label: "Editavel", column: "editable" }
} as const;

const metricKeys = [
  "total_casos",
  "notificacoes",
  "unidades_notificadoras",
  "municipios_notificadores",
  "surtos",
  "numero_surtos",
  "coletas",
  "acoes_educativas",
  "treinamentos",
  "afastamentos",
  "encaminhamentos",
  "menor_1_ano",
  "faixa_1_4",
  "faixa_5_9",
  "faixa_10_14",
  "faixa_15_mais",
  "sexo_masculino",
  "sexo_feminino",
  "registros_excluidos"
] as const;

const dimensionKeys = [
  "ano_cadastro",
  "mes_cadastro",
  "semana_epidemiologica",
  "gve",
  "gve_numero",
  "macro_gve",
  "subgrupo_ve",
  "drs",
  "drs_numero",
  "municipio",
  "ibge",
  "unidade",
  "cnes",
  "uvis",
  "nome_notificante",
  "cargo_funcao",
  "surto",
  "coleta_biologica",
  "medida_adotada",
  "afastamento",
  "excluido",
  "editavel"
] as const;

const timeGrains = {
  none: { label: "Sem agrupamento temporal", parts: [] },
  year: { label: "Ano", parts: [{ alias: "Ano", sql: "year(DtNotificacao)" }] },
  month: {
    label: "Ano e mes",
    parts: [
      { alias: "Ano", sql: "year(DtNotificacao)" },
      { alias: "Mes", sql: "month(DtNotificacao)" }
    ]
  },
  week: {
    label: "Ano e semana epidemiologica",
    parts: [
      { alias: "Ano", sql: "year(DtNotificacao)" },
      { alias: "SemanaEpidemiologica", sql: "coalesce(SemEpidemio, week(DtNotificacao, 3))" }
    ]
  },
  day: { label: "Dia", parts: [{ alias: "Dia", sql: "date(DtNotificacao)" }] }
} as const;

const analysisSchema = z.object({
  metric: z.enum(metricKeys).default("total_casos"),
  dimensions: z.array(z.enum(dimensionKeys)).default([]),
  time_grain: z.enum(["none", "year", "month", "week", "day"]).default("none"),
  date_range: z.object({
    type: z.enum([
      "all",
      "current_year",
      "last_year",
      "current_month",
      "last_month",
      "relative_years",
      "relative_months",
      "relative_weeks",
      "between"
    ]).default("all"),
    amount: z.number().int().positive().max(30).optional(),
    start: z.string().optional(),
    end: z.string().optional()
  }).default({ type: "all" }),
  filters: z.array(z.object({
    field: z.enum(dimensionKeys),
    operator: z.enum(["eq", "contains"]).default("eq"),
    value: z.string()
  })).default([]),
  limit: z.number().int().positive().max(500).default(100)
});

export type CevespAnalysis = z.infer<typeof analysisSchema>;

export type CevespUnderstanding = {
  metric: string;
  period: string;
  temporalGrouping: string;
  dimensions: string[];
  filters: string[];
  source: string;
  indicatorField: string;
  dateField: string;
  confidence: "alta" | "media" | "baixa";
  warnings: string[];
};

function normalizeAnalysis(analysis: CevespAnalysis): CevespAnalysis {
  return {
    ...analysis,
    dimensions: Array.from(new Set(analysis.dimensions)),
    filters: analysis.filters.slice(0, 8),
    limit: Math.min(analysis.limit ?? 100, 500)
  };
}

function cleanEntity(value: string) {
  return value
    .replace(/[?.!,;:]+$/g, "")
    .replace(/\b(nos|nas|no|na|em|entre|de|por|separado|separada|comparad[oa]|comparar|ranking|maiores|menores|ultimos|ultimas|esse|este|atual|ano|anos|mes|meses|semana|semanas|periodo)\b.*$/i, "")
    .trim();
}

function monthNumberFromText(lower: string) {
  const months: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    março: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12
  };
  for (const [name, value] of Object.entries(months)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return value;
  }
  return null;
}

function lastDayOfMonth(year: string, month: number) {
  return String(new Date(Number(year), month, 0).getDate()).padStart(2, "0");
}

function extractNamedFilter(lower: string, field: (typeof dimensionKeys)[number], patterns: RegExp[]) {
  const invalidValues = new Set([
    "de", "do", "da", "dos", "das", "por", "todos", "todas",
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ]);
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    const value = match?.[1] ? cleanEntity(match[1]) : "";
    const startsWithInvalid = Array.from(invalidValues).some((invalid) => value === invalid || value.startsWith(`${invalid} `));
    if (value.length >= 2 && !startsWithInvalid && !/^\d/.test(value)) {
      return { field, operator: "contains" as const, value };
    }
  }

  return null;
}

function applyQuestionHints(question: string, analysis: CevespAnalysis): CevespAnalysis {
  const lower = normalizeQuestion(question);
  const next: CevespAnalysis = {
    ...analysis,
    dimensions: [...analysis.dimensions],
    filters: [...analysis.filters]
  };
  let explicitLimit = false;

  if (/\bcasos?\b|total de casos?|quantos casos?|volume de casos?/.test(lower)) next.metric = "total_casos";
  if (/\bnotificacoes?\b|registros?\b|fichas?\b|quantas notificacoes?/.test(lower)) next.metric = "notificacoes";
  if (/\bsurtos?\b|evento[s]? de surto|teve surto|houve surto/.test(lower)) next.metric = "surtos";
  if (/\bnumero de surtos?\b|\bquantidade de surtos?\b|total de surtos?/.test(lower)) next.metric = "numero_surtos";
  if (/\bcoletas?\b|coleta biologica|material biologico|laboratorial|investigacao laboratorial/.test(lower)) next.metric = "coletas";
  if (/\bacoes? educativas?\b|educacao|atividade educativa|atividades educativas|orientacao|orientacoes/.test(lower)) next.metric = "acoes_educativas";
  if (/\btreinamentos?\b|capacitac|capacitar|treino\b/.test(lower)) next.metric = "treinamentos";
  if (/\bafastamentos?\b|profissionais? sintomaticos?|sintomaticos afastados/.test(lower)) next.metric = "afastamentos";
  if (/\bencaminh/.test(lower)) next.metric = "encaminhamentos";
  if (/\bmenor(?:es)? de 1|menor(?:es)? um|<\s*1/.test(lower)) next.metric = "menor_1_ano";
  if (/\b1\s*a\s*4\b|um a quatro|um quatro|1-4/.test(lower)) next.metric = "faixa_1_4";
  if (/\b5\s*a\s*9\b|cinco a nove|cinco nove|5-9/.test(lower)) next.metric = "faixa_5_9";
  if (/\b10\s*a\s*14\b|dez a quatorze|dez quatorze|10-14/.test(lower)) next.metric = "faixa_10_14";
  if (/\b15\s*(?:anos)?\s*(?:e|\+|ou)\s*mais|quinze ou mais|15\+/.test(lower)) next.metric = "faixa_15_mais";
  if (/\bmasculino\b|\bhomens?\b|\bsexo masc/.test(lower)) next.metric = "sexo_masculino";
  if (/\bfeminino\b|\bmulheres?\b|\bsexo fem/.test(lower)) next.metric = "sexo_feminino";
  if (/\bexcluidos?\b|registros excluidos/.test(lower)) next.metric = "registros_excluidos";

  if (/\bseparad[oa]s?\s+por\s+ano\b|\bpor\s+ano\b|\be\s+ano\b|\bano a ano\b|\banual\b|\banualmente\b|\bevolucao anual\b|\bcomparar anos?\b/.test(lower)) next.time_grain = "year";
  if (/\bseparad[oa]s?\s+por\s+mes\b|\bpor\s+mes\b|\bmensal\b|\bmensalmente\b|\bmes a mes\b|\bevolucao mensal\b|\bsazonal/.test(lower)) next.time_grain = "month";
  if (/\bpor\s+(se|s\.e\.|semana\s+epi|semana epidemiologica|semanas?)\b|\bsemanal\b|\bsemanalmente\b|\bpor semana epidemiologica\b|\bevolucao semanal\b/.test(lower)) next.time_grain = "week";
  if (/\bpor\s+dia\b|\bdiari[ao]\b|\bdia a dia\b/.test(lower)) next.time_grain = "day";

  const years = lower.match(/ultimos?\s+(\d+)\s+anos?/);
  const months = lower.match(/ultimos?\s+(\d+)\s+meses?/);
  const weeks = lower.match(/ultimas?\s+(\d+)\s+semanas?/);
  const yearBetween = lower.match(/\b(?:de|entre)\s+(\d{4})\s+(?:a|ate|e)\s+(\d{4})\b/);
  const singleYear = lower.match(/\b(?:em|no|ano de|ano)\s+(20\d{2}|19\d{2})\b/) ?? lower.match(/\b(20\d{2}|19\d{2})\b/);
  const monthNumber = monthNumberFromText(lower);
  if (/\b(esse|este|atual)\s+ano\b/.test(lower)) next.date_range = { type: "current_year" };
  else if (/\bano\s+passado\b/.test(lower)) next.date_range = { type: "last_year" };
  else if (/\b(esse|este|atual)\s+mes\b/.test(lower)) next.date_range = { type: "current_month" };
  else if (/\bmes\s+passado\b/.test(lower)) next.date_range = { type: "last_month" };
  else if (yearBetween) next.date_range = { type: "between", start: `${yearBetween[1]}-01-01`, end: `${yearBetween[2]}-12-31` };
  else if (singleYear && monthNumber) next.date_range = {
    type: "between",
    start: `${singleYear[1]}-${String(monthNumber).padStart(2, "0")}-01`,
    end: `${singleYear[1]}-${String(monthNumber).padStart(2, "0")}-${lastDayOfMonth(singleYear[1], monthNumber)}`
  };
  else if (singleYear) next.date_range = { type: "between", start: `${singleYear[1]}-01-01`, end: `${singleYear[1]}-12-31` };
  else if (years) next.date_range = { type: "relative_years", amount: Number(years[1]) };
  else if (months) next.date_range = { type: "relative_months", amount: Number(months[1]) };
  else if (weeks) next.date_range = { type: "relative_weeks", amount: Number(weeks[1]) };

  const explicitFilters = [
    extractNamedFilter(lower, "municipio", [
      /(?:municipio|munic)\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/,
      /(?:em|no|na)\s+(?:o\s+)?(?:municipio|munic)\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|em|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/,
      /\b(?:em|no|na)\s+([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|em|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/
    ]),
    extractNamedFilter(lower, "gve", [
      /\bgve\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|em|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/
    ]),
    extractNamedFilter(lower, "drs", [
      /\bdrs\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|em|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/
    ]),
    extractNamedFilter(lower, "unidade", [
      /\bunidade\s+(?:notificadora\s+)?(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|em|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/
    ]),
    extractNamedFilter(lower, "uvis", [
      /\buvis\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|em|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/
    ]),
    extractNamedFilter(lower, "cnes", [
      /\bcnes\s+([a-z0-9\s]+?)(?=\s+(?:nos?|nas?|em|por|separad|ultimos?|ultimas?|esse|este|ano|anos|mes|meses|semana|semanas)\b|$)/
    ])
  ].filter(Boolean) as CevespAnalysis["filters"];

  for (const filter of explicitFilters) {
    next.filters = next.filters.filter((item) => item.field !== filter.field);
    next.filters.push(filter);
    next.dimensions = next.dimensions.filter((dimension) => dimension !== filter.field);
  }

  if (/\bpor\s+gve\b|\bpor\s+gves\b|\bgves?\b|regional|regiao de saude/.test(lower) && !next.filters.some((filter) => filter.field === "gve")) {
    next.dimensions.push("gve");
  }
  if (/\bpor\s+drs\b|\bdrs\b/.test(lower) && !next.filters.some((filter) => filter.field === "drs")) {
    next.dimensions.push("drs");
  }
  if (/\bpor\s+municipios?\b|\bpor\s+munic\b|\bmunicipios?\s+com\b|\branking de municipios?\b|\bmaiores municipios?\b/.test(lower) && !next.filters.some((filter) => filter.field === "municipio")) {
    next.dimensions.push("municipio");
  }
  if (/\bpor\s+uvis\b|\buvis\b/.test(lower) && !next.filters.some((filter) => filter.field === "uvis")) next.dimensions.push("uvis");
  if (/\bpor\s+unidade\b|\bunidades notificadoras?\b|\bpor\s+cnes\b/.test(lower) && !next.filters.some((filter) => filter.field === "unidade")) next.dimensions.push("unidade");
  if (
    next.time_grain === "none" &&
    next.date_range.type === "relative_years" &&
    next.dimensions.length > 0 &&
    /\b(tabela|planilha|quadro|serie|evolucao|comparar|comparativo|ano|anos)\b/.test(lower) &&
    !/\b(top|ranking|maiores|menores|principais)\b/.test(lower)
  ) {
    next.time_grain = "year";
  }
  if (/\bpor\s+sexo\b|\bdistribuicao por sexo\b|\bsexo\b/.test(lower) && !/masculino|feminino|homens?|mulheres?/.test(lower)) {
    next.metric = "total_casos";
  }
  if (/\bpor\s+faixa etaria\b|\bdistribuicao etaria\b|\bidade\b|\bcriancas?\b|\badultos?\b/.test(lower) && !/menor|1\s*a\s*4|5\s*a\s*9|10\s*a\s*14|15/.test(lower)) {
    next.metric = "total_casos";
  }
  if (/\btop\s*(\d+)|\b(\d+)\s+(?:maiores|principais)\b/.test(lower)) {
    const n = Number((lower.match(/\btop\s*(\d+)/)?.[1] ?? lower.match(/\b(\d+)\s+(?:maiores|principais)\b/)?.[1]) ?? 100);
    next.limit = Math.min(Math.max(n, 1), 500);
    explicitLimit = true;
  }

  // Auto-expand limit for long time-series queries so rows are never truncated
  const spanYears =
    next.date_range.type === "relative_years" ? (next.date_range.amount ?? 5) :
    next.date_range.type === "relative_months" ? Math.ceil((next.date_range.amount ?? 12) / 12) :
    next.date_range.type === "relative_weeks" ? 1 :
    (next.date_range.type === "current_year" || next.date_range.type === "last_year") ? 1 : 10;
  const minLimit = autoLimit(next.time_grain, spanYears);
  if (!explicitLimit && (next.limit ?? 100) < minLimit) next.limit = minLimit;

  return normalizeAnalysis(next);
}

function quoteIdentifier(value: string) {
  if (!identifierPattern.test(value)) throw new Error(`Identificador invalido: ${value}`);
  return `\`${value}\``;
}

// For column aliases (AS ...) that come from hardcoded server-side labels, not user input.
// Allows spaces; escapes any backtick inside the value.
function quoteAlias(label: string) {
  return `\`${label.replace(/`/g, "``")}\``;
}

function normalizeQuestion(question: string) {
  return question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function autoLimit(grain: string, spanYears: number): number {
  // Weekly series: up to 53 SEs/year × years + buffer
  if (grain === "week") return Math.min(Math.ceil(spanYears * 53 + 10), 500);
  // Monthly: 12/year
  if (grain === "month") return Math.min(Math.ceil(spanYears * 12 + 5), 500);
  // Year grain: just years count
  if (grain === "year") return Math.min(Math.max(spanYears + 2, 10), 500);
  return 100;
}

function parseCevespQuestionRaw(question: string): CevespAnalysis {
  const lower = normalizeQuestion(question);
  const metric =
    lower.includes("numero de surto") || lower.includes("quantidade de surto") ? "numero_surtos" :
    lower.includes("surto") ? "surtos" :
    lower.includes("coleta") ? "coletas" :
    lower.includes("educativa") || lower.includes("educacao") || lower.includes("atividade") || lower.includes("acao") ? "acoes_educativas" :
    lower.includes("treinamento") ? "treinamentos" :
    lower.includes("afastamento") ? "afastamentos" :
    lower.includes("encaminh") ? "encaminhamentos" :
    lower.includes("menor de 1") || lower.includes("menor um") ? "menor_1_ano" :
    lower.includes("1 a 4") || lower.includes("um quatro") ? "faixa_1_4" :
    lower.includes("5 a 9") || lower.includes("cinco nove") ? "faixa_5_9" :
    lower.includes("10 a 14") || lower.includes("dez quatorze") ? "faixa_10_14" :
    lower.includes("15") || lower.includes("quinze") ? "faixa_15_mais" :
    lower.includes("masculino") ? "sexo_masculino" :
    lower.includes("feminino") ? "sexo_feminino" :
    lower.includes("unidades notificadoras") ? "unidades_notificadoras" :
    lower.includes("municipios notificadores") ? "municipios_notificadores" :
    lower.includes("excluido") ? "registros_excluidos" :
    lower.includes("notifica") ? "notificacoes" :
    "total_casos";

  const dimensionsFound: CevespAnalysis["dimensions"] = [];
  if (lower.includes("ano informado") || lower.includes("ano cadastro")) dimensionsFound.push("ano_cadastro");
  if (lower.includes("mes informado") || lower.includes("mes cadastro")) dimensionsFound.push("mes_cadastro");
  if (lower.includes("semana epidemiologica") || lower.includes("semepidemio")) dimensionsFound.push("semana_epidemiologica");
  if (lower.includes("gve")) dimensionsFound.push("gve");
  if (lower.includes("macro gve")) dimensionsFound.push("macro_gve");
  if (lower.includes("subgrupo")) dimensionsFound.push("subgrupo_ve");
  if (lower.includes("drs")) dimensionsFound.push("drs");
  if (lower.includes("munic")) dimensionsFound.push("municipio");
  if (lower.includes("ibge")) dimensionsFound.push("ibge");
  if (lower.includes("unidade") || lower.includes("notificadora")) dimensionsFound.push("unidade");
  if (lower.includes("cnes")) dimensionsFound.push("cnes");
  if (lower.includes("uvis")) dimensionsFound.push("uvis");
  if (lower.includes("notificante")) dimensionsFound.push("nome_notificante");
  if (lower.includes("cargo") || lower.includes("funcao")) dimensionsFound.push("cargo_funcao");
  if (lower.includes("surto") && metric !== "surtos") dimensionsFound.push("surto");
  if (lower.includes("coleta biologica")) dimensionsFound.push("coleta_biologica");
  if (lower.includes("medida")) dimensionsFound.push("medida_adotada");
  if (lower.includes("afastamento") && metric !== "afastamentos") dimensionsFound.push("afastamento");
  if (lower.includes("excluido")) dimensionsFound.push("excluido");
  if (lower.includes("editavel")) dimensionsFound.push("editavel");

  const asksByWeek = /\bpor\s+(se|s\.e\.|semana\s+epi|semana epidemiologica|semanas?)\b|\bsemanal\b/.test(lower);
  const asksByMonth = /\bpor\s+mes|mensal|mes a mes/.test(lower);
  const asksByYear = /\bpor\s+ano|anual|ano a ano/.test(lower);
  const asksByDay = /\bpor\s+dia|diario|diaria/.test(lower);
  const time_grain = asksByWeek ? "week" : asksByMonth ? "month" : asksByYear ? "year" : asksByDay ? "day" : "none";

  const years = lower.match(/ultimos?\s+(\d+)\s+anos?/);
  const months = lower.match(/ultimos?\s+(\d+)\s+meses?/);
  const weeks = lower.match(/ultimas?\s+(\d+)\s+semanas?/);
  const isCurrentYear = /\b(esse|este|atual)\s+ano\b/.test(lower);
  const isLastYear = /\bano\s+passado\b/.test(lower);
  const isCurrentMonth = /\b(esse|este|atual)\s+mes\b/.test(lower);
  const isLastMonth = /\bmes\s+passado\b/.test(lower);

  return {
    metric,
    dimensions: dimensionsFound,
    time_grain,
    date_range: isCurrentYear
      ? { type: "current_year" }
      : isLastYear
        ? { type: "last_year" }
        : isCurrentMonth
          ? { type: "current_month" }
          : isLastMonth
            ? { type: "last_month" }
            : years
              ? { type: "relative_years", amount: Number(years[1]) }
              : months
                ? { type: "relative_months", amount: Number(months[1]) }
                : weeks
                  ? { type: "relative_weeks", amount: Number(weeks[1]) }
                  : { type: "all" },
    filters: [],
    limit: autoLimit(time_grain, isCurrentYear ? 1 : isLastYear ? 1 : isCurrentMonth ? 1 : isLastMonth ? 1 : years ? Number(years[1]) : months ? Math.ceil(Number(months[1]) / 12) : weeks ? 1 : 10)
  };
}

export function parseCevespQuestionDeterministic(question: string): CevespAnalysis {
  return applyQuestionHints(question, analysisSchema.parse(parseCevespQuestionRaw(question)));
}

export async function parseCevespQuestion(question: string): Promise<CevespAnalysis> {
  const deterministic = parseCevespQuestionDeterministic(question);
  try {
    const content = await generateCompletion(
      [
        {
          role: "system",
          content: `Converta perguntas sobre conjuntivites CEVESP em JSON.
Data atual do sistema: ${new Date().toISOString().slice(0, 10)}.
Responda APENAS com JSON valido, sem texto adicional.
Use apenas:
metric: total_casos, notificacoes, unidades_notificadoras, municipios_notificadores, surtos, numero_surtos, coletas, acoes_educativas, treinamentos, afastamentos, encaminhamentos, menor_1_ano, faixa_1_4, faixa_5_9, faixa_10_14, faixa_15_mais, sexo_masculino, sexo_feminino, registros_excluidos.
dimensions: ano_cadastro, mes_cadastro, semana_epidemiologica, gve, gve_numero, macro_gve, subgrupo_ve, drs, drs_numero, municipio, ibge, unidade, cnes, uvis, nome_notificante, cargo_funcao, surto, coleta_biologica, medida_adotada, afastamento, excluido, editavel.
Variaveis reais do banco: ID, ControlaSubmit, Nome_notificante, cpf, CargoFuncao, fone_notificante, email_notificante, nCNES, Unid_notificacao, IbgeNotificacao, MunicipioNotificacao, UVIS, gve_numero, GVE_NOME, CodMacroGVE, SUBGRUPOS_VE, drs_numero, DRS_NOME, DtNotificacao, ANO, Mes, SemEpidemio, FxMenorUmAno, FxUmQuatro, FxCincoNove, FxDezQuatorze, FxQuizeOuMais, SexMasc, SexFem, TotalCaso, Surto, NuSurto, ColetaMaterialBio, NuColetaMaterialBio, MedidaAdotada, NuAcaoEducativa, NuTreinamento, AfastamentoProfSintomatico, NuEncamimento, Obs, FkQuemInsert, FkQuemExclui, Excluido, editable, created_at, DtUpdate.
Use drs para perguntas por DRS. Use semana_epidemiologica quando o usuario pedir a variavel de semana epidemiologica registrada no banco. Use week como time_grain quando ele pedir serie temporal semanal.
time_grain: none, year, month, week, day.
Use time_grain somente quando o usuario pedir agrupamento temporal, como "por mes", "mensal", "por semana", "por ano". Nao use time_grain year apenas porque ele disse "esse ano".
date_range: {type: all|current_year|last_year|current_month|last_month|relative_years|relative_months|relative_weeks|between, amount?, start?, end?}.
"esse ano" ou "este ano" = current_year. "ano passado" = last_year. "este mes" = current_month. "mes passado" = last_month. "ultimas N semanas" = relative_weeks.
Para perguntas como "teve surto esse ano?", use metric surtos, dimensions [], time_grain none, date_range current_year.
filters: campo permitido com eq ou contains.
limit maximo 500. Nao gere SQL.`
        },
        { role: "user", content: question }
      ],
      { temperature: 0, jsonMode: true }
    );
    const json = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
    const aiAnalysis = analysisSchema.parse(JSON.parse(json));
    return applyQuestionHints(question, {
      ...aiAnalysis,
      metric: deterministic.metric,
      date_range: deterministic.date_range.type === "all" ? aiAnalysis.date_range : deterministic.date_range,
      time_grain: deterministic.time_grain === "none" ? aiAnalysis.time_grain : deterministic.time_grain,
      dimensions: deterministic.dimensions.length > 0 ? deterministic.dimensions : aiAnalysis.dimensions,
      filters: deterministic.filters.length > 0 ? deterministic.filters : aiAnalysis.filters,
      limit: Math.max(deterministic.limit ?? 100, aiAnalysis.limit ?? 100)
    });
  } catch {
    return applyQuestionHints(question, deterministic);
  }
}

function buildWhere(analysis: CevespAnalysis) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (analysis.date_range.type === "current_year") {
    where.push("year(DtNotificacao) = year(curdate())");
  }
  if (analysis.date_range.type === "last_year") {
    where.push("year(DtNotificacao) = year(date_sub(curdate(), interval 1 year))");
  }
  if (analysis.date_range.type === "current_month") {
    where.push("year(DtNotificacao) = year(curdate()) and month(DtNotificacao) = month(curdate())");
  }
  if (analysis.date_range.type === "last_month") {
    where.push("year(DtNotificacao) = year(date_sub(curdate(), interval 1 month)) and month(DtNotificacao) = month(date_sub(curdate(), interval 1 month))");
  }
  if (analysis.date_range.type === "relative_years") {
    where.push("year(DtNotificacao) between year(curdate()) - ? + 1 and year(curdate())");
    params.push(analysis.date_range.amount ?? 5);
  }
  if (analysis.date_range.type === "relative_months") {
    where.push("DtNotificacao >= date_sub(curdate(), interval ? month)");
    params.push(analysis.date_range.amount ?? 12);
  }
  if (analysis.date_range.type === "relative_weeks") {
    where.push("DtNotificacao >= date_sub(curdate(), interval ? week)");
    params.push(analysis.date_range.amount ?? 8);
  }
  if (analysis.date_range.type === "between" && analysis.date_range.start && analysis.date_range.end) {
    where.push("DtNotificacao between ? and ?");
    params.push(analysis.date_range.start, analysis.date_range.end);
  }

  for (const filter of analysis.filters) {
    const column = dimensions[filter.field].column;
    if (filter.operator === "contains") {
      where.push(`${quoteIdentifier(column)} like ?`);
      params.push(`%${filter.value}%`);
    } else {
      where.push(`${quoteIdentifier(column)} = ?`);
      params.push(filter.value);
    }
  }

  return { sql: where.length ? `where ${where.join(" and ")}` : "", params };
}

export async function runCevespAnalysis(question: string) {
  const analysis = await parseCevespQuestion(question);

  // Se não há configuração de MySQL, tenta diretamente o cache Supabase
  if (!process.env.NOTIFY_DB_HOST) {
    const { runCevespAnalysisCached } = await import("@/lib/external/supabase-cevesp");
    return runCevespAnalysisCached(question, analysis);
  }

  let table: string;
  try {
    table = quoteIdentifier(getNotificationTableName());
  } catch {
    const { runCevespAnalysisCached } = await import("@/lib/external/supabase-cevesp");
    return runCevespAnalysisCached(question, analysis);
  }
  const metric = metrics[analysis.metric];
  const selectedDimensions = analysis.dimensions.map((dimension) => dimensions[dimension]);
  const grain = timeGrains[analysis.time_grain];
  const lowerQuestion = normalizeQuestion(question);

  if (/\bpor\s+sexo\b|\bdistribuicao por sexo\b|\bsexo\b/.test(lowerQuestion) && !/masculino|feminino|homens?|mulheres?/.test(lowerQuestion)) {
    return runSexDistributionReport(question, analysis, table);
  }

  if (/\bpor\s+faixa etaria\b|\bdistribuicao etaria\b|\bidade\b|\bcriancas?\b|\badultos?\b/.test(lowerQuestion) && !/menor|1\s*a\s*4|5\s*a\s*9|10\s*a\s*14|15/.test(lowerQuestion)) {
    return runAgeDistributionReport(question, analysis, table);
  }

  if (analysis.metric === "total_casos" && analysis.time_grain === "month" && analysis.dimensions.includes("gve")) {
    return runMonthlyCasesByGveReport(question, analysis, table);
  }

  if (analysis.time_grain === "week" && analysis.dimensions.length === 0 && ["relative_years", "all"].includes(analysis.date_range.type)) {
    return runWeeklyCasesByYearReport(question, analysis, table);
  }

  if (analysis.metric === "surtos" && analysis.time_grain === "none" && analysis.dimensions.length === 0) {
    return runOutbreakPresenceReport(question, analysis, table);
  }

  const selectParts: string[] = [];
  const groupParts: string[] = [];
  const temporalOrderParts: string[] = [];

  for (const part of grain.parts) {
    selectParts.push(`${part.sql} as ${quoteAlias(part.alias)}`);
    groupParts.push(part.sql);
    temporalOrderParts.push(part.sql);
  }

  for (const dimension of selectedDimensions) {
    selectParts.push(`${quoteIdentifier(dimension.column)} as ${quoteAlias(dimension.label)}`);
    groupParts.push(quoteIdentifier(dimension.column));
  }

  selectParts.push(`${metric.sql} as valor`);
  const where = buildWhere(analysis);
  const groupSql = groupParts.length ? `group by ${groupParts.join(", ")}` : "";
  const orderSql = temporalOrderParts.length
    ? `order by ${temporalOrderParts.join(", ")}, valor desc`
    : groupParts.length
      ? "order by valor desc"
      : "";
  const limit = Math.min(analysis.limit ?? 100, 500);

  const sql = `select ${selectParts.join(", ")} from ${table} ${where.sql} ${groupSql} ${orderSql} limit ${limit}`;
  let connection: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    connection = await createNotificationConnection();
    const [rows] = await connection.query(sql, where.params);
    const rawRows = rows as Array<Record<string, unknown>>;
    const dimensionLabels = selectedDimensions.map((dimension) => dimension.label);
    const transformed = analysis.time_grain === "month"
      ? pivotYearColumns(rawRows, "Mes", "Ano", dimensionLabels)
      : analysis.time_grain === "year" && dimensionLabels.length > 0
        ? pivotDimensionByYear(rawRows, dimensionLabels)
      : withTotalRow(Object.keys(rawRows[0] ?? {}), rawRows);
    return {
      question,
      analysis,
      understanding: buildUnderstanding(analysis, "MariaDB CEVESP em tempo real"),
      metricLabel: metric.label,
      timeLabel: grain.label,
      columns: transformed.columns,
      rows: transformed.rows,
      interpretation: interpretResult(question, metric.label, transformed.rows)
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // MySQL inacessível → fallback para cache Supabase
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("ENOTFOUND") || msg.includes("connect")) {
      const { runCevespAnalysisCached } = await import("@/lib/external/supabase-cevesp");
      return runCevespAnalysisCached(question, analysis);
    }
    throw err;
  } finally {
    await connection?.end();
  }
}

async function runOutbreakPresenceReport(question: string, analysis: CevespAnalysis, table: string) {
  const where = buildWhere(analysis);
  const sql = `
    select
      count(*) as notificacoes,
      sum(case when lower(coalesce(Surto, '')) in ('1','s','sim','true','x') or coalesce(NuSurto, 0) > 0 then 1 else 0 end) as notificacoes_com_surto,
      sum(coalesce(NuSurto, 0)) as total_surtos,
      sum(coalesce(NuColetaMaterialBio, 0)) as coletas_biologicas,
      sum(coalesce(NuAcaoEducativa, 0)) as acoes_educativas,
      sum(coalesce(NuTreinamento, 0)) as treinamentos
    from ${table}
    ${where.sql}
  `;
  const connection = await createNotificationConnection();
  try {
    const [rows] = await connection.query(sql, where.params);
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
    const outbreakNotifications = Number(row.notificacoes_com_surto ?? 0);
    const totalOutbreaks = Number(row.total_surtos ?? 0);
    const hasOutbreak = outbreakNotifications > 0 || totalOutbreaks > 0;
    const periodLabel = describeDateRange(analysis);
    return {
      question,
      analysis,
      understanding: buildUnderstanding(analysis, "MariaDB CEVESP em tempo real"),
      reportType: "outbreak_presence",
      metricLabel: "Surtos",
      timeLabel: periodLabel,
      columns: ["Indicador", "Valor"],
      rows: [
        { Indicador: "Houve surto no periodo?", Valor: hasOutbreak ? "Sim" : "Nao" },
        { Indicador: "Notificacoes analisadas", Valor: Number(row.notificacoes ?? 0) },
        { Indicador: "Notificacoes com surto", Valor: outbreakNotifications },
        { Indicador: "Total de surtos informados", Valor: totalOutbreaks },
        { Indicador: "Coletas biologicas", Valor: Number(row.coletas_biologicas ?? 0) },
        { Indicador: "Acoes educativas", Valor: Number(row.acoes_educativas ?? 0) },
        { Indicador: "Treinamentos", Valor: Number(row.treinamentos ?? 0) }
      ],
      interpretation: [
        hasOutbreak
          ? `Sim. Ha registro de surto no periodo ${periodLabel}, com ${outbreakNotifications} notificacoes marcadas como surto e ${totalOutbreaks} surtos informados.`
          : `Nao foram identificados registros de surto no periodo ${periodLabel}.`,
        "A interpretacao deve considerar a completude dos campos Surto e NuSurto, pois subregistro ou preenchimento incompleto pode reduzir a sensibilidade da vigilancia.",
        hasOutbreak
          ? "Recomenda-se verificar municipios e unidades envolvidas, oportunidade da notificacao, medidas educativas, afastamento de sintomaticos e indicacao de coleta biologica."
          : "Mesmo sem surto registrado, recomenda-se manter monitoramento de tendencia semanal e revisar unidades com aumento de casos."
      ]
    };
  } finally {
    await connection.end();
  }
}

async function runSexDistributionReport(question: string, analysis: CevespAnalysis, table: string) {
  const where = buildWhere(analysis);
  const sql = `
    select
      sum(coalesce(SexMasc, 0)) as masculino,
      sum(coalesce(SexFem, 0)) as feminino,
      sum(coalesce(TotalCaso, 0)) as total_casos
    from ${table}
    ${where.sql}
  `;
  const connection = await createNotificationConnection();
  try {
    const [rows] = await connection.query(sql, where.params);
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
    const masculino = Number(row.masculino ?? 0);
    const feminino = Number(row.feminino ?? 0);
    const total = Number(row.total_casos ?? 0);
    const informado = masculino + feminino;
    const naoClassificado = Math.max(total - informado, 0);
    const resultRows = [
      { Sexo: "Masculino", Valor: masculino },
      { Sexo: "Feminino", Valor: feminino },
      { Sexo: "Sem classificacao por sexo", Valor: naoClassificado },
      { Sexo: "Total", Valor: total }
    ];

    return {
      question,
      analysis,
      understanding: buildUnderstanding(analysis, "MariaDB CEVESP em tempo real"),
      reportType: "sex_distribution",
      metricLabel: "Distribuicao por sexo",
      timeLabel: describeDateRange(analysis),
      columns: ["Sexo", "Valor"],
      rows: resultRows,
      interpretation: [
        `No periodo ${describeDateRange(analysis)}, foram registrados ${total} casos segundo a soma de TotalCaso.`,
        `A distribuicao informada por sexo totaliza ${informado} casos: ${masculino} masculinos e ${feminino} femininos.`,
        naoClassificado > 0
          ? `Ha ${naoClassificado} casos sem correspondencia direta na soma SexMasc + SexFem, sugerindo verificar completude ou consistencia do preenchimento.`
          : "A soma por sexo corresponde ao total de casos informado.",
        "Diferencas importantes entre sexos devem ser interpretadas junto ao perfil das unidades notificadoras, faixa etaria e possiveis surtos em ambientes coletivos."
      ]
    };
  } finally {
    await connection.end();
  }
}

async function runAgeDistributionReport(question: string, analysis: CevespAnalysis, table: string) {
  const where = buildWhere(analysis);
  const sql = `
    select
      sum(coalesce(FxMenorUmAno, 0)) as menor_1,
      sum(coalesce(FxUmQuatro, 0)) as faixa_1_4,
      sum(coalesce(FxCincoNove, 0)) as faixa_5_9,
      sum(coalesce(FxDezQuatorze, 0)) as faixa_10_14,
      sum(coalesce(FxQuizeOuMais, 0)) as faixa_15_mais,
      sum(coalesce(TotalCaso, 0)) as total_casos
    from ${table}
    ${where.sql}
  `;
  const connection = await createNotificationConnection();
  try {
    const [rows] = await connection.query(sql, where.params);
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
    const ageRows = [
      { "Faixa etaria": "Menor de 1 ano", Valor: Number(row.menor_1 ?? 0) },
      { "Faixa etaria": "1 a 4 anos", Valor: Number(row.faixa_1_4 ?? 0) },
      { "Faixa etaria": "5 a 9 anos", Valor: Number(row.faixa_5_9 ?? 0) },
      { "Faixa etaria": "10 a 14 anos", Valor: Number(row.faixa_10_14 ?? 0) },
      { "Faixa etaria": "15 anos ou mais", Valor: Number(row.faixa_15_mais ?? 0) }
    ];
    const total = Number(row.total_casos ?? 0);
    const informed = ageRows.reduce((sum, item) => sum + item.Valor, 0);
    const peak = [...ageRows].sort((a, b) => b.Valor - a.Valor)[0];
    const resultRows = [
      ...ageRows,
      { "Faixa etaria": "Sem classificacao etaria", Valor: Math.max(total - informed, 0) },
      { "Faixa etaria": "Total", Valor: total }
    ];

    return {
      question,
      analysis,
      understanding: buildUnderstanding(analysis, "MariaDB CEVESP em tempo real"),
      reportType: "age_distribution",
      metricLabel: "Distribuicao por faixa etaria",
      timeLabel: describeDateRange(analysis),
      columns: ["Faixa etaria", "Valor"],
      rows: resultRows,
      interpretation: [
        `No periodo ${describeDateRange(analysis)}, foram registrados ${total} casos segundo a soma de TotalCaso.`,
        peak ? `A faixa etaria com maior volume foi ${peak["Faixa etaria"]}, com ${peak.Valor} casos.` : "Nao foi possivel identificar faixa etaria predominante.",
        total > informed
          ? `Ha ${total - informed} casos sem correspondencia direta na soma das faixas etarias, indicando necessidade de revisar completude.`
          : "A soma das faixas etarias corresponde ao total de casos informado.",
        "Predominio em criancas pode sugerir transmissao em ambientes coletivos escolares ou de cuidado infantil; predominio em adultos deve ser analisado junto a exposicao ocupacional e surtos institucionais."
      ]
    };
  } finally {
    await connection.end();
  }
}

async function runWeeklyCasesByYearReport(question: string, analysis: CevespAnalysis, table: string) {
  const where = buildWhere(analysis);
  const sql = `
    select
      year(DtNotificacao) as Ano,
      coalesce(SemEpidemio, week(DtNotificacao, 3)) as SE,
      sum(coalesce(TotalCaso, 0)) as valor
    from ${table}
    ${where.sql ? `${where.sql} and` : "where"} DtNotificacao is not null
    group by year(DtNotificacao), coalesce(SemEpidemio, week(DtNotificacao, 3))
    order by Ano, SE
  `;
  const connection = await createNotificationConnection();
  try {
    const [rows] = await connection.query(sql, where.params);
    const rawRows = rows as Array<Record<string, unknown>>;
    const years = Array.from(new Set(rawRows.map((r) => Number(r.Ano)).filter(Number.isFinite))).sort((a, b) => a - b).map(String);
    const columns = ["SE", ...years, "Total"];
    const pivotRows = buildWeekPivot(rawRows, years);
    const yearTotals = years.map((year) => ({
      year,
      total: pivotRows.find((r) => r.SE === "Total")?.[year] ?? 0
    }));
    const totalCases = Number(pivotRows.find((r) => r.SE === "Total")?.Total ?? 0);
    const topYears = [...yearTotals].sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 3);

    return {
      question,
      analysis,
      understanding: buildUnderstanding(analysis, "MariaDB CEVESP em tempo real"),
      reportType: "weekly_cases_by_year",
      metricLabel: "Total de casos",
      timeLabel: "Serie semanal consolidada por ano",
      columns,
      rows: pivotRows,
      weeklyReport: {
        title: "Serie semanal — total de casos por SE e ano",
        methodology: [
          "Fonte: banco CEVESP de Oftalmologia.",
          "Indicador: soma do campo TotalCaso.",
          "Campo temporal: DtNotificacao (semana obtida de SemEpidemio ou week(DtNotificacao,3)).",
          "Agregacao: SE nas linhas, anos nas colunas."
        ],
        pivotRows,
        columns,
        yearTotals,
        totalCases,
        topYears
      },
      interpretation: interpretWeeklyYearReport(totalCases, yearTotals)
    };
  } finally {
    await connection.end();
  }
}

function buildWeekPivot(rows: Array<Record<string, unknown>>, years: string[]) {
  const seSet = new Set(rows.map((r) => Number(r.SE)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 53));
  const output: Array<Record<string, unknown>> = [];

  for (const se of Array.from(seSet).sort((a, b) => a - b)) {
    const row: Record<string, unknown> = { SE: `SE${String(se).padStart(2, "0")}` };
    let total = 0;
    for (const year of years) {
      const value = rows
        .filter((r) => Number(r.SE) === se && String(r.Ano) === year)
        .reduce((sum, r) => sum + Number(r.valor ?? 0), 0);
      row[year] = value;
      total += value;
    }
    row.Total = total;
    output.push(row);
  }

  const totalRow: Record<string, unknown> = { SE: "Total" };
  let grandTotal = 0;
  for (const year of years) {
    const val = output.reduce((sum, r) => sum + Number(r[year] ?? 0), 0);
    totalRow[year] = val;
    grandTotal += val;
  }
  totalRow.Total = grandTotal;
  output.push(totalRow);
  return output;
}

function interpretWeeklyYearReport(
  totalCases: number,
  yearTotals: Array<{ year: string; total: unknown }>
) {
  const sorted = [...yearTotals].sort((a, b) => Number(b.total) - Number(a.total));
  const peak = sorted[0];
  const last = yearTotals[yearTotals.length - 1];
  const first = yearTotals[0];
  const growth = Number(first?.total) > 0
    ? Number((((Number(last?.total) - Number(first?.total)) / Number(first?.total)) * 100).toFixed(1))
    : null;
  return [
    `No periodo analisado foram registrados ${totalCases} casos de conjuntivite (soma de TotalCaso).`,
    peak ? `O ano com maior volume foi ${peak.year}, com ${peak.total} casos.` : "",
    growth === null
      ? "Nao foi possivel calcular variacao percentual entre o primeiro e o ultimo ano."
      : `Comparando ${first?.year} com ${last?.year}, a variacao foi de ${growth > 0 ? "+" : ""}${growth}%.`,
    "A tabela apresenta SE nas linhas e anos nas colunas para facilitar comparacao sazonal direta.",
    "SEs com elevacao persistente em multiplos anos devem orientar investigacao de surtos, medidas educativas e reforco da vigilancia local."
  ].filter(Boolean);
}

async function runMonthlyCasesByGveReport(question: string, analysis: CevespAnalysis, table: string) {
  const where = buildWhere(analysis);
  const sql = `
    select
      year(DtNotificacao) as Ano,
      month(DtNotificacao) as Mes,
      coalesce(GVE_NOME, 'Nao informado') as GVE,
      sum(coalesce(TotalCaso, 0)) as valor
    from ${table}
    ${where.sql ? `${where.sql} and` : "where"} DtNotificacao is not null
    group by year(DtNotificacao), month(DtNotificacao), coalesce(GVE_NOME, 'Nao informado')
    order by Ano, Mes, GVE
  `;

  const connection = await createNotificationConnection();
  try {
    const [rows] = await connection.query(sql, where.params);
    const rawRows = rows as Array<Record<string, unknown>>;
    const years = Array.from(new Set(rawRows.map((row) => Number(row.Ano)).filter(Number.isFinite))).sort((a, b) => a - b).map(String);
    const gves = Array.from(new Set(rawRows.map((row) => String(row.GVE ?? "Nao informado")))).sort();
    const columns = ["Mes", ...years, "Total"];

    const statewideRows = buildMonthPivot(rawRows, years);
    const gveSections = gves.map((gve) => ({
      gve,
      rows: buildMonthPivot(rawRows.filter((row) => String(row.GVE ?? "Nao informado") === gve), years)
    }));
    const yearTotals = years.map((year) => ({
      year,
      total: statewideRows.find((row) => row.Mes === "Total")?.[year] ?? 0
    }));
    const totalCases = Number(statewideRows.find((row) => row.Mes === "Total")?.Total ?? 0);
    const topGves = gveSections
      .map((section) => ({
        gve: section.gve,
        total: Number(section.rows.find((row) => row.Mes === "Total")?.Total ?? 0)
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    return {
      question,
      analysis,
      understanding: buildUnderstanding(analysis, "MariaDB CEVESP em tempo real"),
      reportType: "monthly_cases_by_gve",
      metricLabel: "Total de casos",
      timeLabel: "Relatorio mensal ano a ano",
      columns,
      rows: statewideRows,
      monthlyReport: {
        title: "Relatorio mensal do total de casos por GVE",
        methodology: [
          "Fonte: banco CEVESP de Oftalmologia.",
          "Indicador: soma do campo TotalCaso.",
          "Campo temporal: DtNotificacao.",
          "Campo regional: GVE_NOME.",
          "Agregacao: mes nas linhas e anos nas colunas."
        ],
        statewideRows,
        gveSections,
        yearTotals,
        totalCases,
        topGves
      },
      interpretation: interpretMonthlyGveReport(totalCases, yearTotals, topGves)
    };
  } finally {
    await connection.end();
  }
}

function buildMonthPivot(rows: Array<Record<string, unknown>>, years: string[]) {
  const output: Array<Record<string, unknown>> = [];

  for (let month = 1; month <= 12; month++) {
    const row: Record<string, unknown> = { Mes: monthName(month) };
    let total = 0;
    for (const year of years) {
      const value = rows
        .filter((item) => Number(item.Mes) === month && String(item.Ano) === year)
        .reduce((sum, item) => sum + Number(item.valor ?? 0), 0);
      row[year] = value;
      total += value;
    }
    row.Total = total;
    output.push(row);
  }

  const totalRow: Record<string, unknown> = { Mes: "Total" };
  let grandTotal = 0;
  for (const year of years) {
    const value = output.reduce((sum, row) => sum + Number(row[year] ?? 0), 0);
    totalRow[year] = value;
    grandTotal += value;
  }
  totalRow.Total = grandTotal;
  output.push(totalRow);

  return output;
}

function interpretMonthlyGveReport(
  totalCases: number,
  yearTotals: Array<{ year: string; total: unknown }>,
  topGves: Array<{ gve: string; total: number }>
) {
  const topGve = topGves[0];
  const lastYear = yearTotals[yearTotals.length - 1];
  const firstYear = yearTotals[0];
  const first = Number(firstYear?.total ?? 0);
  const last = Number(lastYear?.total ?? 0);
  const growth = first > 0 ? Number((((last - first) / first) * 100).toFixed(1)) : null;

  return [
    `No periodo analisado foram registrados ${totalCases} casos de conjuntivite, considerando a soma de TotalCaso.`,
    topGve
      ? `O GVE com maior volume acumulado foi ${topGve.gve}, com ${topGve.total} casos, devendo ser priorizado na leitura regional do periodo.`
      : "Nao foi possivel identificar o GVE com maior volume acumulado.",
    growth === null
      ? "Nao foi possivel calcular crescimento percentual entre o primeiro e o ultimo ano por ausencia de casos no ano inicial."
      : `Comparando ${firstYear.year} com ${lastYear.year}, observa-se variacao de ${growth}% no total anual de casos.`,
    "A distribuicao mensal deve ser analisada quanto a sazonalidade, agregacao regional e possivel ocorrencia de surtos em meses com elevacao abrupta.",
    "GVEs com aumento persistente ou picos mensais devem orientar verificacao de unidades notificadoras, oportunidade de notificacao, medidas educativas e investigacao laboratorial quando indicada."
  ];
}

function describeDateRange(analysis: CevespAnalysis) {
  const year = new Date().getFullYear();
  if (analysis.date_range.type === "current_year") return `ano corrente (${year})`;
  if (analysis.date_range.type === "last_year") return `ano passado (${year - 1})`;
  if (analysis.date_range.type === "current_month") return "mes corrente";
  if (analysis.date_range.type === "last_month") return "mes passado";
  if (analysis.date_range.type === "relative_years") {
    const amount = analysis.date_range.amount ?? 5;
    return `ultimos ${amount} anos-calendario (${year - amount + 1} a ${year})`;
  }
  if (analysis.date_range.type === "relative_months") return `ultimos ${analysis.date_range.amount ?? 12} meses`;
  if (analysis.date_range.type === "relative_weeks") return `ultimas ${analysis.date_range.amount ?? 8} semanas`;
  if (analysis.date_range.type === "between") return `${analysis.date_range.start} a ${analysis.date_range.end}`;
  return "todo o banco";
}

function buildUnderstanding(analysis: CevespAnalysis, source: string): CevespUnderstanding {
  const metric = metrics[analysis.metric];
  const grain = timeGrains[analysis.time_grain];
  const warnings: string[] = [];

  if (analysis.date_range.type === "all") {
    warnings.push("Nenhum periodo foi informado; a consulta considera todo o banco.");
  }
  if (analysis.filters.length === 0 && analysis.dimensions.length === 0 && analysis.time_grain === "none") {
    warnings.push("Consulta sem filtro ou agrupamento: o resultado e um consolidado geral.");
  }
  if (analysis.time_grain === "month") {
    warnings.push("Meses sao apresentados nas linhas e anos nas colunas quando ha serie temporal mensal.");
  }

  const confidence: CevespUnderstanding["confidence"] =
    warnings.length === 0 ? "alta" :
    analysis.date_range.type === "all" ? "media" :
    "alta";

  return {
    metric: metric.label,
    period: describeDateRange(analysis),
    temporalGrouping: grain.label,
    dimensions: analysis.dimensions.map((dimension) => dimensions[dimension].label),
    filters: analysis.filters.map((filter) => {
      const field = dimensions[filter.field].label;
      const operator = filter.operator === "contains" ? "contem" : "igual a";
      return `${field} ${operator} "${filter.value}"`;
    }),
    source,
    indicatorField: metric.sql,
    dateField: "DtNotificacao",
    confidence,
    warnings
  };
}

function withTotalRow(columns: string[], rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return { columns, rows };
  const numericColumns = columns.filter((column) => (
    column === "valor" ||
    column === "Valor" ||
    column === "Total" ||
    /^\d{4}$/.test(column)
  ) && rows.some((row) => typeof row[column] === "number"));
  if (numericColumns.length === 0) return { columns, rows };

  const labelColumn =
    columns.find((column) => !numericColumns.includes(column)) ??
    columns[0];
  const totalRow: Record<string, unknown> = { [labelColumn]: "Total" };
  for (const column of columns) {
    if (column === labelColumn) continue;
    totalRow[column] = numericColumns.includes(column)
      ? rows.reduce((sum, row) => sum + Number(row[column] ?? 0), 0)
      : "";
  }

  return { columns, rows: [...rows, totalRow] };
}

function monthName(value: unknown) {
  const month = Number(value);
  const names = [
    "Janeiro",
    "Fevereiro",
    "Marco",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro"
  ];
  return names[month - 1] ?? String(value ?? "Nao informado");
}

function pivotYearColumns(
  rows: Array<Record<string, unknown>>,
  rowField: string,
  columnField: string,
  dimensionFields: string[]
) {
  const years = Array.from(
    new Set(
      rows
        .map((row) => Number(row[columnField]))
        .filter((year) => Number.isInteger(year) && year > 1900)
        .map(String)
    )
  ).sort();
  const grouped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const year = Number(row[columnField]);
    const month = Number(row[rowField]);
    if (!Number.isInteger(year) || year <= 1900 || !Number.isInteger(month) || month < 1 || month > 12) continue;

    const dimensionValues = dimensionFields.map((field) => String(row[field] ?? "Nao informado"));
    const key = [month, ...dimensionValues].join("||");

    if (!grouped.has(key)) {
      const base: Record<string, unknown> = { Mes: monthName(month) };
      for (const field of dimensionFields) base[field] = row[field] ?? "Nao informado";
      for (const year of years) base[year] = 0;
      base.Total = 0;
      grouped.set(key, base);
    }

    const current = grouped.get(key)!;
    current[String(year)] = Number(row.valor ?? 0);
    current.Total = Number(current.Total ?? 0) + Number(row.valor ?? 0);
  }

  const dataRows = Array.from(grouped.entries())
    .sort(([a], [b]) => Number(a.split("||")[0]) - Number(b.split("||")[0]))
    .map(([, value]) => value);

  const totalRow: Record<string, unknown> = { Mes: "Total" };
  for (const field of dimensionFields) totalRow[field] = "Todos";
  for (const year of years) {
    totalRow[year] = dataRows.reduce((sum, row) => sum + Number(row[year] ?? 0), 0);
  }
  totalRow.Total = dataRows.reduce((sum, row) => sum + Number(row.Total ?? 0), 0);

  return {
    columns: ["Mes", ...dimensionFields, ...years, "Total"],
    rows: [...dataRows, totalRow]
  };
}

function pivotDimensionByYear(
  rows: Array<Record<string, unknown>>,
  dimensionFields: string[]
) {
  const years = Array.from(
    new Set(
      rows
        .map((row) => Number(row.Ano))
        .filter((year) => Number.isInteger(year) && year > 1900)
        .map(String)
    )
  ).sort();
  const grouped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const year = Number(row.Ano);
    if (!Number.isInteger(year) || year <= 1900) continue;
    const dimensionValues = dimensionFields.map((field) => String(row[field] ?? "Nao informado"));
    const key = dimensionValues.join("||") || "Total";

    if (!grouped.has(key)) {
      const base: Record<string, unknown> = {};
      for (const field of dimensionFields) base[field] = row[field] ?? "Nao informado";
      for (const year of years) base[year] = 0;
      base.Total = 0;
      grouped.set(key, base);
    }

    const current = grouped.get(key)!;
    current[String(year)] = Number(current[String(year)] ?? 0) + Number(row.valor ?? 0);
    current.Total = Number(current.Total ?? 0) + Number(row.valor ?? 0);
  }

  const dataRows = Array.from(grouped.values())
    .sort((a, b) => Number(b.Total ?? 0) - Number(a.Total ?? 0));

  const totalRow: Record<string, unknown> = {};
  for (const field of dimensionFields) totalRow[field] = "Total";
  for (const year of years) {
    totalRow[year] = dataRows.reduce((sum, row) => sum + Number(row[year] ?? 0), 0);
  }
  totalRow.Total = dataRows.reduce((sum, row) => sum + Number(row.Total ?? 0), 0);

  return {
    columns: [...dimensionFields, ...years, "Total"],
    rows: [...dataRows, totalRow]
  };
}

function interpretResult(question: string, metricLabel: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    return ["Nao foram encontrados registros para os criterios solicitados."];
  }
  const ranked = rows
    .map((row) => ({
      row,
      value: Object.entries(row)
        .filter(([key]) => /^\d{4}$/.test(key) || key === "valor")
        .reduce((sum, [, value]) => sum + Number(value ?? 0), 0)
    }))
    .sort((a, b) => b.value - a.value);
  const top = ranked[0]?.row ?? rows[0];
  const topValue = ranked[0]?.value ?? top.valor;
  const topLabel = Object.entries(top)
    .filter(([key]) => key !== "valor" && !/^\d{4}$/.test(key))
    .map(([, value]) => String(value))
    .join(" / ");
  return [
    `A consulta solicitada foi interpretada como analise de ${metricLabel.toLowerCase()}.`,
    `O maior valor observado no resultado foi ${topValue}, associado a ${topLabel || "conjunto analisado"}.`,
    "A leitura epidemiologica deve considerar oportunidade de notificacao, completude dos campos e possivel concentracao de transmissao em unidades ou municipios com maiores valores.",
    "Resultados elevados por GVE, municipio ou unidade devem orientar verificacao local, investigacao de surtos e reforco das medidas de prevencao e controle."
  ];
}
