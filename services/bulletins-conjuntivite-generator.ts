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

━━━ RESUMO DA SEMANA ━━━
Total de casos: ${totalCasos}
Ocorrências com surto: ${totalSurtos}

━━━ REGIÕES COM MAIS CASOS ━━━
${topGves}

━━━ DISTRIBUIÇÃO POR SEXO ━━━
Masculino: ${totalMasc} (${pct(totalMasc, totalCasos)})
Feminino: ${totalFem} (${pct(totalFem, totalCasos)})

━━━ DISTRIBUIÇÃO POR FAIXA ETÁRIA ━━━
Menos de 1 ano: ${fx0} (${pct(fx0, totalCasos)})
1–4 anos: ${fx14} (${pct(fx14, totalCasos)})
5–9 anos: ${fx59} (${pct(fx59, totalCasos)})
10–14 anos: ${fx1014} (${pct(fx1014, totalCasos)})
15 anos ou mais: ${fx15} (${pct(fx15, totalCasos)})

━━━ COMPARAÇÃO TEMPORAL ━━━
Semana anterior (SE ${se > 1 ? se - 1 : 52}/${se > 1 ? ano : ano - 1}): ${prevCasos} casos — ${delta(totalCasos, prevCasos)}
Mesma semana do ano passado (SE ${se}/${ano - 1}): ${agoAnosCasos} casos — ${delta(totalCasos, agoAnosCasos)}`;
}

const SYSTEM_PROMPT = `Você é comunicador em saúde do Centro de Oftalmologia Sanitária / CVE/SES-SP.
Redige boletins semanais de conjuntivite para a POPULAÇÃO GERAL — cidadãos e famílias, não gestores ou profissionais de saúde.

REGRA DE LINGUAGEM: Clara, acessível e humana. Sem jargões técnicos. Explique qualquer termo médico que usar. Não use siglas sem explicação.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores.

REGRA DE SISTEMAS: Nunca mencione sistemas internos (CEVESP, GVE, SINAN, SES-SP, CVE). Use apenas "vigilância estadual de saúde", "dados de São Paulo" ou similar. Onde houver "GVE + nome", use apenas o nome geográfico da região.

REGRA DE PÚBLICO: Escreva para o cidadão. Nada de "recomendações para municípios", "GVEs prioritários" ou ações para gestores.

REGRA DE FORMATO: Comece DIRETAMENTE com "## O que é Conjuntivite?" sem nenhuma linha antes.

Estrutura obrigatória em Markdown:

## O que é Conjuntivite?
2–3 frases simples: o que é, como se pega (contato com secreções, mãos sujas, objetos compartilhados), que é contagiosa mas tratável.

## O que Aconteceu esta Semana em São Paulo
Quantos casos foram registrados, se houve aumento ou queda em relação à semana anterior e ao mesmo período do ano passado. Em linguagem simples e empática.

## Regiões com Mais Casos
Mencione as regiões/cidades com maior número de casos usando nomes geográficos que o público reconheça. Não use siglas.

## Quem Foi Mais Afetado
Faixa etária e sexo em linguagem acessível. Ex: "a maioria dos casos ocorreu em adultos acima de 15 anos".

## Sintomas
Lista clara: olho vermelho, lacrimejamento, secreção, sensação de areia. Quando é mais grave.

## Como se Prevenir
Higiene das mãos, não compartilhar toalhas/colírios/travesseiros, evitar coçar os olhos.

## Quando Buscar Atendimento
Orientação direta: procure um médico ou unidade de saúde se tiver os sintomas, especialmente se persistirem por mais de 2 dias ou em crianças pequenas.

## Nota
Dados de vigilância epidemiológica do Estado de São Paulo, Semana Epidemiológica [SE]/[ano].`;

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
