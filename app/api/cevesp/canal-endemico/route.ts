import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runEndemicChannel } from "@/services/cevesp-endemic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gve          = request.nextUrl.searchParams.get("gve")          ?? undefined;
  const municipality = request.nextUrl.searchParams.get("municipality") ?? undefined;
  const yearParam    = request.nextUrl.searchParams.get("year");
  const year         = yearParam ? Number(yearParam) : undefined;

  try {
    const data = await runEndemicChannel({ gve, municipality, year });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao calcular canal endemico." },
      { status: 500 }
    );
  }
}
