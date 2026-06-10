import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";
import { getCacheSyncInfo } from "@/lib/external/supabase-cevesp";
import { createAdminClient } from "@/lib/supabase/admin";

const identifierPattern = /^[a-zA-Z0-9_]+$/;

function quoteIdentifier(value: string) {
  if (!identifierPattern.test(value)) throw new Error(`Identificador invalido: ${value}`);
  return `\`${value}\``;
}

function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export interface CevespKpis {
  currentWeek: { se: number; year: number; cases: number };
  previousWeek: { se: number; year: number; cases: number };
  weekDelta: number | null;
  currentYear: { year: number; cases: number };
  previousYear: { year: number; cases: number };
  yearDelta: number | null;
  outbreaksCurrentYear: number;
  collectionsCurrentYear: number;
  topMunicipalitiesCurrentWeek: Array<{ name: string; cases: number }>;
  generatedAt: string;
}

async function fetchKpisFromCache(): Promise<CevespKpis> {
  const supabase = createAdminClient();
  const year = new Date().getFullYear();

  const { data: kpisData } = await supabase.rpc("cevesp_kpis_cache", {
    p_ano: year,
    p_se:  null
  });

  const kpis = (kpisData as Array<Record<string, unknown>> | null)?.[0] ?? {};
  const cw   = toNum(kpis.current_cases);
  const pw   = toNum(kpis.prev_cases);
  const cy   = toNum(kpis.year_cases);
  const py   = toNum(kpis.prev_year_cases);
  const se   = toNum(kpis.current_se);
  const prevSe = toNum(kpis.prev_se);

  const { data: topMunic } = await supabase.rpc("cevesp_aggregate", {
    p_metric:    "total_casos",
    p_dimension: "municipio",
    p_ano_start: year,
    p_ano_end:   year,
    p_se_start:  se || null,
    p_se_end:    se || null,
    p_lim:       5
  });

  const { lastSync, totalRows } = await getCacheSyncInfo();
  const note = lastSync
    ? ` (cache — última sync ${new Date(lastSync).toLocaleDateString("pt-BR")}; ${totalRows.toLocaleString("pt-BR")} registros)`
    : " (cache — sem dados sincronizados)";

  return {
    currentWeek:  { se, year, cases: cw },
    previousWeek: { se: prevSe, year, cases: pw },
    weekDelta:    pw > 0 ? Number(((cw - pw) / pw * 100).toFixed(1)) : null,
    currentYear:  { year, cases: cy },
    previousYear: { year: year - 1, cases: py },
    yearDelta:    py > 0 ? Number(((cy - py) / py * 100).toFixed(1)) : null,
    outbreaksCurrentYear:     0,
    collectionsCurrentYear:   0,
    topMunicipalitiesCurrentWeek: ((topMunic ?? []) as Array<{label: string; valor: number}>).map(r => ({
      name:  r.label,
      cases: r.valor
    })),
    generatedAt: new Date().toISOString() + note
  };
}

export async function fetchCevespKpis(): Promise<CevespKpis> {
  if (!process.env.NOTIFY_DB_HOST) return fetchKpisFromCache();

  let table: string;
  try {
    table = quoteIdentifier(getNotificationTableName());
  } catch {
    return fetchKpisFromCache();
  }

  let connection: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    connection = await createNotificationConnection();
  } catch {
    return fetchKpisFromCache();
  }

  try {
    const [cwRows] = await connection.query(`
      select
        coalesce(SemEpidemio, week(curdate(), 3)) as se,
        year(curdate()) as yr,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where year(DtNotificacao) = year(curdate())
        and coalesce(SemEpidemio, week(DtNotificacao, 3)) = week(curdate(), 3)
    `);
    const cwRow = (cwRows as Array<Record<string, unknown>>)[0] ?? {};

    const [pwRows] = await connection.query(`
      select
        coalesce(SemEpidemio, week(date_sub(curdate(), interval 7 day), 3)) as se,
        year(date_sub(curdate(), interval 7 day)) as yr,
        sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where year(DtNotificacao) = year(date_sub(curdate(), interval 7 day))
        and coalesce(SemEpidemio, week(DtNotificacao, 3)) = week(date_sub(curdate(), interval 7 day), 3)
    `);
    const pwRow = (pwRows as Array<Record<string, unknown>>)[0] ?? {};

    const [cyRows] = await connection.query(`
      select year(curdate()) as yr, sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where year(DtNotificacao) = year(curdate())
    `);
    const cyRow = (cyRows as Array<Record<string, unknown>>)[0] ?? {};

    const [pyRows] = await connection.query(`
      select year(date_sub(curdate(), interval 1 year)) as yr, sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where year(DtNotificacao) = year(date_sub(curdate(), interval 1 year))
    `);
    const pyRow = (pyRows as Array<Record<string, unknown>>)[0] ?? {};

    const [obRows] = await connection.query(`
      select
        sum(case when lower(coalesce(Surto, '')) in ('1','s','sim','true','x') or coalesce(NuSurto, 0) > 0 then 1 else 0 end) as surtos,
        sum(coalesce(NuColetaMaterialBio, 0)) as coletas
      from ${table}
      where year(DtNotificacao) = year(curdate())
    `);
    const obRow = (obRows as Array<Record<string, unknown>>)[0] ?? {};

    const [topRows] = await connection.query(`
      select MunicipioNotificacao as name, sum(coalesce(TotalCaso, 0)) as cases
      from ${table}
      where year(DtNotificacao) = year(curdate())
        and coalesce(SemEpidemio, week(DtNotificacao, 3)) = week(curdate(), 3)
      group by MunicipioNotificacao
      order by cases desc
      limit 5
    `);

    const cw = toNum(cwRow.cases);
    const pw = toNum(pwRow.cases);
    const cy = toNum(cyRow.cases);
    const py = toNum(pyRow.cases);

    return {
      currentWeek: { se: toNum(cwRow.se), year: toNum(cwRow.yr), cases: cw },
      previousWeek: { se: toNum(pwRow.se), year: toNum(pwRow.yr), cases: pw },
      weekDelta: pw > 0 ? Number(((cw - pw) / pw * 100).toFixed(1)) : null,
      currentYear: { year: toNum(cyRow.yr), cases: cy },
      previousYear: { year: toNum(pyRow.yr), cases: py },
      yearDelta: py > 0 ? Number(((cy - py) / py * 100).toFixed(1)) : null,
      outbreaksCurrentYear: toNum(obRow.surtos),
      collectionsCurrentYear: toNum(obRow.coletas),
      topMunicipalitiesCurrentWeek: (topRows as Array<Record<string, unknown>>).map((row) => ({
        name: String(row.name ?? "Nao informado"),
        cases: toNum(row.cases)
      })),
      generatedAt: new Date().toISOString()
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("ENOTFOUND") || msg.includes("connect")) {
      return fetchKpisFromCache();
    }
    throw err;
  } finally {
    await connection?.end();
  }
}
