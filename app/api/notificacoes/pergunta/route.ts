import { parseCevespFilters } from "@/lib/cevesp-filters";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runCevespAnalysis } from "@/services/cevesp-analytics";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { question, filters } = await request.json();
    if (!question || typeof question !== "string" || question.trim().length > 4000) return NextResponse.json({ error: "Informe uma pergunta com até 4.000 caracteres." }, { status: 400 });
    let scope;
    try { scope = filters ? parseCevespFilters(new URLSearchParams(String(filters))) : undefined; }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    return NextResponse.json(await runCevespAnalysis(question.trim(), scope));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes("etimedout") || lower.includes("econnrefused") || lower.includes("connect") || lower.includes("timeout")) {
      return NextResponse.json(
        {
          error: "fonte_indisponivel",
          message: "Não foi possível acessar a fonte externa agora. Se o banco CEVESP estiver disponível apenas na rede interna, use Sincronização para importar/exportar a base e consulte pelo cache do Supabase."
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: message || "Erro ao analisar pergunta." },
      { status: 500 }
    );
  }
}
