import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getCevespHistorico } from "@/lib/external/supabase-cevesp";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const gve = sp.get("gve") ?? undefined;
  const municipio = sp.get("municipio") ?? undefined;
  const yearStart = sp.get("yearStart") ? Number(sp.get("yearStart")) : undefined;
  const yearEnd = sp.get("yearEnd") ? Number(sp.get("yearEnd")) : undefined;

  try {
    const data = await getCevespHistorico({ gve, municipio, yearStart, yearEnd });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
