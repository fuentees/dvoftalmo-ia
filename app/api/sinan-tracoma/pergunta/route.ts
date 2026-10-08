import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runSinanTracomaAnalysis } from "@/services/sinan-tracoma";
import { validateTracomaFilters, type TracomaFilter } from "@/lib/tracoma-data";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let question: string;
  let filters: TracomaFilter;
  try {
    const body = await request.json();
    if (!body || typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000) throw new Error("Informe uma pergunta de até 2.000 caracteres.");
    question = body.question.trim();
    const input = body.filters ?? {};
    if (typeof input !== "object" || (input.gve != null && typeof input.gve !== "string") || (input.municipio != null && typeof input.municipio !== "string")) throw new Error("Filtros inválidos.");
    filters = validateTracomaFilters(input);
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? "Envie um JSON válido." : (error as Error).message }, { status: 400 });
  }

  try {
    return NextResponse.json(await runSinanTracomaAnalysis(question, filters));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const isQueryError = /Especifique|Esta consulta|linha\(s\).*quantidade|ano inicial|ano inteiro/.test(message);
    if (!isQueryError) console.error("Falha na consulta SINAN Tracoma", error);
    return NextResponse.json({ error: isQueryError ? message : "Não foi possível consultar o SINAN Tracoma. Tente novamente ou verifique a sincronização." }, { status: isQueryError ? 422 : 503 });
  }
}
