import { parseCevespFilters } from "@/lib/cevesp-filters";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getCevespHistorico } from "@/lib/external/supabase-cevesp";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let filters;
  try { filters = parseCevespFilters(request.nextUrl.searchParams); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const { ano: yearStart, anoFim: yearEnd, gve, municipio } = filters;

  try {
    const data = await getCevespHistorico({ gve, municipio, yearStart, yearEnd });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
