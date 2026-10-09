import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TIME_ZONE, dateToEpiWeekYear, shiftEpiWeek } from "@/lib/epi-week";
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
  if (!den) return "0,0%";
  return `${((num / den) * 100).toFixed(1).replace(".", ",")}%`;
}

function delta(current: number, prev: number) {
  if (!prev) return "sem dado anterior";
  const d = ((current - prev) / prev) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1).replace(".", ",")}% em relação ao período anterior`;
}

async function fetchCevespWeek(supabase: ReturnType<typeof createAdminClient>, se: number, ano: number): Promise<Record<string, unknown>[]> {
  const { data } = await supabase
    .from("cevesp_notificacoes")
    .select([
      '"GVE_NOME"',
      '"TotalCaso"',
      '"SexMasc"',
      '"SexFem"',
      '"FxMenorUmAno"',
      '"FxUmQuatro"',
      '"FxCincoNove"',
      '"FxDezQuatorze"',
      '"FxQuizeOuMais"',
      '"Surto"',
      '"NuSurto"',
      '"NuColetaMaterialBio"',
      '"NuAcaoEducativa"',
      '"NuTreinamento"',
      '"NuEncamimento"'
    ].join(","))
    .eq("ANO", ano)
    .eq("SemEpidemio", se);
  return (data ?? []) as unknown as Record<string, unknown>[];
}

function sum(rows: Record<string, unknown>[], field: string) {
  return rows.reduce((s, r) => s + Number(r[field] ?? 0), 0);
}

function isSurto(row: Record<string, unknown>) {
  return ["1", "s", "sim", "true", "x"].includes(String(row["Surto"] ?? "").trim().toLowerCase());
}

function buildCevespSummary(
  se: number,
  ano: number,
  current: Record<string, unknown>[],
  prev: Record<string, unknown>[],
  sameYearAgo: Record<string, unknown>[]
): string {
  if (!current.length) {
    return (
      `Não há notificações de conjuntivite registradas para a SE ${se}/${ano}. ` +
      `Os dados desta semana podem ainda estar sendo enviados pelos municípios.`
    );
  }

  const totalCasos = sum(current, "TotalCaso");
  const totalNotif = current.length;
  const totalSurtos = current.filter(isSurto).length;
  const totalMasc = sum(current, "SexMasc");
  const totalFem = sum(current, "SexFem");
  const fx0 = sum(current, "FxMenorUmAno");
  const fx14 = sum(current, "FxUmQuatro");
  const fx59 = sum(current, "FxCincoNove");
  const fx1014 = sum(current, "FxDezQuatorze");
  const fx15 = sum(current, "FxQuizeOuMais");
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
    gveMap[gve] = (gveMap[gve] ?? 0) + Number(r["TotalCaso"] ?? 0);
  }
  const topGves = Object.entries(gveMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([gve, casos]) => `${gve}: ${casos} casos`)
    .join("\n");

  return `DADOS DE CONJUNTIVITE — SE ${se}/${ano} — ESTADO DE SÃO PAULO

━━━ RESUMO DA SEMANA (SE ${se}/${ano}) ━━━
Notificações recebidas: ${totalNotif}
Total de casos notificados: ${totalCasos}
Ocorrências com surto: ${totalSurtos} (${pct(totalSurtos, totalNotif)} das notificações)

━━━ DISTRIBUIÇÃO POR GVE — TOP 10 ━━━
${topGves}

━━━ SEXO ━━━
Masculino: ${totalMasc} (${pct(totalMasc, totalCasos)})
Feminino: ${totalFem} (${pct(totalFem, totalCasos)})

━━━ FAIXA ETÁRIA ━━━
< 1 ano: ${fx0} (${pct(fx0, totalCasos)})
1–4 anos: ${fx14} (${pct(fx14, totalCasos)})
5–9 anos: ${fx59} (${pct(fx59, totalCasos)})
10–14 anos: ${fx1014} (${pct(fx1014, totalCasos)})
15 anos ou mais: ${fx15} (${pct(fx15, totalCasos)})

━━━ AÇÕES DE VIGILÂNCIA NA SEMANA ━━━
Coletas de material biológico: ${coletas}
Ações educativas: ${acoesEd}
Treinamentos: ${trein}
Encaminhamentos especializados: ${encam}

━━━ COMPARAÇÃO TEMPORAL ━━━
SE anterior (SE ${se > 1 ? se - 1 : 52}/${se > 1 ? ano : ano - 1}): ${prevCasos} casos — ${delta(totalCasos, prevCasos)}
Mesma SE ano anterior (SE ${se}/${ano - 1}): ${agoAnosCasos} casos — ${delta(totalCasos, agoAnosCasos)}`;
}

export async function generateConjuntiviteBulletin(
  options: ConjuntiviteBulletinOptions = {}
): Promise<ConjuntiviteBulletinResult> {
  const fallback = lastCompleteWeek();
  const se = Number(options.se ?? fallback.se);
  const ano = Number(options.ano ?? fallback.ano);
  const supabase = createAdminClient();

  // Idempotency check
  if (!options.force) {
    const { data: existing } = await supabase
      .from("bulletins")
      .select("id, title")
      .eq("se", se)
      .eq("ano", ano)
      .eq("agravo", "conjuntivite")
      .maybeSingle();
    if (existing) {
      return { ok: true, skipped: true, id: existing.id, title: existing.title, se, ano, agravo: "conjuntivite" };
    }
  }

  // Fetch data for current SE, previous SE, and same SE last year
  const previous = shiftEpiWeek(ano, se, -1);
  const sePrev = previous.se;
  const anoPrev = previous.year;
  const [current, prev, yearAgo] = await Promise.all([
    fetchCevespWeek(supabase, se, ano),
    fetchCevespWeek(supabase, sePrev, anoPrev),
    fetchCevespWeek(supabase, se, ano - 1)
  ]);

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
