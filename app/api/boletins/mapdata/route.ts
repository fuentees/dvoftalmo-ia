import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ── NOTTRACONET field lookup ──────────────────────────────────────────────────
function getValue(raw: Record<string, unknown>, candidates: string[]): unknown {
  const keys = Object.keys(raw);
  for (const c of candidates) {
    const key = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (key !== undefined && raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
  }
  return null;
}

function toNum(v: unknown) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const EXAM_FIELDS = ["NU_CASOEXA", "CASOEXA", "CASOS_EXAM", "NU_EXAM", "EXAMINADOS", "EXAMINA", "QT_EXAM", "TOT_EXAM", "NU_ALUNOS", "ALUNOS"];
const POS_FIELDS  = ["NU_CASOPOS", "CASOPOS", "CASOS_POS", "NU_POSITIV", "POSITIVOS", "QT_POS", "TOT_POS"];

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agravo = searchParams.get("agravo");
  const ano = Number(searchParams.get("ano") ?? 0);
  const se = Number(searchParams.get("se") ?? 0);
  const admin = createAdminClient();

  // ── Tracoma: municipality-level prevalence ────────────────────────────────
  if (agravo === "tracoma" && ano >= 2000) {
    const { data, error } = await admin
      .from("sinan_tracoma_rows")
      .select("municipio, gve, raw")
      .eq("source_bank", "nottraconet")
      .eq("ano", ano);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const muniMap: Record<string, { exam: number; pos: number; gve: string }> = {};
    for (const row of data ?? []) {
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      const exam = toNum(getValue(raw, EXAM_FIELDS));
      const pos  = toNum(getValue(raw, POS_FIELDS));
      const muni = String(row.municipio ?? "Não informado");
      const gve  = String(row.gve ?? "");
      if (!muniMap[muni]) muniMap[muni] = { exam: 0, pos: 0, gve };
      muniMap[muni].exam += exam;
      muniMap[muni].pos  += pos;
    }

    return NextResponse.json(
      Object.entries(muniMap)
        .map(([municipio, d]) => ({
          municipio,
          gve: d.gve,
          examinados: d.exam,
          positivos: d.pos,
          prevalencia: d.exam > 0 ? (d.pos / d.exam) * 100 : 0,
        }))
        .filter(r => r.examinados > 0)
        .sort((a, b) => b.prevalencia - a.prevalencia)
    );
  }

  // ── Conjuntivite: GVE-level case count ───────────────────────────────────
  if (agravo === "conjuntivite" && se > 0 && ano >= 2000) {
    const { data, error } = await admin
      .from("cevesp_notificacoes")
      .select('"GVE_NOME", "TotalCaso"')
      .eq("ANO", ano)
      .eq("SemEpidemio", se)
      .eq("Excluido", 0);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const gveMap: Record<string, number> = {};
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const gve  = String(row["GVE_NOME"] ?? "Não informado");
      const casos = Number(row["TotalCaso"] ?? 0);
      gveMap[gve] = (gveMap[gve] ?? 0) + casos;
    }

    return NextResponse.json(
      Object.entries(gveMap)
        .map(([gve, casos]) => ({ gve, casos }))
        .filter(r => r.casos > 0)
        .sort((a, b) => b.casos - a.casos)
    );
  }

  return NextResponse.json([]);
}
