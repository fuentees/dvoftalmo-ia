/**
 * Fallback CEVESP: consulta o cache no Supabase quando o MySQL 192.168.1.204
 * está inacessível (ex: fora da rede SES-SP no Vercel).
 * As RPCs PostgreSQL espelham a lógica do cevesp-analytics.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { listarMunicipiosPorGve, listarMunicipiosSp } from "@/lib/municipios-sp";

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

  if (dr.type === "current_year")  return { anoStart: year, anoEnd: year };
  if (dr.type === "last_year")     return { anoStart: year - 1, anoEnd: year - 1 };
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
    return { anoStart: startYear, anoEnd: year };
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
    unidade: "unidade", cnes: "cnes",
    subgrupo_ve: "gve" // fallback
  };
  return map[dim] ?? "gve";
}

function dimensionLabel(dim: string): string {
  const labels: Record<string, string> = {
    gve: "GVE",
    drs: "DRS",
    municipio: "Municipio",
    uvis: "UVIS",
    unidade: "Unidade notificadora",
    cnes: "CNES",
    se: "Semana Epidemiologica",
    ano: "Ano",
    mes: "Mes"
  };
  return labels[dim] ?? dim;
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

  // Fast path: cevesp_agrupado RPC returns pre-aggregated rows (~240 rows for full history)
  // instead of the 300+ paginated requests that fetchCacheRows needs for 300k raw rows.
  if (["month", "year", "week"].includes(analysis.time_grain)) {
    const aggregated = await tryFetchAggregated(analysis);
    if (aggregated !== null && aggregated.length > 0) {
      const generic = buildPivotFromAggregated(aggregated, analysis);
      if (generic.rows.length > 0) {
        const metricLabels2: Record<string, string> = {
          total_casos: "Total de casos", notificacoes: "Notificacoes", surtos: "Surtos",
          numero_surtos: "Numero de surtos", coletas: "Coletas biologicas",
          acoes_educativas: "Acoes educativas", treinamentos: "Treinamentos",
          afastamentos: "Afastamentos", encaminhamentos: "Encaminhamentos",
          municipios_notificadores: "Municipios notificadores",
          unidades_notificadoras: "Unidades notificadoras"
        };
        const dataRows2 = generic.rows.filter((row) => !Object.values(row).some((v) => String(v).toLowerCase() === "total"));
        const totalRow2 = generic.rows.find((row) => Object.values(row).some((v) => String(v).toLowerCase() === "total"));
        const total2 = Number(totalRow2?.Total ?? dataRows2.reduce((sum, row) => sum + Number(row.Total ?? row.Valor ?? 0), 0));
        const labelCols2 = generic.columns.filter((c) => !["Valor", "Total"].includes(c) && !/^\d{4}$/.test(c));
        const top3b = dataRows2.slice(0, 3)
          .map((row) => `${labelCols2.map((c) => row[c]).filter(Boolean).join(" / ") || "Total"}: ${row.Total ?? row.Valor ?? 0}`)
          .join(", ");
        return {
          question,
          analysis,
          metricLabel: metricLabels2[analysis.metric] ?? analysis.metric,
          timeLabel: buildCacheUnderstanding(analysis).period,
          columns: generic.columns,
          rows: generic.rows,
          fromCache: true as const,
          understanding: buildCacheUnderstanding(analysis),
          interpretation: [
            "Dados do cache Supabase importado do CEVESP.",
            `Total de ${metricLabels2[analysis.metric] ?? "registros"}: ${total2.toLocaleString("pt-BR")}.`,
            top3b ? `Destaques: ${top3b}.` : "Nao houve destaque numerico para os criterios informados.",
            "A tabela foi estruturada conforme a pergunta: dimensoes nas linhas, periodo nas colunas quando aplicavel, e total consolidado ao final."
          ]
        };
      }
    }
  }

  {
    const cacheRows = await fetchCacheRows(
      analysis,
      '"ANO","Mes","SemEpidemio","DtNotificacao","TotalCaso","Surto","NuSurto","NuColetaMaterialBio","NuAcaoEducativa","NuTreinamento","AfastamentoProfSintomatico","NuEncamimento","MunicipioNotificacao","GVE_NOME","DRS_NOME","UVIS","Unid_notificacao","nCNES"'
    );
    const generic = buildCachedGenericResult(cacheRows, analysis);

    if (generic.rows.length > 0) {
      const metricLabels: Record<string, string> = {
        total_casos: "Total de casos", notificacoes: "Notificacoes", surtos: "Surtos",
        numero_surtos: "Numero de surtos", coletas: "Coletas biologicas",
        acoes_educativas: "Acoes educativas", treinamentos: "Treinamentos",
        afastamentos: "Afastamentos", encaminhamentos: "Encaminhamentos",
        municipios_notificadores: "Municipios notificadores",
        unidades_notificadoras: "Unidades notificadoras"
      };
      const dataRows = generic.rows.filter((row) => !Object.values(row).some((value) => String(value).toLowerCase() === "total"));
      const totalRow = generic.rows.find((row) => Object.values(row).some((value) => String(value).toLowerCase() === "total"));
      const total = Number(totalRow?.Total ?? dataRows.reduce((sum, row) => sum + Number(row.Total ?? row.Valor ?? row.valor ?? 0), 0));
      const labelColumns = generic.columns.filter((column) => !["Valor", "Total"].includes(column) && !/^\d{4}$/.test(column));
      const top3 = dataRows.slice(0, 3)
        .map((row) => `${labelColumns.map((column) => row[column]).filter(Boolean).join(" / ") || "Total"}: ${row.Total ?? row.Valor ?? row.valor ?? 0}`)
        .join(", ");

      return {
        question,
        analysis,
        metricLabel: metricLabels[analysis.metric] ?? analysis.metric,
        timeLabel: buildCacheUnderstanding(analysis).period,
        columns: generic.columns,
        rows: generic.rows,
        fromCache: true as const,
        understanding: buildCacheUnderstanding(analysis),
        interpretation: [
          "Dados do cache Supabase importado do CEVESP.",
          `Total de ${metricLabels[analysis.metric] ?? "registros"}: ${total.toLocaleString("pt-BR")}.`,
          top3 ? `Destaques: ${top3}.` : "Nao houve destaque numerico para os criterios informados.",
          "A tabela foi estruturada conforme a pergunta: dimensoes nas linhas, periodo nas colunas quando aplicavel, e total consolidado ao final."
        ]
      };
    }
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

// ── Aggregation RPC fast path ────────────────────────────────────────────────
// cevesp_agrupado returns pre-grouped (ano, mes, se, dim_value, total) rows.
// Replaces the 300-request pagination loop for month/year/week pivots.

type AggRow = { ano: number; mes: number | null; se: number | null; dim_value: string | null; total: number };

async function tryFetchAggregated(analysis: CevespAnalysisInput): Promise<AggRow[] | null> {
  const grain = analysis.time_grain;
  if (!["month", "year", "week"].includes(grain)) return null;

  const dr = resolveDateRange(analysis.date_range);
  const dims = (analysis.dimensions.length > 0 ? analysis.dimensions.map(mapDimension) : [])
    .filter((v, i, a) => a.indexOf(v) === i);
  const extraDims = dims.filter((d) => !["mes", "ano", "se"].includes(d));
  const rpcMappable = ["gve", "drs", "municipio", "uvis"];
  if (extraDims.some((d) => !rpcMappable.includes(d))) return null;

  const p_dim = extraDims.length > 0 ? extraDims[0] : null;
  const gveFilter = analysis.filters?.find((f) => f.field === "gve")?.value ?? null;
  const munFilter = analysis.filters?.find((f) => f.field === "municipio")?.value ?? null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("cevesp_agrupado", {
      p_grain: grain,
      p_metric: analysis.metric,
      p_dim,
      p_ano_start: dr.anoStart ?? null,
      p_ano_end: dr.anoEnd ?? null,
      p_gve: gveFilter ?? null,
      p_municipio: munFilter ?? null,
      p_se_start: dr.seStart ?? null,
      p_se_end: dr.seEnd ?? null
    }).limit(10000);
    if (error || !data) return null;
    return data as AggRow[];
  } catch {
    return null;
  }
}

function buildPivotFromAggregated(agg: AggRow[], analysis: CevespAnalysisInput): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const limit = Math.min(analysis.limit ?? 100, 500);
  const grain = analysis.time_grain;
  const hasDim = agg.some((r) => r.dim_value !== null);
  const dimLabel0 = analysis.dimensions[0] ? dimensionLabel(mapDimension(analysis.dimensions[0])) : "Dimensao";

  if (grain === "month") {
    const years = Array.from(new Set(agg.map((r) => String(r.ano)))).sort();
    const groups = new Map<string, Record<string, unknown>>();

    for (const row of agg) {
      const m = row.mes;
      if (!m || m < 1 || m > 12) continue;
      const key = [m, row.dim_value ?? ""].join("||");
      if (!groups.has(key)) {
        const base: Record<string, unknown> = { Mes: monthName(m) };
        if (hasDim) base[dimLabel0] = row.dim_value ?? "";
        for (const y of years) base[y] = 0;
        base.Total = 0;
        groups.set(key, base);
      }
      const cur = groups.get(key)!;
      cur[String(row.ano)] = Number(cur[String(row.ano)] ?? 0) + Number(row.total);
      cur.Total = Number(cur.Total ?? 0) + Number(row.total);
    }

    const dataRows = Array.from(groups.entries())
      .sort(([a], [b]) => Number(a.split("||")[0]) - Number(b.split("||")[0]))
      .map(([, v]) => v)
      .slice(0, limit);

    const totalRow: Record<string, unknown> = { Mes: "Total" };
    if (hasDim) totalRow[dimLabel0] = "Todos";
    for (const y of years) totalRow[y] = dataRows.reduce((s, r) => s + Number(r[y] ?? 0), 0);
    totalRow.Total = dataRows.reduce((s, r) => s + Number(r.Total ?? 0), 0);

    const cols = ["Mes", ...(hasDim ? [dimLabel0] : []), ...years, "Total"];
    return { columns: cols, rows: [...dataRows, totalRow] };
  }

  if (grain === "year") {
    const years = Array.from(new Set(agg.map((r) => String(r.ano)))).sort();
    if (hasDim) {
      const groups = new Map<string, Record<string, unknown>>();
      for (const row of agg) {
        const key = row.dim_value ?? "Nao informado";
        if (!groups.has(key)) {
          const base: Record<string, unknown> = { [dimLabel0]: key };
          for (const y of years) base[y] = 0;
          base.Total = 0;
          groups.set(key, base);
        }
        const cur = groups.get(key)!;
        cur[String(row.ano)] = Number(cur[String(row.ano)] ?? 0) + Number(row.total);
        cur.Total = Number(cur.Total ?? 0) + Number(row.total);
      }
      const dataRows = Array.from(groups.values()).sort((a, b) => Number(b.Total) - Number(a.Total)).slice(0, limit);
      const totalRow: Record<string, unknown> = { [dimLabel0]: "Total" };
      for (const y of years) totalRow[y] = dataRows.reduce((s, r) => s + Number(r[y] ?? 0), 0);
      totalRow.Total = dataRows.reduce((s, r) => s + Number(r.Total ?? 0), 0);
      return { columns: [dimLabel0, ...years, "Total"], rows: [...dataRows, totalRow] };
    }
    const mappedRows = agg.map((r) => ({ Ano: String(r.ano), Valor: r.total }));
    const total = agg.reduce((s, r) => s + Number(r.total), 0);
    return { columns: ["Ano", "Valor"], rows: [...mappedRows, { Ano: "Total", Valor: total }] };
  }

  if (grain === "week") {
    const years = Array.from(new Set(agg.map((r) => String(r.ano)))).sort();
    const groups = new Map<number, Record<string, unknown>>();
    for (const row of agg) {
      const se = row.se;
      if (!se || se < 1 || se > 53) continue;
      if (!groups.has(se)) {
        const base: Record<string, unknown> = { "Semana Epidemiologica": se };
        for (const y of years) base[y] = 0;
        base.Total = 0;
        groups.set(se, base);
      }
      const cur = groups.get(se)!;
      cur[String(row.ano)] = Number(cur[String(row.ano)] ?? 0) + Number(row.total);
      cur.Total = Number(cur.Total ?? 0) + Number(row.total);
    }
    const dataRows = Array.from(groups.entries()).sort(([a], [b]) => a - b).map(([, v]) => v).slice(0, limit);
    const totalRow: Record<string, unknown> = { "Semana Epidemiologica": "Total" };
    for (const y of years) totalRow[y] = dataRows.reduce((s, r) => s + Number(r[y] ?? 0), 0);
    totalRow.Total = dataRows.reduce((s, r) => s + Number(r.Total ?? 0), 0);
    return { columns: ["Semana Epidemiologica", ...years, "Total"], rows: [...dataRows, totalRow] };
  }

  return { columns: [], rows: [] };
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
  if (dimension === "se") {
    const se = Number(row.SemEpidemio ?? 0);
    return Number.isInteger(se) && se > 0 ? String(se) : "Nao informado";
  }
  if (dimension === "ano") {
    const ano = Number(row.ANO ?? 0);
    return Number.isInteger(ano) && ano > 1900 ? String(ano) : "Nao informado";
  }
  if (dimension === "mes") {
    const m = Number(row.Mes ?? 0);
    return Number.isInteger(m) && m >= 1 && m <= 12 ? monthName(m) : "Nao informado";
  }
  if (dimension === "dia") return String(row.DtNotificacao ?? "Sem data").split("T")[0];
  if (dimension === "unidade") return String(row.Unid_notificacao ?? "Sem unidade");
  if (dimension === "cnes") return String(row.nCNES ?? "Sem CNES");
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

function buildCachedGenericResult(rows: Array<Record<string, unknown>>, analysis: CevespAnalysisInput) {
  const dimensions = (analysis.dimensions.length > 0 ? analysis.dimensions.map(mapDimension) : [])
    .filter((value, index, array) => array.indexOf(value) === index);
  const limit = Math.min(analysis.limit ?? 100, 500);

  if (analysis.time_grain === "year" && dimensions.length > 0) {
    const years = Array.from(new Set(rows.map((row) => Number(row.ANO)).filter((year) => Number.isInteger(year) && year > 1900).map(String))).sort();
    const groups = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const year = Number(row.ANO);
      if (!Number.isInteger(year) || year <= 1900) continue;
      const keyValues = dimensions.map((dimension) => dimensionValue(row, dimension));
      if (keyValues.includes("Nao informado")) continue;
      const key = keyValues.join("||");
      if (!groups.has(key)) {
        const base: Record<string, unknown> = {};
        dimensions.forEach((dimension, index) => { base[dimensionLabel(dimension)] = keyValues[index]; });
        for (const year of years) base[year] = 0;
        base.Total = 0;
        groups.set(key, base);
      }
      const current = groups.get(key)!;
      current[String(year)] = Number(current[String(year)] ?? 0) + metricValue(row, analysis.metric);
      current.Total = Number(current.Total ?? 0) + metricValue(row, analysis.metric);
    }
    const dataRows = Array.from(groups.values()).sort((a, b) => Number(b.Total ?? 0) - Number(a.Total ?? 0)).slice(0, limit);
    const totalRow: Record<string, unknown> = {};
    for (const dimension of dimensions) totalRow[dimensionLabel(dimension)] = "Total";
    for (const year of years) totalRow[year] = dataRows.reduce((sum, row) => sum + Number(row[year] ?? 0), 0);
    totalRow.Total = dataRows.reduce((sum, row) => sum + Number(row.Total ?? 0), 0);
    return { columns: [...dimensions.map(dimensionLabel), ...years, "Total"], rows: [...dataRows, totalRow] };
  }

  if (analysis.time_grain === "month") {
    const years = Array.from(new Set(rows.map((row) => Number(row.ANO)).filter((year) => Number.isInteger(year) && year > 1900).map(String))).sort();
    // "mes" and "ano" are already the row/column axes of the month pivot — exclude them from
    // extra dimensions to prevent a duplicate "Mes" column and avoid overwriting monthName()
    // with a numeric string in the total row (which would bypass the isTotal chart filter).
    const extraDimensions = dimensions.filter((d) => d !== "mes" && d !== "ano");
    const groups = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const month = Number(row.Mes);
      const year = Number(row.ANO);
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year <= 1900) continue;
      const keyValues = extraDimensions.map((dimension) => dimensionValue(row, dimension));
      const key = [month, ...keyValues].join("||");
      if (!groups.has(key)) {
        const base: Record<string, unknown> = { Mes: monthName(month) };
        extraDimensions.forEach((dimension, index) => { base[dimensionLabel(dimension)] = keyValues[index]; });
        for (const year of years) base[year] = 0;
        base.Total = 0;
        groups.set(key, base);
      }
      const current = groups.get(key)!;
      current[String(year)] = Number(current[String(year)] ?? 0) + metricValue(row, analysis.metric);
      current.Total = Number(current.Total ?? 0) + metricValue(row, analysis.metric);
    }
    const dataRows = Array.from(groups.entries())
      .sort(([keyA, rowA], [keyB, rowB]) => Number(keyA.split("||")[0]) - Number(keyB.split("||")[0]) || Number(rowB.Total ?? 0) - Number(rowA.Total ?? 0))
      .map(([, value]) => value)
      .slice(0, limit);
    const totalRow: Record<string, unknown> = { Mes: "Total" };
    for (const dimension of extraDimensions) totalRow[dimensionLabel(dimension)] = "Todos";
    for (const year of years) totalRow[year] = dataRows.reduce((sum, row) => sum + Number(row[year] ?? 0), 0);
    totalRow.Total = dataRows.reduce((sum, row) => sum + Number(row.Total ?? 0), 0);
    return { columns: ["Mes", ...extraDimensions.map(dimensionLabel), ...years, "Total"], rows: [...dataRows, totalRow] };
  }

  const primaryDimension = dimensions[0] ?? (
    analysis.time_grain === "week" ? "se" :
    analysis.time_grain === "year" ? "ano" :
    analysis.time_grain === "day" ? "dia" :
    "gve"
  );
  const aggregated = aggregateCacheRows(rows, analysis.metric, primaryDimension, limit);
  const label = dimensionLabel(primaryDimension);
  const mappedRows = aggregated.map((row) => ({ [label]: row.label, Valor: row.valor }));
  const total = mappedRows.reduce((sum, row) => sum + Number(row.Valor ?? 0), 0);
  return { columns: [label, "Valor"], rows: [...mappedRows, { [label]: "Total", Valor: total }] };
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
    query = query.or('Excluido.is.null,Excluido.eq.0');
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
  // Fast path: use cevesp_agrupado to avoid fetching 300k raw rows
  let rawRows: Array<Record<string, unknown>> | null = null;
  const aggRows = await tryFetchAggregated({ ...analysis, dimensions: ["mes_cadastro", "ano_cadastro"] });

  if (aggRows !== null) {
    // aggRows has no dim (gve was not passed as p_dim here — fetch gve separately)
    // We need per-gve breakdown: call again with p_dim=gve
    const aggRowsGve = await tryFetchAggregated({ ...analysis, dimensions: ["mes_cadastro", "ano_cadastro", "gve"] });
    if (aggRowsGve !== null) {
      const years = Array.from(new Set(aggRows.map((r) => String(r.ano)))).sort();
      // Statewide: aggregate aggRows (no gve dim)
      const statewideRows = buildMonthPivotFromAgg(aggRows, years);
      // Per-GVE: pivot from aggRowsGve grouped by dim_value
      const gveNames = Array.from(new Set(aggRowsGve.map((r) => r.dim_value ?? "Nao informado"))).sort();
      const gveSections = gveNames.map((gve) => ({
        gve,
        rows: buildMonthPivotFromAgg(aggRowsGve.filter((r) => (r.dim_value ?? "Nao informado") === gve), years)
      }));
      return finishMonthlyCasesByGve(question, analysis, statewideRows, gveSections, years);
    }
  }

  // Fallback: raw row pagination
  rawRows = await fetchCacheRows(analysis, '"ANO","Mes","GVE_NOME","TotalCaso"');
  const years = Array.from(new Set(rawRows.map((row) => Number(row.ANO)).filter(Number.isFinite))).sort((a, b) => a - b).map(String);
  const gves = Array.from(new Set(rawRows.map((row) => String(row.GVE_NOME ?? "Nao informado")))).sort();
  const statewideRows = buildMonthPivot(rawRows, years);
  const gveSections = gves.map((gve) => ({
    gve,
    rows: buildMonthPivot(rawRows!.filter((row) => String(row.GVE_NOME ?? "Nao informado") === gve), years)
  }));
  return finishMonthlyCasesByGve(question, analysis, statewideRows, gveSections, years);
}

function buildMonthPivotFromAgg(agg: AggRow[], years: string[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  for (let month = 1; month <= 12; month++) {
    const row: Record<string, unknown> = { Mes: monthName(month) };
    let total = 0;
    for (const year of years) {
      const value = agg.filter((r) => r.mes === month && String(r.ano) === year).reduce((s, r) => s + Number(r.total), 0);
      row[year] = value;
      total += value;
    }
    row.Total = total;
    output.push(row);
  }
  const totalRow: Record<string, unknown> = { Mes: "Total" };
  let grand = 0;
  for (const year of years) {
    const v = output.reduce((s, r) => s + Number(r[year] ?? 0), 0);
    totalRow[year] = v;
    grand += v;
  }
  totalRow.Total = grand;
  output.push(totalRow);
  return output;
}

function finishMonthlyCasesByGve(
  question: string,
  analysis: CevespAnalysisInput,
  statewideRows: Array<Record<string, unknown>>,
  gveSections: Array<{ gve: string; rows: Array<Record<string, unknown>> }>,
  years: string[]
) {
  const columns = ["Mes", ...years, "Total"];
  const yearTotals = years.map((year) => ({ year, total: statewideRows.find((r) => r.Mes === "Total")?.[year] ?? 0 }));
  const totalCases = Number(statewideRows.find((r) => r.Mes === "Total")?.Total ?? 0);
  const topGves = gveSections
    .map((s) => ({ gve: s.gve, total: Number(s.rows.find((r) => r.Mes === "Total")?.Total ?? 0) }))
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
  const dr = resolveDateRange(analysis.date_range);
  const gveFilter = analysis.filters?.find((f) => f.field === "gve")?.value ?? null;
  const munFilter = analysis.filters?.find((f) => f.field === "municipio")?.value ?? null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("cevesp_relatorio", {
      p_ano: dr.anoStart ?? null, p_ano_fim: dr.anoEnd ?? null,
      p_gve: gveFilter, p_municipio: munFilter,
      p_se_inicio: dr.seStart ?? null, p_se_fim: dr.seEnd ?? null
    });
    if (!error && data) {
      const rpc = data as { sex_masc: number; sex_fem: number; total_cases: number };
      const masculino = Number(rpc.sex_masc ?? 0);
      const feminino  = Number(rpc.sex_fem  ?? 0);
      const total     = Number(rpc.total_cases ?? 0);
      const informado = masculino + feminino;
      return {
        question, analysis, metricLabel: "Distribuicao por sexo",
        timeLabel: buildCacheUnderstanding(analysis).period,
        columns: ["Sexo", "Valor"],
        rows: [
          { Sexo: "Masculino", Valor: masculino },
          { Sexo: "Feminino",  Valor: feminino  },
          { Sexo: "Sem classificacao por sexo", Valor: Math.max(total - informado, 0) },
          { Sexo: "Total", Valor: total }
        ],
        fromCache: true as const,
        understanding: buildCacheUnderstanding(analysis),
        interpretation: [
          `Dados do cache Supabase CEVESP (agregado via RPC).`,
          `Distribuicao informada por sexo: ${masculino} masculinos e ${feminino} femininos (total informado: ${informado}).`,
          total > informado ? `Ha ${total - informado} casos sem correspondencia direta na soma por sexo.` : "A soma por sexo corresponde ao total de casos."
        ]
      };
    }
  } catch { /* fallback */ }

  // Fallback lento: só usado se o RPC cevesp_relatorio não existir
  const rows = await fetchCacheRows(analysis, '"SexMasc","SexFem","TotalCaso","ANO","GVE_NOME","DRS_NOME","MunicipioNotificacao","UVIS","Unid_notificacao","nCNES"');
  const masculino = rows.reduce((sum, row) => sum + Number(row.SexMasc ?? 0), 0);
  const feminino  = rows.reduce((sum, row) => sum + Number(row.SexFem  ?? 0), 0);
  const total     = rows.reduce((sum, row) => sum + Number(row.TotalCaso ?? 0), 0);
  const informado = masculino + feminino;
  return {
    question, analysis, metricLabel: "Distribuicao por sexo",
    timeLabel: buildCacheUnderstanding(analysis).period,
    columns: ["Sexo", "Valor"],
    rows: [
      { Sexo: "Masculino", Valor: masculino },
      { Sexo: "Feminino",  Valor: feminino  },
      { Sexo: "Sem classificacao por sexo", Valor: Math.max(total - informado, 0) },
      { Sexo: "Total", Valor: total }
    ],
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
  const dr = resolveDateRange(analysis.date_range);
  const gveFilter = analysis.filters?.find((f) => f.field === "gve")?.value ?? null;
  const munFilter = analysis.filters?.find((f) => f.field === "municipio")?.value ?? null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("cevesp_relatorio", {
      p_ano: dr.anoStart ?? null, p_ano_fim: dr.anoEnd ?? null,
      p_gve: gveFilter, p_municipio: munFilter,
      p_se_inicio: dr.seStart ?? null, p_se_fim: dr.seEnd ?? null
    });
    if (!error && data) {
      const rpc = data as { fx_menor_um: number; fx_1_4: number; fx_5_9: number; fx_10_14: number; fx_15_mais: number; total_cases: number };
      const ageRows = [
        { "Faixa etaria": "Menor de 1 ano",    Valor: Number(rpc.fx_menor_um ?? 0) },
        { "Faixa etaria": "1 a 4 anos",         Valor: Number(rpc.fx_1_4     ?? 0) },
        { "Faixa etaria": "5 a 9 anos",         Valor: Number(rpc.fx_5_9     ?? 0) },
        { "Faixa etaria": "10 a 14 anos",       Valor: Number(rpc.fx_10_14   ?? 0) },
        { "Faixa etaria": "15 anos ou mais",    Valor: Number(rpc.fx_15_mais ?? 0) }
      ];
      const total    = Number(rpc.total_cases ?? 0);
      const informado = ageRows.reduce((s, r) => s + r.Valor, 0);
      const peak = [...ageRows].sort((a, b) => b.Valor - a.Valor)[0];
      return {
        question, analysis, metricLabel: "Distribuicao por faixa etaria",
        timeLabel: buildCacheUnderstanding(analysis).period,
        columns: ["Faixa etaria", "Valor"],
        rows: [...ageRows, { "Faixa etaria": "Sem classificacao etaria", Valor: Math.max(total - informado, 0) }, { "Faixa etaria": "Total", Valor: total }],
        fromCache: true as const,
        understanding: buildCacheUnderstanding(analysis),
        interpretation: [
          `Dados do cache Supabase CEVESP (agregado via RPC).`,
          peak ? `A faixa etaria com maior volume foi ${peak["Faixa etaria"]}, com ${peak.Valor} casos.` : "Nao foi possivel identificar faixa etaria predominante.",
          total > informado ? `Ha ${total - informado} casos sem correspondencia direta na soma das faixas etarias.` : "A soma das faixas etarias corresponde ao total de casos."
        ]
      };
    }
  } catch { /* fallback */ }

  // Fallback lento
  const rows = await fetchCacheRows(analysis, '"FxMenorUmAno","FxUmQuatro","FxCincoNove","FxDezQuatorze","FxQuizeOuMais","TotalCaso","ANO","GVE_NOME","DRS_NOME","MunicipioNotificacao","UVIS","Unid_notificacao","nCNES"');
  const ageRows = [
    { "Faixa etaria": "Menor de 1 ano",  Valor: rows.reduce((sum, row) => sum + Number(row.FxMenorUmAno  ?? 0), 0) },
    { "Faixa etaria": "1 a 4 anos",       Valor: rows.reduce((sum, row) => sum + Number(row.FxUmQuatro    ?? 0), 0) },
    { "Faixa etaria": "5 a 9 anos",       Valor: rows.reduce((sum, row) => sum + Number(row.FxCincoNove   ?? 0), 0) },
    { "Faixa etaria": "10 a 14 anos",     Valor: rows.reduce((sum, row) => sum + Number(row.FxDezQuatorze ?? 0), 0) },
    { "Faixa etaria": "15 anos ou mais",  Valor: rows.reduce((sum, row) => sum + Number(row.FxQuizeOuMais ?? 0), 0) }
  ];
  const total    = rows.reduce((sum, row) => sum + Number(row.TotalCaso ?? 0), 0);
  const informado = ageRows.reduce((sum, row) => sum + row.Valor, 0);
  const peak = [...ageRows].sort((a, b) => b.Valor - a.Valor)[0];
  return {
    question, analysis, metricLabel: "Distribuicao por faixa etaria",
    timeLabel: buildCacheUnderstanding(analysis).period,
    columns: ["Faixa etaria", "Valor"],
    rows: [...ageRows, { "Faixa etaria": "Sem classificacao etaria", Valor: Math.max(total - informado, 0) }, { "Faixa etaria": "Total", Valor: total }],
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

// ── Histórico agregado para dashboard de gráficos ────────────────────────────

export type CevespHistorico = {
  byYear: Array<{ ano: number; casos: number; municipiosNotificadores: number; incidencia100k: number | null }>;
  byGveYear: Array<{ gve: string; ano: number; casos: number }>;
  byYearMonth: Array<{ ano: number; mes: number; casos: number }>;
  totalCasos: number;
  anosComDados: number[];
};

export async function getCevespHistorico(opts?: {
  gve?: string;
  municipio?: string;
  yearStart?: number;
  yearEnd?: number;
}): Promise<CevespHistorico> {
  const analysis: CevespAnalysisInput = {
    metric: "total_casos",
    dimensions: [],
    time_grain: "year",
    date_range: opts?.yearStart || opts?.yearEnd
      ? { type: "between", start: `${opts!.yearStart ?? 2000}-01-01`, end: `${opts!.yearEnd ?? new Date().getFullYear()}-12-31` }
      : { type: "all" },
    filters: [
      ...(opts?.gve ? [{ field: "gve", operator: "contains" as const, value: opts.gve }] : []),
      ...(opts?.municipio ? [{ field: "municipio", operator: "contains" as const, value: opts.municipio }] : []),
    ],
    limit: 500,
  };

  const yearMap = new Map<number, number>();
  const municipiosMap = new Map<number, number>();
  const gveYearMap = new Map<string, Map<number, number>>();
  const yearMonthMap = new Map<string, number>();

  // Fast path: cevesp_agrupado returns ~4k rows (anos × meses × GVEs) vs 300k raw rows
  let usedRpc = false;
  try {
    const supabase = createAdminClient();
    const [casosResult, munResult] = await Promise.all([
      supabase.rpc("cevesp_agrupado", {
        p_grain: "month", p_metric: "total_casos", p_dim: null,
        p_ano_start: opts?.yearStart ?? null, p_ano_end: opts?.yearEnd ?? null,
        p_gve: opts?.gve ?? null, p_municipio: opts?.municipio ?? null,
        p_se_start: null, p_se_end: null
      }),
      supabase.rpc("cevesp_aggregate", {
        p_metric: "municipios_notificadores", p_dimension: "ano",
        p_ano_start: opts?.yearStart ?? null, p_ano_end: opts?.yearEnd ?? null,
        p_gve: opts?.gve ?? null, p_drs: null, p_municipio: opts?.municipio ?? null,
        p_se_start: null, p_se_end: null, p_lim: 50
      }),
    ]);
    const { data, error } = casosResult;
    if (!error && data && Array.isArray(data) && data.length > 0) {
      usedRpc = true;
      for (const r of data as AggRow[]) {
        const ano = r.ano;
        const mes = r.mes ?? 0;
        const casos = Number(r.total);
        const gve = r.dim_value ?? "Nao informado";
        if (!Number.isFinite(ano) || ano < 2000) continue;
        yearMap.set(ano, (yearMap.get(ano) ?? 0) + casos);
        if (!gveYearMap.has(gve)) gveYearMap.set(gve, new Map());
        gveYearMap.get(gve)!.set(ano, (gveYearMap.get(gve)!.get(ano) ?? 0) + casos);
        if (mes >= 1 && mes <= 12) {
          const key = `${ano}-${mes}`;
          yearMonthMap.set(key, (yearMonthMap.get(key) ?? 0) + casos);
        }
      }
    }
    // cevesp_aggregate returns { label: year_as_text, valor: count }
    if (!munResult.error && munResult.data && Array.isArray(munResult.data)) {
      for (const r of munResult.data as Array<{ label: string; valor: number }>) {
        const ano = Number(r.label);
        if (!Number.isFinite(ano) || ano < 2000) continue;
        municipiosMap.set(ano, Number(r.valor));
      }
    }
  } catch { /* fallback */ }

  if (!usedRpc) {
    const rows = await fetchCacheRows(analysis, '"ANO","Mes","GVE_NOME","TotalCaso","MunicipioNotificacao"');
    const municByYear = new Map<number, Set<string>>();
    for (const row of rows) {
      const ano = Number(row.ANO);
      const mes = Number(row.Mes ?? 0);
      const casos = Number(row.TotalCaso ?? 0);
      const gve = String(row.GVE_NOME ?? "Nao informado");
      if (!Number.isFinite(ano) || ano < 2000) continue;
      yearMap.set(ano, (yearMap.get(ano) ?? 0) + casos);
      if (!gveYearMap.has(gve)) gveYearMap.set(gve, new Map());
      gveYearMap.get(gve)!.set(ano, (gveYearMap.get(gve)!.get(ano) ?? 0) + casos);
      const municipio = String(row.MunicipioNotificacao ?? "").trim().toLowerCase();
      if (municipio) {
        if (!municByYear.has(ano)) municByYear.set(ano, new Set());
        municByYear.get(ano)!.add(municipio);
      }
      if (mes > 0 && mes <= 12) {
        const key = `${ano}-${mes}`;
        yearMonthMap.set(key, (yearMonthMap.get(key) ?? 0) + casos);
      }
    }
    for (const [ano, set] of municByYear) {
      municipiosMap.set(ano, set.size);
    }
  }

  // Fetch population for the relevant territory.
  // ibge_municipio_populacao armazena código de 7 dígitos (SIDRA = 6 dígitos + dígito verificador),
  // enquanto MUNICIPIOS_SP usa 6 dígitos — por isso filtramos client-side normalizando para 6 dígitos.
  const popByYear = new Map<number, number>();
  try {
    const supabase = createAdminClient();
    const { data: popRows } = await supabase
      .from("ibge_municipio_populacao")
      .select("ano, populacao, codigo_ibge")
      .eq("uf", "SP");

    // Build set of 6-digit IBGE codes for the territory (null = all SP)
    let territoryCodes: Set<string> | null = null;
    if (opts?.gve) {
      territoryCodes = new Set(listarMunicipiosPorGve(opts.gve).map((m) => m.codigo));
    } else if (opts?.municipio) {
      const needle = opts.municipio.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const matches = listarMunicipiosSp().filter((m) =>
        m.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(needle)
      );
      territoryCodes = new Set(matches.map((m) => m.codigo));
    }

    if (popRows) {
      for (const r of popRows as Array<{ ano: number; populacao: number; codigo_ibge: string }>) {
        // Normaliza para 6 dígitos independente do formato armazenado
        const code6 = String(r.codigo_ibge ?? "").replace(/\D/g, "").slice(0, 6);
        if (territoryCodes && !territoryCodes.has(code6)) continue;
        const yr = Number(r.ano);
        popByYear.set(yr, (popByYear.get(yr) ?? 0) + Number(r.populacao ?? 0));
      }
    }
  } catch { /* population table may not exist yet — degrade gracefully */ }

  function closestPop(ano: number) {
    const exact = popByYear.get(ano);
    if (exact) return exact;
    let best: number | null = null;
    let bestDiff = Infinity;
    for (const [yr, pop] of popByYear.entries()) {
      const diff = Math.abs(yr - ano);
      if (diff < bestDiff) { bestDiff = diff; best = pop; }
    }
    return best;
  }

  const allYears = Array.from(yearMap.keys()).sort((a, b) => a - b);
  const byYear = allYears.map((ano) => {
    const casos = yearMap.get(ano) ?? 0;
    const municipiosNotificadores = municipiosMap.get(ano) ?? 0;
    const pop = closestPop(ano);
    const incidencia100k = pop && pop > 0 ? Number(((casos / pop) * 100_000).toFixed(2)) : null;
    return { ano, casos, municipiosNotificadores, incidencia100k };
  });

  const gveTotals = Array.from(gveYearMap.entries())
    .map(([gve, m]) => ({ gve, total: Array.from(m.values()).reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const topGves = new Set(gveTotals.map((g) => g.gve));

  const byGveYear: Array<{ gve: string; ano: number; casos: number }> = [];
  for (const [gve, m] of gveYearMap.entries()) {
    if (!topGves.has(gve)) continue;
    for (const [ano, casos] of m.entries()) byGveYear.push({ gve, ano, casos });
  }

  const byYearMonth: Array<{ ano: number; mes: number; casos: number }> = Array.from(yearMonthMap.entries())
    .map(([key, casos]) => {
      const [ano, mes] = key.split("-").map(Number);
      return { ano, mes, casos };
    })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);

  return {
    byYear,
    byGveYear,
    byYearMonth,
    totalCasos: byYear.reduce((s, r) => s + r.casos, 0),
    anosComDados: allYears,
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
  const empty = { hasData: false, lastSync: null, totalRows: 0, years: [], minYear: null, maxYear: null, latestNotificationDate: null, totalCases: 0, municipalities: 0, gves: 0 };
  try {
    const supabase = createAdminClient();

    // Use RPC for all aggregates in a single query — avoids fetching all rows
    const [rpcRes, logRes] = await Promise.all([
      supabase.rpc("cevesp_status_resumo"),
      supabase.from("cevesp_sync_log").select("synced_at").order("synced_at", { ascending: false }).limit(1)
    ]);

    const last = (logRes.data?.[0] as { synced_at: string } | undefined)?.synced_at ?? null;

    if (!rpcRes.error && rpcRes.data?.[0]) {
      const r = rpcRes.data[0] as {
        total_rows: number; total_cases: number; min_ano: number | null; max_ano: number | null;
        anos: number[] | null; municipios: number; gves: number; last_date: string | null;
      };
      const years = (r.anos ?? []).filter((a) => a > 1900).sort((a, b) => a - b);
      return {
        hasData: r.total_rows > 0,
        lastSync: last,
        totalRows: r.total_rows,
        years,
        minYear: r.min_ano ?? null,
        maxYear: r.max_ano ?? null,
        latestNotificationDate: r.last_date ?? null,
        totalCases: Number(r.total_cases ?? 0),
        municipalities: Number(r.municipios ?? 0),
        gves: Number(r.gves ?? 0)
      };
    }

    // Fallback if RPC not yet deployed
    const countRes = await supabase.from("cevesp_notificacoes").select("id", { count: "exact", head: true });
    const total = countRes.count ?? 0;
    return { ...empty, hasData: total > 0, lastSync: last, totalRows: total };
  } catch {
    return empty;
  }
}
