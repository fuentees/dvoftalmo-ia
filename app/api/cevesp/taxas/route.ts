import { parseCevespFilters } from "@/lib/cevesp-filters";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { buildCevespRates } from "@/services/population-rates";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let filters;
  try { filters = parseCevespFilters(new URL(request.url).searchParams); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const { ano, anoFim, gve, municipio, seInicio, seFim } = filters;


  try {
    return NextResponse.json(await buildCevespRates({ ano, anoFim, gve, municipio, seInicio, seFim }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao calcular taxas CEVESP." },
      { status: 500 }
    );
  }
}
