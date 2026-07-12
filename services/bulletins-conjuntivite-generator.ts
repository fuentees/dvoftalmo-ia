import { createAdminClient } from "@/lib/supabase/admin";
import { BUSINESS_TIME_ZONE, dateToEpiWeekYear, shiftEpiWeek } from "@/lib/epi-week";
import { generateCompletion } from "@/services/ai/provider";

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
      `AVISO: Não há registros de casos de conjuntivite para a SE ${se}/${ano}. ` +
      `Os dados podem ainda estar em processamento. ` +
      `Informe ao leitor de forma clara que não há dados disponíveis para esta semana. Não mencione sistemas internos.`
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

const SYSTEM_PROMPT = `Você é epidemiologista do Centro de Oftalmologia Sanitária / Centro de Vigilância Epidemiológica "Prof. Alexandre Vranjac" (CVE/CCD/SES-SP).
Redige boletins epidemiológicos semanais de conjuntivite destinados a gestores municipais de saúde, equipes de vigilância epidemiológica e profissionais de saúde pública.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores. Se não houver dados para a semana, informe com clareza.

REGRA DE FORMATO: NÃO inclua título, subtítulo, cabeçalho institucional ou qualquer linha antes da primeira seção. O documento já possui cabeçalho. Comece O TEXTO DIRETAMENTE com "## Introdução".

Estrutura obrigatória em Markdown:

## Introdução
Contextualização breve: o que é conjuntivite, principais agentes etiológicos (adenovírus, Chlamydia trachomatis, bacteriana), mecanismo de transmissão, importância para a vigilância epidemiológica em São Paulo.

## Situação Epidemiológica da Semana
Análise narrativa dos casos, notificações e surtos com os números reais. Contextualize a magnitude em relação ao período.

## Indicadores da Semana

| Indicador | Valor |
|---|---|
| Total de casos | X |
| Total de notificações | X |
| Ocorrências com surto | X |
| Coletas de material biológico | X |
| Ações educativas realizadas | X |

## Distribuição Geográfica
Análise por região: identifique os GVEs (Grupos de Vigilância Epidemiológica) com maior número de casos e regiões de atenção prioritária.

## Perfil dos Casos
Distribuição por sexo e faixa etária. Destaque grupos de maior risco se os dados indicarem.

## Tendência e Comparação Temporal
Compare com a semana anterior e com a mesma semana do ano passado. Classifique a tendência (aumento, redução ou estabilidade).

## Alertas
Se houver situações que demandam atenção imediata, use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item.
Se não houver alertas, escreva: "Nenhum alerta crítico identificado nesta semana."

## Recomendações
Ações concretas e prioritárias para municípios, GVEs e equipes de vigilância epidemiológica.

## Nota Técnica
Fonte: Sistema de Notificação de Conjuntivite/CEVESP/SES-SP. Semana Epidemiológica [SE]/[ano]. Dados sujeitos a revisão — possível subnotificação por atraso de digitação.`;

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
  const userPrompt = `${dataSummary}\n\nGere o Boletim Epidemiológico de Conjuntivite para a SE ${se}/${ano} seguindo a estrutura definida. Use os números fornecidos acima. Inclua a Introdução com contexto epidemiológico completo.`;

  let content = "";
  try {
    content = await generateCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      { temperature: 0.15 }
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), se, ano, agravo: "conjuntivite" };
  }

  const { data, error } = await supabase
    .from("bulletins")
    .upsert({ se, ano, agravo: "conjuntivite", title, content }, { onConflict: "se,ano,agravo" })
    .select("id, title")
    .single();

  if (error) return { ok: false, error: error.message, se, ano, agravo: "conjuntivite" };
  return { ok: true, id: data.id, title: data.title, se, ano, agravo: "conjuntivite" };
}
