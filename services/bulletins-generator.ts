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
  const prompt = cevespSummary
    ? `Dados reais do CEVESP para a SE ${se}/${ano}:\n${cevespSummary}\n\nGere um boletim epidemiológico semanal em português, formatado em Markdown, com cabeçalho institucional, situação epidemiológica, destaques por GVE, interpretação, alertas e recomendações. Seja técnico, objetivo e indique que a análise considera os dados disponíveis no sistema.`
    : `Gere um boletim epidemiológico semanal modelo para conjuntivites no Estado de São Paulo para a SE ${se}/${ano}. Informe claramente que não foi possível localizar dados consolidados no CEVESP nesta execução e oriente validação no sistema antes de publicação.`;

  let content = "";
  try {
    content = await generateCompletion(
      [
        {
          role: "system",
          content:
            "Você é epidemiologista do Centro de Vigilância Epidemiológica de São Paulo. Redige boletins técnicos concisos, com interpretação e recomendações práticas."
        },
        { role: "user", content: prompt }
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
