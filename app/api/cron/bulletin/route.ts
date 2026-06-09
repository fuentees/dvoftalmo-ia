import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCompletion } from "@/services/ai/provider";
import { runCevespAnalysis } from "@/services/cevesp-analytics";

export const dynamic = "force-dynamic";

// Called every Monday at 08:00 UTC by Vercel Cron.
// Generates the weekly epidemiological bulletin for the last complete SE.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now  = new Date();
  const ano  = now.getFullYear();
  const se   = Math.ceil((now.getTime() - new Date(ano, 0, 1).getTime()) / (7 * 864e5));
  const lastSe = se - 1 < 1 ? 52 : se - 1;

  const supabase = createAdminClient();

  // Skip if bulletin already exists for this SE
  const { data: existing } = await supabase
    .from("bulletins").select("id").eq("se", lastSe).eq("ano", ano).single();
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, se: lastSe });
  }

  // Get CEVESP data for last SE
  let cevespSummary = "";
  try {
    const result = await runCevespAnalysis(`total de casos por GVE na SE ${lastSe} de ${ano}`);
    if (result.rows?.length) {
      const header = (result.columns ?? Object.keys(result.rows[0])).join(" | ");
      const rows   = result.rows.slice(0, 30).map((r: Record<string, unknown>) => Object.values(r).join(" | ")).join("\n");
      cevespSummary = `${header}\n${rows}`;
    }
  } catch { /* CEVESP offline — bulletin still generated with AI knowledge */ }

  const prompt = cevespSummary
    ? `Dados CEVESP SE ${lastSe}/${ano}:\n${cevespSummary}\n\nGere o boletim epidemiológico semanal em português, formatado em Markdown, com: cabeçalho institucional, situação epidemiológica, destaques por GVE, tendência e recomendações. Seja objetivo e técnico.`
    : `Gere um boletim epidemiológico semanal modelo para conjuntivites no Estado de SP para a SE ${lastSe}/${ano}. Use dados genéricos ilustrativos e instrua o leitor a verificar o sistema CEVESP para dados reais.`;

  let content = "";
  try {
    content = await generateCompletion([
      { role: "system", content: "Você é epidemiologista do Centro de Vigilância Epidemiológica de SP. Redige boletins técnicos concisos." },
      { role: "user",   content: prompt }
    ], { temperature: 0.3 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  await supabase.from("bulletins").insert({
    se: lastSe, ano,
    title: `Boletim Epidemiológico SE ${lastSe}/${ano}`,
    content
  });

  return NextResponse.json({ ok: true, se: lastSe });
}
