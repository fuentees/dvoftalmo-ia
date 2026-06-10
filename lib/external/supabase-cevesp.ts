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
  anoStart?: number; anoEnd?: number; seStart?: number; seEnd?: number;
} {
  const now  = new Date();
  const year = now.getFullYear();
  const se   = Math.ceil((now.getDate() + new Date(year, 0, 1).getDay()) / 7); // approximation

  if (dr.type === "current_year")  return { anoStart: year, anoEnd: year };
  if (dr.type === "last_year")     return { anoStart: year - 1, anoEnd: year - 1 };
  if (dr.type === "current_month") return { anoStart: year, anoEnd: year };
  if (dr.type === "relative_years" && dr.amount) {
    return { anoStart: year - dr.amount + 1, anoEnd: year };
  }
  if (dr.type === "relative_weeks" && dr.amount) {
    const seStart = Math.max(1, se - dr.amount);
    return { anoStart: year, anoEnd: year, seStart, seEnd: se };
  }
  if (dr.type === "between" && dr.start) {
    const [ys] = (dr.start).split("-").map(Number);
    const [ye] = (dr.end ?? dr.start).split("-").map(Number);
    return { anoStart: ys || year, anoEnd: ye || year };
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
  metricLabel: string;
  timeLabel: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  interpretation: string[];
  fromCache: true;
}> {
  const supabase = createAdminClient();
  const dr       = resolveDateRange(analysis.date_range);

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

  const { data, error } = await supabase.rpc("cevesp_aggregate", {
    p_metric:    analysis.metric,
    p_dimension: dimension,
    p_ano_start: dr.anoStart ?? null,
    p_ano_end:   dr.anoEnd   ?? null,
    p_se_start:  dr.seStart  ?? null,
    p_se_end:    dr.seEnd    ?? null,
    p_gve:       gveFilter   ?? null,
    p_drs:       drsFilter   ?? null,
    p_municipio: munFilter   ?? null,
    p_lim:       Math.min(analysis.limit ?? 100, 200)
  });

  if (error) throw new Error(`Cache CEVESP: ${error.message}`);

  const rows = (data ?? []) as Array<{ label: string; valor: number }>;
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
    metricLabel: metricLabels[analysis.metric] ?? analysis.metric,
    timeLabel:   `${dr.anoStart ?? "todos os anos"}${dr.seStart ? ` SE ${dr.seStart}–${dr.seEnd}` : ""}`,
    columns:     [dimLabel, "Valor"],
    rows:        mappedRows,
    fromCache:   true,
    interpretation: [
      `Dados do cache Supabase (última sincronização da rede SES-SP).`,
      `Total de ${metricLabels[analysis.metric] ?? "registros"}: ${total.toLocaleString("pt-BR")}.`,
      rows.length > 0 ? `Destaque: ${top3}.` : "Nenhum resultado para os filtros aplicados."
    ]
  };
}

/** Verifica se há dados no cache e quando foi a última sincronização */
export async function getCacheSyncInfo(): Promise<{
  hasData: boolean;
  lastSync: string | null;
  totalRows: number;
}> {
  try {
    const supabase = createAdminClient();
    const [countRes, logRes] = await Promise.all([
      supabase.from("cevesp_notificacoes").select("id", { count: "exact", head: true }),
      supabase.from("cevesp_sync_log").select("synced_at").order("synced_at", { ascending: false }).limit(1)
    ]);
    const total = countRes.count ?? 0;
    const last  = (logRes.data?.[0] as { synced_at: string } | undefined)?.synced_at ?? null;
    return { hasData: total > 0, lastSync: last, totalRows: total };
  } catch {
    return { hasData: false, lastSync: null, totalRows: 0 };
  }
}
