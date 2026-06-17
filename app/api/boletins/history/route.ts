import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function isSurto(row: Record<string, unknown>) {
  return ["1", "s", "sim", "true", "x"].includes(
    String(row["Surto"] ?? "").trim().toLowerCase()
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agravo = searchParams.get("agravo");
  const ano = Number(searchParams.get("ano") ?? 0);

  if (agravo !== "conjuntivite" || ano < 2000) {
    return NextResponse.json([]);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cevesp_notificacoes")
    .select([
      '"SemEpidemio"',
      '"TotalCaso"',
      '"Surto"',
      '"NuSurto"',
      '"NuColetaMaterialBio"',
      '"NuAcaoEducativa"',
      '"NuTreinamento"',
      '"NuEncamimento"',
    ].join(","))
    .eq("ANO", ano)
    .eq("Excluido", 0);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type SeEntry = {
    notificacoes: number;
    casos: number;
    surtos: number;
    coletas: number;
    acoes: number;
    treinamentos: number;
    encaminhamentos: number;
  };

  const seMap: Record<number, SeEntry> = {};

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const se = Number(row["SemEpidemio"] ?? 0);
    if (!se || se > 53) continue;
    if (!seMap[se]) seMap[se] = { notificacoes: 0, casos: 0, surtos: 0, coletas: 0, acoes: 0, treinamentos: 0, encaminhamentos: 0 };
    seMap[se].notificacoes++;
    seMap[se].casos       += Number(row["TotalCaso"] ?? 0);
    seMap[se].surtos      += isSurto(row) ? 1 : 0;
    seMap[se].coletas     += Number(row["NuColetaMaterialBio"] ?? 0);
    seMap[se].acoes       += Number(row["NuAcaoEducativa"] ?? 0);
    seMap[se].treinamentos += Number(row["NuTreinamento"] ?? 0);
    seMap[se].encaminhamentos += Number(row["NuEncamimento"] ?? 0);
  }

  const result = Object.entries(seMap)
    .map(([se, d]) => ({ se: Number(se), ...d }))
    .sort((a, b) => a.se - b.se);

  return NextResponse.json(result);
}
