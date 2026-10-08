import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getTracomaOverview } from "@/services/sinan-tracoma";
import { validateTracomaFilters, type TracomaFilter } from "@/lib/tracoma-data";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const gve = sp.get("gve") ?? undefined;
  const municipio = sp.get("municipio") ?? undefined;
  let filters: TracomaFilter;
  try {
    filters = validateTracomaFilters({ municipio, gve, yearStart: sp.get("yearStart"), yearEnd: sp.get("yearEnd") });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  try {
    const data = await getTracomaOverview(filters);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Falha na série SINAN Tracoma", error);
    return NextResponse.json({ error: "Não foi possível carregar a série histórica. Tente novamente ou verifique a sincronização." }, { status: 503 });
  }
}
