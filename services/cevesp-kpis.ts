import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";

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

export async function fetchCevespKpis(): Promise<CevespKpis> {
  const table = quoteIdentifier(getNotificationTableName());
  const connection = await createNotificationConnection();

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
  } finally {
    await connection.end();
  }
}
