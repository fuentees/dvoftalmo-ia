import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchTracomaSurveys } from "@/services/tracoma-analytics";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const municipality = searchParams.get("municipality") ?? undefined;
  const uf = searchParams.get("uf") ?? undefined;
  const yearFrom = searchParams.get("yearFrom") ? Number(searchParams.get("yearFrom")) : undefined;
  const yearTo = searchParams.get("yearTo") ? Number(searchParams.get("yearTo")) : undefined;

  try {
    const surveys = await fetchTracomaSurveys({ municipality, uf, yearFrom, yearTo });
    return NextResponse.json(surveys);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar dados de tracoma." },
      { status: 500 }
    );
  }
}
