import { createAdminClient } from "@/lib/supabase/admin";
import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";
import { emailEpidAlert } from "@/services/email";

type AlertCandidate = {
  gve: string;
  cases: number;
};

type AlertGenerationResult = {
  ok: boolean;
  alerts: number;
  source: "external" | "cache";
  ano?: number;
  se?: number;
  reason?: string;
  warning?: string;
};

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getSaoPauloDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function epidemiologicalWeek(date: Date) {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  return Math.min(53, Math.max(1, Math.ceil((dayOfYear + yearStart.getDay()) / 7)));
}

function currentReferenceWeek() {
  const today = getSaoPauloDate();
  const currentSe = epidemiologicalWeek(today);
  if (currentSe <= 1) {
    return { ano: today.getFullYear() - 1, se: 52 };
  }
  return { ano: today.getFullYear(), se: currentSe - 1 };
}

async function upsertAlerts(current: AlertCandidate[], avgRows: Array<{ gve: string; avg_cases: number }>, ano: number, se: number, source: AlertGenerationResult["source"], warning?: string): Promise<AlertGenerationResult> {
  if (!current.length) return { ok: true, alerts: 0, source, ano, se, reason: "Sem dados para a SE avaliada", warning };

  const avgMap = new Map(avgRows.map((row) => [row.gve, row.avg_cases]));
  const supabase = createAdminClient();
  let alertCount = 0;

  for (const row of current) {
    const avg = avgMap.get(row.gve) ?? 0;
    if (avg <= 0) continue;
    const pct = ((row.cases - avg) / avg) * 100;
    if (pct < 50) continue;

    const severity = pct >= 100 ? "critical" : "warning";
    const { error } = await supabase.from("epidemiological_alerts").upsert(
      {
        se_epidemiologica: se,
        ano,
        gve: row.gve,
        cases_current: row.cases,
        cases_avg: avg,
        increase_pct: pct,
        severity
      },
      { onConflict: "se_epidemiologica,ano,gve" }
    );
    if (error) throw new Error(`Erro ao salvar alerta: ${error.message}`);

    await emailEpidAlert({
      gve: row.gve,
      se,
      casesCurrent: row.cases,
      casesAvg: avg,
      increasePct: pct,
      severity
    }).catch(() => {});
    alertCount++;
  }

  return {
    ok: true,
    alerts: alertCount,
    source,
    ano,
    se,
    reason: alertCount > 0 ? undefined : "Nenhuma GVE atingiu aumento maior que 50%",
    warning
  };
}

async function generateFromExternal(): Promise<AlertGenerationResult> {
  let conn: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    conn = await createNotificationConnection();
    const table = getNotificationTableName();
    const [[nowRow]] = await conn.query("SELECT year(curdate()) as ano, week(curdate(), 6) as se") as unknown[][];
    const { ano, se } = nowRow as { ano: number; se: number };
    const lastSe = se - 1 < 1 ? 52 : se - 1;

    const [currentRows] = await conn.query(
      `SELECT coalesce(GVE_NOME,'Não informado') as gve,
              sum(coalesce(TotalCaso,0)) as cases
       FROM \`${table}\`
       WHERE SemEpidemio = ? AND ANO = ?
       GROUP BY gve`,
      [lastSe, ano]
    ) as unknown[][];

    const [avgRows] = await conn.query(
      `SELECT coalesce(GVE_NOME,'Não informado') as gve,
              avg(cases_by_se) as avg_cases
       FROM (
         SELECT GVE_NOME, SemEpidemio, sum(coalesce(TotalCaso,0)) as cases_by_se
         FROM \`${table}\`
         WHERE SemEpidemio BETWEEN ? AND ? AND ANO = ?
         GROUP BY GVE_NOME, SemEpidemio
       ) t GROUP BY gve`,
      [lastSe - 4, lastSe - 1, ano]
    ) as unknown[][];

    return upsertAlerts(
      (currentRows as AlertCandidate[]).map((row) => ({ gve: String(row.gve ?? "Não informado"), cases: toNumber(row.cases) })),
      (avgRows as Array<{ gve: string; avg_cases: number }>).map((row) => ({ gve: String(row.gve ?? "Não informado"), avg_cases: toNumber(row.avg_cases) })),
      ano,
      lastSe,
      "external"
    );
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function generateFromCache(warning?: string): Promise<AlertGenerationResult> {
  const supabase = createAdminClient();
  const reference = currentReferenceWeek();
  const { data: latest, error: latestError } = await supabase
    .from("cevesp_notificacoes")
    .select('"ANO","SemEpidemio"')
    .not('"ANO"', "is", null)
    .not('"SemEpidemio"', "is", null)
    .eq('"ANO"', reference.ano)
    .gte('"SemEpidemio"', 1)
    .lte('"SemEpidemio"', reference.se)
    .order('"SemEpidemio"', { ascending: false })
    .limit(1);
  if (latestError) throw new Error(`Erro ao localizar SE no cache CEVESP: ${latestError.message}`);

  const latestRow = latest?.[0] as { ANO?: number; SemEpidemio?: number } | undefined;
  const ano = Number(latestRow?.ANO ?? reference.ano);
  const se = Number(latestRow?.SemEpidemio);
  if (!Number.isFinite(ano) || !Number.isFinite(se)) {
    return {
      ok: true,
      alerts: 0,
      source: "cache",
      ano: reference.ano,
      se: reference.se,
      reason: `Cache CEVESP sem dados até a última SE completa (${reference.se}/${reference.ano})`,
      warning
    };
  }

  const seStart = Math.max(1, se - 4);
  const { data, error } = await supabase
    .from("cevesp_notificacoes")
    .select('"GVE_NOME","SemEpidemio","TotalCaso"')
    .eq('"ANO"', ano)
    .gte('"SemEpidemio"', seStart)
    .lte('"SemEpidemio"', se);
  if (error) throw new Error(`Erro ao ler cache CEVESP: ${error.message}`);

  const currentMap = new Map<string, number>();
  const historyByGveSe = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ GVE_NOME?: string; SemEpidemio?: number; TotalCaso?: number }>) {
    const gve = String(row.GVE_NOME ?? "Não informado").trim() || "Não informado";
    const rowSe = Number(row.SemEpidemio);
    const cases = toNumber(row.TotalCaso);
    if (rowSe === se) currentMap.set(gve, (currentMap.get(gve) ?? 0) + cases);
    if (rowSe >= seStart && rowSe < se) {
      const key = `${gve}|${rowSe}`;
      historyByGveSe.set(key, (historyByGveSe.get(key) ?? 0) + cases);
    }
  }

  const current = Array.from(currentMap.entries()).map(([gve, cases]) => ({ gve, cases }));
  const avgRows = Array.from(new Set(Array.from(historyByGveSe.keys()).map((key) => key.split("|")[0]))).map((gve) => {
    let total = 0;
    let count = 0;
    for (let week = seStart; week < se; week++) {
      total += historyByGveSe.get(`${gve}|${week}`) ?? 0;
      count++;
    }
    return { gve, avg_cases: count > 0 ? total / count : 0 };
  });

  return upsertAlerts(current, avgRows, ano, se, "cache", warning);
}

export async function generateEpidemiologicalAlerts(): Promise<AlertGenerationResult> {
  try {
    return await generateFromExternal();
  } catch (error) {
    const warning = `Fonte externa indisponível; usei cache CEVESP. Detalhe: ${error instanceof Error ? error.message : String(error)}`;
    return generateFromCache(warning);
  }
}
