import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runSinanTracomaAnalysis } from "@/services/sinan-tracoma";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { question } = await request.json() as { question?: unknown };
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "Informe uma pergunta." }, { status: 400 });
  }

  try {
    return NextResponse.json(await runSinanTracomaAnalysis(question));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao analisar SINAN Tracoma." },
      { status: 500 }
    );
  }
}
