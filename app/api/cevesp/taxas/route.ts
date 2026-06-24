import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { buildCevespRates } from "@/services/population-rates";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const anoParam = request.nextUrl.searchParams.get("ano");
  const ano = anoParam ? Number(anoParam) : undefined;
  const gve = request.nextUrl.searchParams.get("gve") ?? undefined;

  try {
    return NextResponse.json(await buildCevespRates(ano, gve));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao calcular taxas CEVESP." },
      { status: 500 }
    );
  }
}
