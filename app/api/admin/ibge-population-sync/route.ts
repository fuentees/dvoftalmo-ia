import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { syncIbgePopulation, syncIbgePopulationRange } from "@/services/ibge-population";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data, error, count } = await admin
      .from("ibge_municipio_populacao")
      .select("ano", { count: "exact" });
    if (error) throw error;
    const years = Array.from(new Set((data ?? []).map((row) => Number(row.ano)).filter(Number.isFinite))).sort((a, b) => a - b);
    return NextResponse.json({
      totalRows: count ?? data?.length ?? 0,
      years,
      minYear: years[0] ?? null,
      maxYear: years[years.length - 1] ?? null
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar populacao IBGE." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    year?: number;
    yearStart?: number;
    yearEnd?: number;
    ufCode?: string;
  };

  try {
    const ufCode = body.ufCode ?? "35";
    const yearStart = Number(body.yearStart);
    const yearEnd = Number(body.yearEnd);
    const result = Number.isInteger(yearStart) && Number.isInteger(yearEnd)
      ? await syncIbgePopulationRange(ufCode, yearStart, yearEnd)
      : await syncIbgePopulation(ufCode, body.year ?? new Date().getFullYear() - 1);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao sincronizar populacao IBGE." },
      { status: 500 }
    );
  }
}
