import { createAdminClient } from "@/lib/supabase/admin";
import { generateCompletion } from "@/services/ai/provider";
import { runCevespAnalysis } from "@/services/cevesp-analytics";

export interface GenerateBulletinOptions {
  se?: number;
  ano?: number;
  force?: boolean;
}

export interface GenerateBulletinResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  se: number;
  ano: number;
  title?: string;
  error?: string;
}

function getLastCompleteEpidemiologicalWeek(now = new Date()) {
  const ano = now.getFullYear();
  const week = Math.ceil((now.getTime() - new Date(ano, 0, 1).getTime()) / (7 * 864e5));
  return {
    ano,
    se: week - 1 < 1 ? 52 : week - 1
  };
}

async function getCevespSummary(se: number, ano: number) {
  try {
    const result = await runCevespAnalysis(`total de casos por GVE na SE ${se} de ${ano}`);
    if (!result.rows?.length) return "";

    const columns = result.columns ?? Object.keys(result.rows[0]);
    const header = columns.join(" | ");
    const rows = result.rows
      .slice(0, 40)
      .map((row: Record<string, unknown>) => columns.map(column => String(row[column] ?? "")).join(" | "))
      .join("\n");

    return `${header}\n${rows}`;
  } catch {
    return "";
  }
}

export async function generateWeeklyBulletin(options: GenerateBulletinOptions = {}): Promise<GenerateBulletinResult> {
  const fallback = getLastCompleteEpidemiologicalWeek();
  const se = Number(options.se ?? fallback.se);
  const ano = Number(options.ano ?? fallback.ano);
  const supabase = createAdminClient();

  if (!options.force) {
    const { data: existing } = await supabase
      .from("bulletins")
      .select("id, title")
      .eq("se", se)
      .eq("ano", ano)
      .maybeSingle();

    if (existing) {
      return { ok: true, skipped: true, id: existing.id, title: existing.title, se, ano };
    }
  }

  const cevespSummary = await getCevespSummary(se, ano);
  const title = `Boletim Epidemiológico SE ${se}/${ano}`;

  const systemPrompt = `Você é epidemiologista do Centro de Vigilância Epidemiológica de São Paulo (CVE/DVE). \
Redige boletins técnicos semanais de conjuntivites para gestores e equipes de vigilância. \
Use Markdown com seções bem definidas. Seja objetivo, use linguagem técnica mas acessível. \
Estrutura obrigatória do boletim:

## Resumo executivo
(1 parágrafo — síntese da semana para o gestor ler em 30 segundos)

## 1. Situação epidemiológica
(casos na semana, comparação com SE anterior e mesmo período do ano anterior, tendência)

## 2. Indicadores da semana
(tabela ou lista: casos notificados, surtos, coletas, encaminhamentos)

## 3. Distribuição geográfica
(top GVEs e municípios com maior número de casos)

## 4. Análise e tendência
(interpretação epidemiológica, sazonalidade, padrão esperado vs. observado)

## 5. Alertas
(use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item. Se não houver alertas críticos, diga explicitamente.)

## 6. Recomendações
(lista numerada, ações práticas e específicas para equipes municipais e GVEs)

## Nota técnica
(fonte dos dados, data de corte, limitações conhecidas)`;

  const userPrompt = cevespSummary
    ? `Dados reais do CEVESP para a SE ${se}/${ano}:\n${cevespSummary}\n\nGere o boletim epidemiológico semanal seguindo a estrutura definida. Use os dados fornecidos. Indique que a análise reflete os dados disponíveis no sistema na data de emissão.`
    : `Gere um boletim epidemiológico semanal modelo para conjuntivites no Estado de São Paulo — SE ${se}/${ano}. Não foram localizados dados consolidados do CEVESP nesta execução. Informe isso claramente no Resumo executivo e na Nota técnica, e oriente a validação no sistema antes de publicação.`;

  let content = "";
  try {
    content = await generateCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      { temperature: 0.25 }
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), se, ano };
  }

  const { data, error } = await supabase
    .from("bulletins")
    .insert({ se, ano, title, content })
    .select("id, title")
    .single();

  if (error) return { ok: false, error: error.message, se, ano };
  return { ok: true, id: data.id, title: data.title, se, ano };
}
