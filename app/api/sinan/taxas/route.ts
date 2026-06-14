import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { buildSinanTracomaRates } from "@/services/population-rates";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const municipio = searchParams.get("municipio") ?? undefined;
  const gve = searchParams.get("gve") ?? undefined;
  const yearStart = searchParams.get("yearStart") ? Number(searchParams.get("yearStart")) : undefined;
  const yearEnd = searchParams.get("yearEnd") ? Number(searchParams.get("yearEnd")) : undefined;

  try {
    return NextResponse.json(await buildSinanTracomaRates({ municipio, gve, yearStart, yearEnd }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao calcular taxas SINAN Tracoma." },
      { status: 500 }
    );
  }
}
