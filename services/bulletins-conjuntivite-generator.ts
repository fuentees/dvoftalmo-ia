import { createAdminClient } from "@/lib/supabase/admin";
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
  const ano = now.getFullYear();
  const week = Math.ceil((now.getTime() - new Date(ano, 0, 1).getTime()) / (7 * 864e5));
  return { ano, se: Math.max(1, week - 1) };
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
      `AVISO: Não foram encontradas notificações de conjuntivite no sistema CEVESP para a SE ${se}/${ano}. ` +
      `Os dados podem estar em processamento ou ainda não terem sido digitados. ` +
      `Gere o boletim com essa informação de forma explícita.`
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

  return `DADOS REAIS DO CEVESP — CONJUNTIVITE — SE ${se}/${ano}
Estado de São Paulo | Semana Epidemiológica ${se} de ${ano}

━━━ RESUMO DA SEMANA (SE ${se}/${ano}) ━━━
Notificações recebidas: ${totalNotif}
Total de casos notificados: ${totalCasos}
Notificações com surto: ${totalSurtos} (${pct(totalSurtos, totalNotif)} das notificações)

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
Coletas biológicas: ${coletas}
Ações educativas: ${acoesEd}
Treinamentos: ${trein}
Encaminhamentos especializados: ${encam}

━━━ COMPARAÇÃO TEMPORAL ━━━
SE anterior (SE ${se > 1 ? se - 1 : 52}/${se > 1 ? ano : ano - 1}): ${prevCasos} casos — ${delta(totalCasos, prevCasos)}
Mesma SE ano anterior (SE ${se}/${ano - 1}): ${agoAnosCasos} casos — ${delta(totalCasos, agoAnosCasos)}`;
}

const SYSTEM_PROMPT = `Você é epidemiologista do Centro de Vigilância Epidemiológica "Prof. Alexandre Vranjac" (CVE/CCD/SES-SP).
Redige boletins técnicos semanais de conjuntivite para gestores municipais e equipes de vigilância epidemiológica.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores. Se os dados indicarem ausência de casos, informe isso com clareza.

REGRA DE FORMATO: NÃO inclua título, subtítulo, cabeçalho institucional, nome da doença, semana epidemiológica ou qualquer linha antes da primeira seção. O documento já possui cabeçalho. Comece O TEXTO DIRETAMENTE com "## Introdução".

Estrutura obrigatória do boletim em Markdown (comece exatamente daqui):

## Introdução
Descreva brevemente: o que é conjuntivite, agentes etiológicos mais comuns (adenovírus, clamídia, bacteriana), transmissão por contato direto e fômites, importância para a vigilância em São Paulo, obrigatoriedade de notificação pelo CEVESP.

## Resumo Executivo
Um único parágrafo com os números mais importantes da semana — para o gestor ler em 30 segundos e saber o que decidir.

## Situação Epidemiológica da Semana
Apresente os dados de casos, notificações e surtos com análise narrativa. Cite os números reais.

## Indicadores da Semana

| Indicador | Valor |
|---|---|
| Total de casos | X |
| Total de notificações | X |
| Notificações com surto | X (Y%) |
| Coletas biológicas | X |
| Ações educativas | X |
| Treinamentos | X |
| Encaminhamentos | X |

## Distribuição Geográfica
Cite os GVEs com mais casos. Identifique regiões de atenção.

## Perfil dos Casos por Sexo e Faixa Etária
Analise os grupos mais afetados. Destaque faixas etárias de risco se relevante.

## Tendência e Comparação Temporal
Compare com a semana anterior e com a mesma semana do ano passado. Indique se a tendência é de crescimento, queda ou estabilidade.

## Alertas
Use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item.
Se não houver alertas críticos, escreva: "Nenhum alerta crítico identificado nesta semana."

## Recomendações
Lista com ações concretas para municípios e GVEs.

## Nota Técnica
Fonte: CEVESP/SES-SP. Data dos dados: [data atual]. Limitações: possível atraso de digitação de até 2 semanas; dados sujeitos a revisão posterior.`;

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
  const sePrev = se > 1 ? se - 1 : 52;
  const anoPrev = se > 1 ? ano : ano - 1;
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
