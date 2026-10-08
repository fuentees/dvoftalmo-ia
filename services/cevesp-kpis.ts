import { createNotificationConnection, getNotificationTableName, isNotificationConnectionError } from "@/lib/external/notification-db";
import { getCacheSyncInfo } from "@/lib/external/supabase-cevesp";
import { currentEpiWeek, shiftEpiWeek } from "@/lib/epi-week";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RpcRelatorioData } from "@/services/notification-report";

function toNum(value: unknown): number { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
export interface CevespKpis {
  currentWeek: { se: number; year: number; cases: number; notifications: number };
  previousWeek: { se: number; year: number; cases: number; notifications: number };
  weekDelta: number | null;
  currentYear: { year: number; cases: number };
  previousYear: { year: number; cases: number };
  yearDelta: number | null;
  outbreaksCurrentYear: number;
  collectionsCurrentYear: number;
  topMunicipalitiesCurrentWeek: Array<{ name: string; cases: number }>;
  generatedAt: string;
  source: "mysql" | "cache";
  lastSync: string | null;
  comparisonThroughSe: number;
}

function result(current: { year: number; se: number }, previous: { year: number; se: number }, cw: number, pw: number, cy: number, py: number, outbreaks: number, collections: number, top: Array<{ name: string; cases: number }>, source: "mysql" | "cache", lastSync: string | null, notifications: { cw: number; pw: number; cy: number; py: number }): CevespKpis {
  return {
    currentWeek: { ...current, cases: cw, notifications: notifications.cw }, previousWeek: { ...previous, cases: pw, notifications: notifications.pw },
    weekDelta: pw > 0 && notifications.cw > 0 && notifications.pw > 0 ? Number(((cw - pw) / pw * 100).toFixed(1)) : null,
    currentYear: { year: current.year, cases: cy }, previousYear: { year: current.year - 1, cases: py },
    yearDelta: py > 0 && notifications.cy > 0 && notifications.py > 0 ? Number(((cy - py) / py * 100).toFixed(1)) : null,
    outbreaksCurrentYear: outbreaks, collectionsCurrentYear: collections, topMunicipalitiesCurrentWeek: top,
    generatedAt: new Date().toISOString(), source, lastSync, comparisonThroughSe: current.se
  };
}

async function fetchKpisFromCache(): Promise<CevespKpis> {
  const admin = createAdminClient();
  const current = currentEpiWeek(), previous = shiftEpiWeek(current.year, current.se, -1);
  const countQuery = () => admin.from("cevesp_notificacoes").select("id", { count: "exact", head: true })
    .or("Excluido.is.null,Excluido.eq.0").gte("ANO", current.year - 1).lte("ANO", current.year);
  const [missingCounts, negativeCounts] = await Promise.all([countQuery().is("TotalCaso", null), countQuery().lt("TotalCaso", 0)]);
  if (missingCounts.error || negativeCounts.error || missingCounts.count === null || negativeCounts.count === null) {
    throw new Error("Não foi possível verificar a qualidade das contagens CEVESP.");
  }
  if ((missingCounts.count ?? 0) > 0 || (negativeCounts.count ?? 0) > 0) {
    throw new Error("Indicadores CEVESP indisponíveis: há contagens de casos ausentes ou negativas nos anos comparados. Revise a qualidade da base.");
  }
  async function report(year: number, start: number, end: number) {
    const { data, error } = await admin.rpc("cevesp_relatorio", { p_ano: year, p_ano_fim: year, p_gve: null, p_municipio: null, p_se_inicio: start, p_se_fim: end });
    if (error || !data) throw new Error(`Erro ao consultar indicadores CEVESP: ${error?.message ?? "resposta vazia"}`);
    for (const field of ["total_cases", "total_notifications"] as const) {
      const value = data[field];
      if (value === null || value === undefined || value === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
        throw new Error(`Resposta CEVESP inválida: ${field} ausente ou inválido.`);
      }
    }
    return data as RpcRelatorioData;
  }
  const [cw, pw, cy, py, sync] = await Promise.all([
    report(current.year, current.se, current.se), report(previous.year, previous.se, previous.se),
    report(current.year, 1, current.se), report(current.year - 1, 1, current.se), getCacheSyncInfo()
  ]);
  if (!sync.hasData) throw new Error("Nenhum dado CEVESP sincronizado para calcular indicadores.");
  return result(current, previous, toNum(cw.total_cases), toNum(pw.total_cases), toNum(cy.total_cases), toNum(py.total_cases),
    toNum(cy.outbreak_notifications), toNum(cy.bio_collection_total),
    (cw.top_municipios ?? []).slice(0, 5).map((row) => ({ name: row.name, cases: toNum(row.total) })), "cache", sync.lastSync,
    { cw: toNum(cw.total_notifications), pw: toNum(pw.total_notifications), cy: toNum(cy.total_notifications), py: toNum(py.total_notifications) });
}

export async function fetchCevespKpis(): Promise<CevespKpis> {
  if (!process.env.NOTIFY_DB_HOST) return fetchKpisFromCache();
  const tableName = getNotificationTableName();
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error("Tabela de notificações inválida.");
  const table = "`" + tableName + "`";
  const current = currentEpiWeek(), previous = shiftEpiWeek(current.year, current.se, -1);
  let connection: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    connection = await createNotificationConnection();
    async function aggregate(year: number, start: number, end: number) {
      const [rows] = await connection!.query(`select count(*) as notifications, sum(coalesce(TotalCaso, 0)) as cases,
        sum(case when TotalCaso is null or TotalCaso < 0 then 1 else 0 end) as invalid_counts,
        sum(case when lower(coalesce(Surto, '')) in ('1','s','sim','true','x') or coalesce(NuSurto,0)>0 then 1 else 0 end) as outbreaks,
        sum(coalesce(NuColetaMaterialBio,0)) as collections from ${table}
        where coalesce(Excluido,0)=0 and coalesce(ANO,year(DtNotificacao))=? and SemEpidemio between ? and ?`, [year,start,end]);
      const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
      if (toNum(row.invalid_counts) > 0) throw new Error("Indicadores CEVESP indisponíveis: há contagens de casos ausentes ou negativas no período.");
      return row;
    }
    const cw = await aggregate(current.year,current.se,current.se), pw = await aggregate(previous.year,previous.se,previous.se);
    const cy = await aggregate(current.year,1,current.se), py = await aggregate(current.year-1,1,current.se);
    const [top] = await connection.query(`select MunicipioNotificacao as name, sum(coalesce(TotalCaso,0)) as cases from ${table}
      where coalesce(Excluido,0)=0 and coalesce(ANO,year(DtNotificacao))=? and SemEpidemio=? group by MunicipioNotificacao order by cases desc limit 5`, [current.year,current.se]);
    return result(current, previous, toNum(cw.cases), toNum(pw.cases), toNum(cy.cases), toNum(py.cases), toNum(cy.outbreaks), toNum(cy.collections),
      (top as Array<Record<string, unknown>>).map((row) => ({ name: String(row.name ?? "Não informado"), cases: toNum(row.cases) })), "mysql", null,
      { cw: toNum(cw.notifications), pw: toNum(pw.notifications), cy: toNum(cy.notifications), py: toNum(py.notifications) });
  } catch (error) {
    if (isNotificationConnectionError(error)) return fetchKpisFromCache();
    throw error;
  } finally { await connection?.end(); }
}
