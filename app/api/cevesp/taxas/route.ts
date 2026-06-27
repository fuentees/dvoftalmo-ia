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
  const municipio = request.nextUrl.searchParams.get("municipio") ?? undefined;
  const seInicio = request.nextUrl.searchParams.get("seInicio") ? Number(request.nextUrl.searchParams.get("seInicio")) : undefined;
  const seFim = request.nextUrl.searchParams.get("seFim") ? Number(request.nextUrl.searchParams.get("seFim")) : undefined;

  try {
    return NextResponse.json(await buildCevespRates({ ano, gve, municipio, seInicio, seFim }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao calcular taxas CEVESP." },
      { status: 500 }
    );
  }
}
