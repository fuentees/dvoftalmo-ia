import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TIME_ZONE, dateToEpiWeekYear, shiftEpiWeek, weeksInEpiYear } from "@/lib/epi-week";
import { readNotificationRowsFromCache } from "@/lib/external/notification-db";
import { distributionQuality, distributionWarning, isCaseCount } from "@/lib/cevesp-distribution";
import { summaryToMarkdown } from "@/lib/bulletin-format";

export interface ConjuntiviteBulletinOptions {
  se?: number;
  ano?: number;
  force?: boolean;
}

export interface ConjuntiviteBulletinResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  se: number;
  ano: number;
  agravo: "conjuntivite";
  title?: string;
  error?: string;
}

function lastCompleteWeek(now = new Date()) {
  const current = dateToEpiWeekYear(now, BUSINESS_TIME_ZONE);
  const previous = shiftEpiWeek(current.year, current.se, -1);
  return { ano: previous.year, se: previous.se };
}

function pct(num: number, den: number) {
  if (!isCaseCount(num) || !isCaseCount(den) || den <= 0 || num > den) return "percentual indisponível";
  return `${((num / den) * 100).toFixed(1).replace(".", ",")}%`;
}

function delta(current: number | null, prev: number | null) {
  if (current == null || prev == null) return "comparação indisponível: contagem ausente ou inválida";
  if (prev === 0) return "período anterior com zero casos; variação percentual não definida";
  const d = ((current - prev) / prev) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1).replace(".", ",")}% em relação ao período anterior`;
}

export async function fetchCevespWeek(supabase: ReturnType<typeof createAdminClient>, se: number, ano: number): Promise<Record<string, unknown>[]> {
  const result = await readNotificationRowsFromCache({ ano, anoFim: ano, seInicio: se, seFim: se }, supabase);
  return result.rows;
}

function sum(rows: Record<string, unknown>[], field: string): number | null {
  if (!rows.length || rows.some(row => !isCaseCount(row[field]))) return null;
  const total = rows.reduce((s, r) => s + Number(r[field]), 0);
  return isCaseCount(total) ? total : null;
}

function activeRows(rows: Record<string, unknown>[]) {
  return rows.filter(row => row.Excluido == null || ["", "0", "N", "FALSE"].includes(String(row.Excluido).trim().toUpperCase()));
}

export function buildBulletinDistribution(rows: Record<string, unknown>[], label: string, fields: Array<{ key: string; label: string }>) {
  const totalCases = sum(rows, "TotalCaso");
  const totals = fields.map(({ key }) => {
    const present = rows.filter(row => row[key] != null && row[key] !== "");
    return sum(present, key);
  });
  const invalidRows = rows.filter(row => distributionQuality(isCaseCount(row.TotalCaso) ? Number(row.TotalCaso) : NaN, fields.map(({ key }) => row[key])).status === "inconsistent").length;
  const quality = distributionQuality(totalCases ?? NaN, totals, invalidRows);
  if (quality.status === "inconsistent" || quality.status === "unavailable") {
    return `${distributionWarning(quality, label)} Não há perfil interpretável para este recorte.`;
  }
  if (totalCases === 0) return `Sem casos notificados: perfil por ${label} não se aplica.`;
  const values = fields.map((field, i) => totals[i] == null ? `${field.label}: contagem não informada` : `${field.label}: ${totals[i]}${quality.status === "complete" ? ` (${pct(totals[i]!, totalCases!)})` : ""}`).join("\n");
  return quality.status === "partial"
    ? `Perfil por ${label} parcial: ${quality.informedCases} de ${quality.totalCases} casos têm informação. Percentuais omitidos; não extrapole o perfil aos demais casos.\n${values}`
    : values;
}

function isSurto(row: Record<string, unknown>) {
  return ["1", "s", "sim", "true", "x"].includes(String(row["Surto"] ?? "").trim().toLowerCase()) || (isCaseCount(row.NuSurto) && Number(row.NuSurto) > 0);
}

export function buildCevespSummary(
  se: number,
  ano: number,
  current: Record<string, unknown>[],
  prev: Record<string, unknown>[],
  sameYearAgo: Record<string, unknown>[]
): string {
  current = activeRows(current);
  prev = activeRows(prev);
  sameYearAgo = activeRows(sameYearAgo);
  if (!current.length) {
    return (
      `Não há notificações de conjuntivite registradas para a SE ${se}/${ano}. ` +
      `Os dados desta semana podem ainda estar sendo enviados pelos municípios.`
    );
  }

  const totalCasos = sum(current, "TotalCaso");
  const totalNotif = current.length;
  const totalSurtos = current.filter(isSurto).length;
  const sexProfile = buildBulletinDistribution(current, "sexo", [{ key: "SexMasc", label: "Masculino" }, { key: "SexFem", label: "Feminino" }]);
  const ageProfile = buildBulletinDistribution(current, "faixa etária", [
    { key: "FxMenorUmAno", label: "< 1 ano" }, { key: "FxUmQuatro", label: "1–4 anos" },
    { key: "FxCincoNove", label: "5–9 anos" }, { key: "FxDezQuatorze", label: "10–14 anos" }, { key: "FxQuizeOuMais", label: "15 anos ou mais" },
  ]);
  const coletas = sum(current, "NuColetaMaterialBio");
  const acoesEd = sum(current, "NuAcaoEducativa");
  const trein = sum(current, "NuTreinamento");
  const encam = sum(current, "NuEncamimento");
  const prevCasos = sum(prev, "TotalCaso");
  const agoAnosCasos = sum(sameYearAgo, "TotalCaso");

  // GVE aggregation
  const gveMap: Record<string, number> = {};
  for (const r of current) {
    const gve = String(r["GVE_NOME"] ?? "Não informado");
    if (isCaseCount(r.TotalCaso)) gveMap[gve] = (gveMap[gve] ?? 0) + Number(r.TotalCaso);
  }
  const topGves = totalCasos == null ? "Distribuição territorial indisponível: há contagens de casos ausentes ou inválidas." : Object.entries(gveMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([gve, casos]) => `${gve}: ${casos} casos`)
    .join("\n");
  const display = (value: number | null) => value == null ? "Indisponível (contagem ausente ou inválida; não interpretar como zero)" : String(value);
  const previous = shiftEpiWeek(ano, se, -1);

  return `DADOS DE CONJUNTIVITE — SE ${se}/${ano} — ESTADO DE SÃO PAULO

━━━ RESUMO DA SEMANA (SE ${se}/${ano}) ━━━
Notificações recebidas: ${totalNotif}
Total de casos notificados: ${display(totalCasos)}
Ocorrências com surto: ${totalSurtos} (${pct(totalSurtos, totalNotif)} das notificações)

━━━ DISTRIBUIÇÃO POR GVE — TOP 10 ━━━
${topGves}

━━━ SEXO ━━━
${sexProfile}

━━━ FAIXA ETÁRIA ━━━
${ageProfile}

━━━ AÇÕES DE VIGILÂNCIA NA SEMANA ━━━
Coletas de material biológico: ${display(coletas)}
Ações educativas: ${display(acoesEd)}
Treinamentos: ${display(trein)}
Encaminhamentos especializados: ${display(encam)}

━━━ COMPARAÇÃO TEMPORAL ━━━
SE anterior (SE ${previous.se}/${previous.year}): ${display(prevCasos)} casos — ${delta(totalCasos, prevCasos)}
Mesma SE ano anterior (SE ${se}/${ano - 1}): ${display(agoAnosCasos)} casos — ${delta(totalCasos, agoAnosCasos)}`;
}

export async function generateConjuntiviteBulletin(
  options: ConjuntiviteBulletinOptions = {}
): Promise<ConjuntiviteBulletinResult> {
  const fallback = lastCompleteWeek();
  const se = Number(options.se ?? fallback.se);
  const ano = Number(options.ano ?? fallback.ano);
  const currentPeriod = dateToEpiWeekYear(new Date(), BUSINESS_TIME_ZONE);
  if (!Number.isInteger(ano) || ano < 1990 || ano > currentPeriod.year || !Number.isInteger(se) || se < 1 || se > weeksInEpiYear(ano) || (ano === currentPeriod.year && se > currentPeriod.se)) {
    return { ok: false, error: "Ano ou semana epidemiológica inválidos.", se, ano, agravo: "conjuntivite" };
  }
  const supabase = createAdminClient();

  // Idempotency check
  if (!options.force) {
    const { data: existing, error: existingError } = await supabase
      .from("bulletins")
      .select("id, title")
      .eq("se", se)
      .eq("ano", ano)
      .eq("agravo", "conjuntivite")
      .maybeSingle();
    if (existingError) return { ok: false, error: "Não foi possível verificar o boletim existente.", se, ano, agravo: "conjuntivite" };
    if (existing) {
      return { ok: true, skipped: true, id: existing.id, title: existing.title, se, ano, agravo: "conjuntivite" };
    }
  }

  // Fetch data for current SE, previous SE, and same SE last year
  const previous = shiftEpiWeek(ano, se, -1);
  const sePrev = previous.se;
  const anoPrev = previous.year;
  let current: Record<string, unknown>[], prev: Record<string, unknown>[], yearAgo: Record<string, unknown>[];
  try {
    [current, prev, yearAgo] = await Promise.all([
      fetchCevespWeek(supabase, se, ano),
      fetchCevespWeek(supabase, sePrev, anoPrev),
      se <= weeksInEpiYear(ano - 1) ? fetchCevespWeek(supabase, se, ano - 1) : Promise.resolve([]),
    ]);
  } catch {
    return { ok: false, error: "Não foi possível consultar todos os dados do boletim. Nenhum boletim foi gerado.", se, ano, agravo: "conjuntivite" };
  }

  const dataSummary = buildCevespSummary(se, ano, current, prev, yearAgo);
  const title = `Boletim de Conjuntivite — SE ${se}/${ano}`;
  const content = `# ${title}\n\n${summaryToMarkdown(dataSummary)}`;

  const { data, error } = await supabase
    .from("bulletins")
    .upsert({ se, ano, agravo: "conjuntivite", title, content }, { onConflict: "se,ano,agravo" })
    .select("id, title")
    .single();

  if (error) return { ok: false, error: error.message, se, ano, agravo: "conjuntivite" };
  return { ok: true, id: data.id, title: data.title, se, ano, agravo: "conjuntivite" };
}
