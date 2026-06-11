/**
 * Fallback CEVESP: consulta o cache no Supabase quando o MySQL 192.168.1.204
 * está inacessível (ex: fora da rede SES-SP no Vercel).
 * As RPCs PostgreSQL espelham a lógica do cevesp-analytics.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";

interface CevespAnalysisInput {
  metric: string;
  dimensions: string[];
  time_grain: string;
  date_range: {
    type: string;
    amount?: number;
    start?: string;
    end?: string;
  };
  filters?: Array<{ field: string; operator: string; value: string }>;
  limit?: number;
}

/** Mapeia o date_range do formato cevesp-analytics para parâmetros inteiros */
function resolveDateRange(dr: CevespAnalysisInput["date_range"]): {
  anoStart?: number; anoEnd?: number; seStart?: number; seEnd?: number; startDate?: string; endDate?: string;
} {
  const now  = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const se   = Math.ceil((now.getDate() + new Date(year, 0, 1).getDay()) / 7); // approximation

  if (dr.type === "current_year")  return { anoStart: year, anoEnd: year, startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  if (dr.type === "last_year")     return { anoStart: year - 1, anoEnd: year - 1, startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` };
  if (dr.type === "current_month") return { anoStart: year, anoEnd: year, startDate: `${year}-${String(month).padStart(2, "0")}-01`, endDate: now.toISOString().slice(0, 10) };
  if (dr.type === "last_month") {
    const first = new Date(year, month - 2, 1);
    const last = new Date(year, month - 1, 0);
    return {
      anoStart: first.getFullYear(),
      anoEnd: last.getFullYear(),
      startDate: first.toISOString().slice(0, 10),
      endDate: last.toISOString().slice(0, 10)
    };
  }
  if (dr.type === "relative_years" && dr.amount) {
    const startYear = year - dr.amount + 1;
    return { anoStart: startYear, anoEnd: year, startDate: `${startYear}-01-01`, endDate: `${year}-12-31` };
  }
  if (dr.type === "relative_months" && dr.amount) {
    const start = new Date(year, month - dr.amount, 1);
    return {
      anoStart: start.getFullYear(),
      anoEnd: year,
      startDate: start.toISOString().slice(0, 10),
      endDate: now.toISOString().slice(0, 10)
    };
  }
  if (dr.type === "relative_weeks" && dr.amount) {
    const seStart = Math.max(1, se - dr.amount);
    const start = new Date(now);
    start.setDate(start.getDate() - (dr.amount * 7));
    return { anoStart: start.getFullYear(), anoEnd: year, seStart, seEnd: se, startDate: start.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10) };
  }
  if (dr.type === "between" && dr.start) {
    const [ys] = (dr.start).split("-").map(Number);
    const [ye] = (dr.end ?? dr.start).split("-").map(Number);
    return { anoStart: ys || year, anoEnd: ye || year, startDate: dr.start, endDate: dr.end ?? dr.start };
  }
  return {}; // "all"
}

/** Mapeia dimensão do formato cevesp-analytics para o parâmetro do RPC */
function mapDimension(dim: string): string {
  const map: Record<string, string> = {
    gve: "gve", drs: "drs", municipio: "municipio", uvis: "uvis",
    semana_epidemiologica: "se", ano_cadastro: "ano", mes_cadastro: "mes",
    subgrupo_ve: "gve" // fallback
  };
  return map[dim] ?? "gve";
}

export async function runCevespAnalysisCached(
  question: string,
  analysis: CevespAnalysisInput
): Promise<{
  question: string;
  analysis: CevespAnalysisInput;
  metricLabel: string;
  timeLabel: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  interpretation: string[];
  fromCache: true;
  understanding?: {
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
}> {
  const supabase = createAdminClient();
  const dr       = resolveDateRange(analysis.date_range);

  const lowerQuestion = normalizeText(question);
  if (/\bpor\s+sexo\b|\bdistribuicao por sexo\b|\bsexo\b/.test(lowerQuestion) && !/masculino|feminino|homens?|mulheres?/.test(lowerQuestion)) {
    return runCachedSexDistribution(question, analysis);
  }
  if (/\bpor\s+faixa etaria\b|\bdistribuicao etaria\b|\bidade\b|\bcriancas?\b|\badultos?\b/.test(lowerQuestion) && !/menor|1\s*a\s*4|5\s*a\s*9|10\s*a\s*14|15/.test(lowerQuestion)) {
    return runCachedAgeDistribution(question, analysis);
  }
  if (analysis.metric === "total_casos" && analysis.time_grain === "month" && analysis.dimensions.includes("gve")) {
    return runCachedMonthlyCasesByGve(question, analysis);
  }

  // Primeiro filtro GVE/DRS dos filtros da análise
  const gveFilter = analysis.filters?.find(f => f.field === "gve")?.value;
  const drsFilter = analysis.filters?.find(f => f.field === "drs")?.value;
  const munFilter = analysis.filters?.find(f => f.field === "municipio")?.value;

  // Dimensão primária (usa a primeira dimensão selecionada, ou "gve" como padrão)
  const dimension = analysis.dimensions.length > 0
    ? mapDimension(analysis.dimensions[0])
    : (analysis.time_grain === "year" ? "ano"
      : analysis.time_grain === "week" ? "se"
      : "gve");

  const cacheRows = await fetchCacheRows({
    ...analysis,
    filters: [
      ...(analysis.filters ?? []),
      ...(gveFilter && !analysis.filters?.some((filter) => filter.field === "gve") ? [{ field: "gve", operator: "contains", value: gveFilter }] : []),
      ...(drsFilter && !analysis.filters?.some((filter) => filter.field === "drs") ? [{ field: "drs", operator: "contains", value: drsFilter }] : []),
      ...(munFilter && !analysis.filters?.some((filter) => filter.field === "municipio") ? [{ field: "municipio", operator: "contains", value: munFilter }] : [])
    ]
  }, '"ANO","Mes","SemEpidemio","DtNotificacao","TotalCaso","Surto","NuSurto","NuColetaMaterialBio","NuAcaoEducativa","NuTreinamento","AfastamentoProfSintomatico","NuEncamimento","MunicipioNotificacao","GVE_NOME","DRS_NOME","UVIS","Unid_notificacao","nCNES"');

  const rows = aggregateCacheRows(cacheRows, analysis.metric, dimension, Math.min(analysis.limit ?? 100, 500));

  // Diagnostic: if 0 rows, use a direct count to explain why
  if (rows.length === 0) {
    const [countAll, countFiltered] = await Promise.all([
      supabase.from("cevesp_notificacoes").select("id", { count: "exact", head: true }),
      dr.anoStart != null
        ? supabase.from("cevesp_notificacoes")
            .select("id", { count: "exact", head: true })
            .gte("ANO", dr.anoStart)
            .lte("ANO", dr.anoEnd ?? dr.anoStart)
        : Promise.resolve({ count: null, error: null })
    ]);
    const totalRows = countAll.count ?? 0;
    const filteredRows = countFiltered.count ?? 0;

    let diagMsg: string;
    if (totalRows === 0) {
      diagMsg = "A tabela cevesp_notificacoes está vazia. Execute a sincronização (Configurações → Sincronizar CEVESP).";
    } else if (dr.anoStart != null && filteredRows === 0) {
      const { data: anosData } = await supabase
        .from("cevesp_notificacoes")
        .select('"ANO"')
        .not("ANO", "is", null)
        .order("ANO", { ascending: false })
        .limit(5);
      const anos = [...new Set((anosData ?? []).map((r: Record<string, unknown>) => r["ANO"]))].join(", ") || "desconhecido";
      diagMsg = `O cache CEVESP tem ${totalRows} registros no total, mas nenhum com ANO=${dr.anoStart}. Anos disponíveis: ${anos}.`;
    } else {
      diagMsg = `O cache CEVESP tem ${totalRows} registros, mas nenhum passou pelos filtros desta consulta.`;
    }
    return {
      question,
      analysis,
      metricLabel: analysis.metric,
      timeLabel: `${dr.anoStart ?? "todos os anos"}`,
      columns: ["Diagnóstico"],
      rows: [],
      fromCache: true as const,
      understanding: buildCacheUnderstanding(analysis),
      interpretation: [diagMsg]
    };
  }

  const mappedRows = rows.map(r => ({
    [dimension === "gve" ? "GVE" : dimension === "municipio" ? "Município" : dimension.toUpperCase()]: r.label,
    Valor: r.valor
  }));

  const dimLabel = dimension === "gve" ? "GVE" : dimension === "municipio" ? "Município"
    : dimension === "drs" ? "DRS" : dimension === "se" ? "Semana Epidemiológica"
    : dimension === "ano" ? "Ano" : dimension;

  const metricLabels: Record<string, string> = {
    total_casos: "Total de casos", notificacoes: "Notificações", surtos: "Surtos",
    coletas: "Coletas biológicas", acoes_educativas: "Ações educativas",
    treinamentos: "Treinamentos", municipios_notificadores: "Municípios notificadores",
    unidades_notificadoras: "Unidades notificadoras"
  };

  const top3 = rows.slice(0, 3).map(r => `${r.label}: ${r.valor}`).join(", ");
  const total = rows.reduce((s, r) => s + Number(r.valor), 0);

  return {
    question,
    analysis,
    metricLabel: metricLabels[analysis.metric] ?? analysis.metric,
    timeLabel:   `${dr.anoStart ?? "todos os anos"}${dr.seStart ? ` SE ${dr.seStart}–${dr.seEnd}` : ""}`,
    columns:     [dimLabel, "Valor"],
    rows:        mappedRows,
    fromCache:   true,
    understanding: buildCacheUnderstanding(analysis),
    interpretation: [
      `Dados do cache Supabase (última sincronização da rede SES-SP).`,
      `Total de ${metricLabels[analysis.metric] ?? "registros"}: ${total.toLocaleString("pt-BR")}.`,
      `Destaque: ${top3}.`
    ]
  };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function metricValue(row: Record<string, unknown>, metric: string) {
  if (metric === "notificacoes") return 1;
  if (metric === "surtos") {
    const surto = String(row.Surto ?? "").toLowerCase();
    return ["1", "s", "sim", "true", "x"].includes(surto) || Number(row.NuSurto ?? 0) > 0 ? 1 : 0;
  }
  if (metric === "numero_surtos") return Number(row.NuSurto ?? 0);
  if (metric === "coletas") return Number(row.NuColetaMaterialBio ?? 0);
  if (metric === "acoes_educativas") return Number(row.NuAcaoEducativa ?? 0);
  if (metric === "treinamentos") return Number(row.NuTreinamento ?? 0);
  if (metric === "afastamentos") {
    const afastamento = String(row.AfastamentoProfSintomatico ?? "").toLowerCase();
    return ["1", "s", "sim", "true", "x"].includes(afastamento) ? 1 : 0;
  }
  if (metric === "encaminhamentos") return Number(row.NuEncamimento ?? 0);
  if (metric === "municipios_notificadores") return 1;
  if (metric === "unidades_notificadoras") return 1;
  return Number(row.TotalCaso ?? 0);
}

function dimensionValue(row: Record<string, unknown>, dimension: string) {
  if (dimension === "gve") return String(row.GVE_NOME ?? "Sem GVE");
  if (dimension === "drs") return String(row.DRS_NOME ?? "Sem DRS");
  if (dimension === "municipio") return String(row.MunicipioNotificacao ?? "Sem municipio");
  if (dimension === "uvis") return String(row.UVIS ?? "Sem UVIS");
  if (dimension === "se") return String(row.SemEpidemio ?? "0");
  if (dimension === "ano") return String(row.ANO ?? "0");
  if (dimension === "mes") return String(row.Mes ?? "0");
  if (dimension === "unidade") return String(row.Unid_notificacao ?? "Sem unidade");
  return String(row.GVE_NOME ?? "Sem GVE");
}

function aggregateCacheRows(rows: Array<Record<string, unknown>>, metric: string, dimension: string, limit: number) {
  if (metric === "municipios_notificadores") {
    const groups = new Map<string, Set<string>>();
    for (const row of rows) {
      const label = dimensionValue(row, dimension);
      if (!groups.has(label)) groups.set(label, new Set());
      const municipio = String(row.MunicipioNotificacao ?? "");
      if (municipio) groups.get(label)?.add(municipio);
    }
    return Array.from(groups.entries())
      .map(([label, values]) => ({ label, valor: values.size }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, limit);
  }
  if (metric === "unidades_notificadoras") {
    const groups = new Map<string, Set<string>>();
    for (const row of rows) {
      const label = dimensionValue(row, dimension);
      if (!groups.has(label)) groups.set(label, new Set());
      const unidade = String(row.Unid_notificacao ?? "");
      if (unidade) groups.get(label)?.add(unidade);
    }
    return Array.from(groups.entries())
      .map(([label, values]) => ({ label, valor: values.size }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, limit);
  }

  const groups = new Map<string, number>();
  for (const row of rows) {
    const label = dimensionValue(row, dimension);
    groups.set(label, (groups.get(label) ?? 0) + metricValue(row, metric));
  }
  return Array.from(groups.entries())
    .map(([label, valor]) => ({ label, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limit);
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

function buildMonthPivot(rows: Array<Record<string, unknown>>, years: string[]) {
  const output: Array<Record<string, unknown>> = [];

  for (let month = 1; month <= 12; month++) {
    const row: Record<string, unknown> = { Mes: monthName(month) };
    let total = 0;
    for (const year of years) {
      const value = rows
        .filter((item) => Number(item.Mes) === month && String(item.ANO) === year)
        .reduce((sum, item) => sum + Number(item.TotalCaso ?? 0), 0);
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

async function fetchCacheRows(analysis: CevespAnalysisInput, select: string) {
  const supabase = createAdminClient();
  const dr = resolveDateRange(analysis.date_range);
  const pageSize = 1000;
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase.from("cevesp_notificacoes").select(select);
    if (dr.anoStart != null) query = query.gte("ANO", dr.anoStart);
    if (dr.anoEnd != null) query = query.lte("ANO", dr.anoEnd);
    if (dr.startDate) query = query.gte("DtNotificacao", dr.startDate);
    if (dr.endDate) query = query.lte("DtNotificacao", dr.endDate);
    if (dr.seStart != null) query = query.gte("SemEpidemio", dr.seStart);
    if (dr.seEnd != null) query = query.lte("SemEpidemio", dr.seEnd);
    for (const filter of analysis.filters ?? []) {
      const value = filter.value;
      if (!value) continue;
      if (filter.field === "gve") query = query.ilike("GVE_NOME", `%${value}%`);
      if (filter.field === "drs") query = query.ilike("DRS_NOME", `%${value}%`);
      if (filter.field === "municipio") query = query.ilike("MunicipioNotificacao", `%${value}%`);
      if (filter.field === "uvis") query = query.ilike("UVIS", `%${value}%`);
      if (filter.field === "unidade") query = query.ilike("Unid_notificacao", `%${value}%`);
      if (filter.field === "cnes") query = query.ilike("nCNES", `%${value}%`);
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(`Cache CEVESP: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function runCachedMonthlyCasesByGve(question: string, analysis: CevespAnalysisInput) {
  const rows = await fetchCacheRows(analysis, '"ANO","Mes","GVE_NOME","TotalCaso"');
  const years = Array.from(new Set(rows.map((row) => Number(row.ANO)).filter(Number.isFinite))).sort((a, b) => a - b).map(String);
  const gves = Array.from(new Set(rows.map((row) => String(row.GVE_NOME ?? "Nao informado")))).sort();
  const columns = ["Mes", ...years, "Total"];
  const statewideRows = buildMonthPivot(rows, years);
  const gveSections = gves.map((gve) => ({
    gve,
    rows: buildMonthPivot(rows.filter((row) => String(row.GVE_NOME ?? "Nao informado") === gve), years)
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
    metricLabel: "Total de casos",
    timeLabel: "Relatorio mensal ano a ano",
    columns,
    rows: statewideRows,
    fromCache: true as const,
    understanding: buildCacheUnderstanding(analysis),
    monthlyReport: {
      title: "Relatorio mensal do total de casos por GVE",
      methodology: [
        "Fonte: cache Supabase importado do CEVESP.",
        "Indicador: soma do campo TotalCaso.",
        "Campo temporal: ANO e Mes do cache.",
        "Campo regional: GVE_NOME.",
        "Agregacao: mes nas linhas e anos nas colunas."
      ],
      statewideRows,
      gveSections,
      yearTotals,
      totalCases,
      topGves
    },
    interpretation: [
      `No periodo analisado foram encontrados ${totalCases} casos no cache importado.`,
      topGves[0] ? `O GVE com maior acumulado foi ${topGves[0].gve}, com ${topGves[0].total} casos.` : "Nao foi possivel identificar GVE predominante.",
      "A tabela apresenta meses nas linhas, anos nas colunas e total ao final para comparacao sazonal."
    ]
  };
}

async function runCachedSexDistribution(question: string, analysis: CevespAnalysisInput) {
  const rows = await fetchCacheRows(analysis, '"SexMasc","SexFem","TotalCaso","ANO","GVE_NOME","DRS_NOME","MunicipioNotificacao","UVIS","Unid_notificacao","nCNES"');
  const masculino = rows.reduce((sum, row) => sum + Number(row.SexMasc ?? 0), 0);
  const feminino = rows.reduce((sum, row) => sum + Number(row.SexFem ?? 0), 0);
  const total = rows.reduce((sum, row) => sum + Number(row.TotalCaso ?? 0), 0);
  const informado = masculino + feminino;
  const resultRows = [
    { Sexo: "Masculino", Valor: masculino },
    { Sexo: "Feminino", Valor: feminino },
    { Sexo: "Sem classificacao por sexo", Valor: Math.max(total - informado, 0) },
    { Sexo: "Total", Valor: total }
  ];

  return {
    question,
    analysis,
    metricLabel: "Distribuicao por sexo",
    timeLabel: buildCacheUnderstanding(analysis).period,
    columns: ["Sexo", "Valor"],
    rows: resultRows,
    fromCache: true as const,
    understanding: buildCacheUnderstanding(analysis),
    interpretation: [
      `Dados do cache Supabase CEVESP, com ${rows.length} notificacoes consideradas.`,
      `A distribuicao informada por sexo totaliza ${informado} casos: ${masculino} masculinos e ${feminino} femininos.`,
      total > informado ? `Ha ${total - informado} casos sem correspondencia direta na soma por sexo.` : "A soma por sexo corresponde ao total de casos."
    ]
  };
}

async function runCachedAgeDistribution(question: string, analysis: CevespAnalysisInput) {
  const rows = await fetchCacheRows(analysis, '"FxMenorUmAno","FxUmQuatro","FxCincoNove","FxDezQuatorze","FxQuizeOuMais","TotalCaso","ANO","GVE_NOME","DRS_NOME","MunicipioNotificacao","UVIS","Unid_notificacao","nCNES"');
  const ageRows = [
    { "Faixa etaria": "Menor de 1 ano", Valor: rows.reduce((sum, row) => sum + Number(row.FxMenorUmAno ?? 0), 0) },
    { "Faixa etaria": "1 a 4 anos", Valor: rows.reduce((sum, row) => sum + Number(row.FxUmQuatro ?? 0), 0) },
    { "Faixa etaria": "5 a 9 anos", Valor: rows.reduce((sum, row) => sum + Number(row.FxCincoNove ?? 0), 0) },
    { "Faixa etaria": "10 a 14 anos", Valor: rows.reduce((sum, row) => sum + Number(row.FxDezQuatorze ?? 0), 0) },
    { "Faixa etaria": "15 anos ou mais", Valor: rows.reduce((sum, row) => sum + Number(row.FxQuizeOuMais ?? 0), 0) }
  ];
  const total = rows.reduce((sum, row) => sum + Number(row.TotalCaso ?? 0), 0);
  const informado = ageRows.reduce((sum, row) => sum + row.Valor, 0);
  const peak = [...ageRows].sort((a, b) => b.Valor - a.Valor)[0];

  return {
    question,
    analysis,
    metricLabel: "Distribuicao por faixa etaria",
    timeLabel: buildCacheUnderstanding(analysis).period,
    columns: ["Faixa etaria", "Valor"],
    rows: [
      ...ageRows,
      { "Faixa etaria": "Sem classificacao etaria", Valor: Math.max(total - informado, 0) },
      { "Faixa etaria": "Total", Valor: total }
    ],
    fromCache: true as const,
    understanding: buildCacheUnderstanding(analysis),
    interpretation: [
      `Dados do cache Supabase CEVESP, com ${rows.length} notificacoes consideradas.`,
      peak ? `A faixa etaria com maior volume foi ${peak["Faixa etaria"]}, com ${peak.Valor} casos.` : "Nao foi possivel identificar faixa etaria predominante.",
      total > informado ? `Ha ${total - informado} casos sem correspondencia direta na soma das faixas etarias.` : "A soma das faixas etarias corresponde ao total de casos."
    ]
  };
}

function buildCacheUnderstanding(analysis: CevespAnalysisInput) {
  const metricLabels: Record<string, string> = {
    total_casos: "Total de casos",
    notificacoes: "Notificacoes",
    surtos: "Surtos",
    coletas: "Coletas biologicas",
    acoes_educativas: "Acoes educativas",
    treinamentos: "Treinamentos",
    municipios_notificadores: "Municipios notificadores",
    unidades_notificadoras: "Unidades notificadoras"
  };
  const dimensionLabels: Record<string, string> = {
    gve: "GVE",
    drs: "DRS",
    municipio: "Municipio",
    semana_epidemiologica: "Semana epidemiologica",
    ano_cadastro: "Ano informado",
    mes_cadastro: "Mes informado",
    uvis: "UVIS"
  };
  const period = resolveDateRange(analysis.date_range);
  const periodLabel = period.anoStart && period.anoEnd
    ? `${period.anoStart} a ${period.anoEnd}`
    : "todo o cache";
  return {
    metric: metricLabels[analysis.metric] ?? analysis.metric,
    period: periodLabel,
    temporalGrouping: analysis.time_grain,
    dimensions: analysis.dimensions.map((dimension) => dimensionLabels[dimension] ?? dimension),
    filters: (analysis.filters ?? []).map((filter) => `${dimensionLabels[filter.field] ?? filter.field} ${filter.operator} "${filter.value}"`),
    source: "Cache Supabase CEVESP",
    indicatorField: analysis.metric,
    dateField: "ANO/SemEpidemio no cache",
    confidence: "media" as const,
    warnings: ["Resultado obtido do cache Supabase; confira a data da ultima sincronizacao."]
  };
}

/** Verifica se há dados no cache e quando foi a última sincronização */
export async function getCacheSyncInfo(): Promise<{
  hasData: boolean;
  lastSync: string | null;
  totalRows: number;
  years: number[];
  minYear: number | null;
  maxYear: number | null;
  latestNotificationDate: string | null;
  totalCases: number;
  municipalities: number;
  gves: number;
}> {
  try {
    const supabase = createAdminClient();
    const [countRes, logRes] = await Promise.all([
      supabase.from("cevesp_notificacoes").select("id", { count: "exact", head: true }),
      supabase.from("cevesp_sync_log").select("synced_at").order("synced_at", { ascending: false }).limit(1)
    ]);
    const total = countRes.count ?? 0;
    const last  = (logRes.data?.[0] as { synced_at: string } | undefined)?.synced_at ?? null;
    const rows = await fetchCacheRows({ metric: "total_casos", dimensions: [], time_grain: "none", date_range: { type: "all" }, filters: [], limit: 500 }, '"ANO","DtNotificacao","TotalCaso","MunicipioNotificacao","GVE_NOME"');
    const years = Array.from(new Set(
      rows
        .map((row) => Number(row.ANO))
        .filter((year) => Number.isInteger(year) && year > 1900)
    )).sort((a, b) => a - b);
    const dates = rows
      .map((row) => String(row.DtNotificacao ?? ""))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    const totalCases = rows.reduce((sum, row) => sum + Number(row.TotalCaso ?? 0), 0);
    const municipalities = new Set(rows.map((row) => String(row.MunicipioNotificacao ?? "")).filter(Boolean)).size;
    const gves = new Set(rows.map((row) => String(row.GVE_NOME ?? "")).filter(Boolean)).size;

    return {
      hasData: total > 0,
      lastSync: last,
      totalRows: total,
      years,
      minYear: years[0] ?? null,
      maxYear: years[years.length - 1] ?? null,
      latestNotificationDate: dates[dates.length - 1] ?? null,
      totalCases,
      municipalities,
      gves
    };
  } catch {
    return {
      hasData: false,
      lastSync: null,
      totalRows: 0,
      years: [],
      minYear: null,
      maxYear: null,
      latestNotificationDate: null,
      totalCases: 0,
      municipalities: 0,
      gves: 0
    };
  }
}
