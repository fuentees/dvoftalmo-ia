import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { syncIbgePopulation } from "@/services/ibge-population";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { year?: number; ufCode?: string };

  try {
    const result = await syncIbgePopulation(body.ufCode ?? "35", body.year ?? new Date().getFullYear() - 1);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao sincronizar populacao IBGE." },
      { status: 500 }
    );
  }
}
