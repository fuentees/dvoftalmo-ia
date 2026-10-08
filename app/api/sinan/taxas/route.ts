import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { buildSinanTracomaRates } from "@/services/population-rates";
import { validateTracomaFilters, type TracomaFilter } from "@/lib/tracoma-data";

function emptyRates(message: string) {
  return {
    missingData: true,
    missingPopulation: true,
    message,
    analysisYear: null,
    populationYear: null,
    metric: "Prevalencia entre examinados, taxa de deteccao e cobertura de exame",
    methodology: "prevalencia = positivos / examinados x 100; taxa de deteccao = positivos / populacao x 100.000; cobertura = examinados / populacao x 100",
    byMunicipality: [],
    byGve: [],
    mapRows: []
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const municipio = searchParams.get("municipio") ?? undefined;
  const gve = searchParams.get("gve") ?? undefined;
  let filters: TracomaFilter;
  try {
    filters = validateTracomaFilters({ municipio, gve, yearStart: searchParams.get("yearStart"), yearEnd: searchParams.get("yearEnd") });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  try {
    return NextResponse.json(await buildSinanTracomaRates(filters));
  } catch (error) {
    console.error("Falha nas taxas SINAN Tracoma", error);
    const message = "Não foi possível carregar os indicadores do SINAN Tracoma. Tente novamente ou verifique a sincronização.";
    return NextResponse.json({ ...emptyRates(message), error: message }, { status: 503 });
  }
}
