import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function isSurto(row: Record<string, unknown>) {
  return ["1", "s", "sim", "true", "x"].includes(
    String(row["Surto"] ?? "").trim().toLowerCase()
  );
}

function getValue(raw: Record<string, unknown>, candidates: string[]): unknown {
  const keys = Object.keys(raw);
  for (const c of candidates) {
    const key = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (key !== undefined && raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
  }
  return null;
}

function toNum(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const EXAM_FIELDS = ["NU_CASOEXA", "CASOEXA", "CASOS_EXAM", "NU_EXAM", "EXAMINADOS", "EXAMINA", "QT_EXAM", "TOT_EXAM", "NU_ALUNOS", "ALUNOS"];
const POS_FIELDS  = ["NU_CASOPOS", "CASOPOS", "CASOS_POS", "NU_POSITIV", "POSITIVOS", "QT_POS", "TOT_POS"];
const TRAT_FIELDS = ["NU_TRATAD", "TRATADOS", "QT_TRAT", "TOTAL_TRAT"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agravo = searchParams.get("agravo");
  const ano = Number(searchParams.get("ano") ?? 0);

  const admin = createAdminClient();

  // ── Tracoma: série histórica por ano (todos os dados disponíveis) ───────────
  if (agravo === "tracoma") {
    const [{ data: notData, error: notErr }, { data: tracData, error: tracErr }] = await Promise.all([
      admin.from("sinan_tracoma_rows").select("ano, municipio, raw").eq("source_bank", "nottraconet"),
      admin.from("sinan_tracoma_rows").select("ano, classificacao").eq("source_bank", "traconet"),
    ]);

    if (notErr) return NextResponse.json({ error: notErr.message }, { status: 500 });
    if (tracErr) return NextResponse.json({ error: tracErr.message }, { status: 500 });

    const notByYear: Record<number, { munis: Set<string>; exam: number; pos: number; trat: number }> = {};
    for (const row of (notData ?? []) as { ano: number | null; municipio: string | null; raw: Record<string, unknown> | null }[]) {
      const a = row.ano ?? 0;
      if (!a) continue;
      if (!notByYear[a]) notByYear[a] = { munis: new Set(), exam: 0, pos: 0, trat: 0 };
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      notByYear[a].munis.add(String(row.municipio ?? ""));
      notByYear[a].exam += toNum(getValue(raw, EXAM_FIELDS));
      notByYear[a].pos  += toNum(getValue(raw, POS_FIELDS));
      notByYear[a].trat += toNum(getValue(raw, TRAT_FIELDS));
    }

    const tracByYear: Record<number, { total: number; tt: number }> = {};
    for (const row of (tracData ?? []) as { ano: number | null; classificacao: string | null }[]) {
      const a = row.ano ?? 0;
      if (!a) continue;
      if (!tracByYear[a]) tracByYear[a] = { total: 0, tt: 0 };
      tracByYear[a].total++;
      if ((row.classificacao ?? "").toUpperCase().includes("TT")) tracByYear[a].tt++;
    }

    const allYears = new Set([...Object.keys(notByYear), ...Object.keys(tracByYear)].map(Number));
    const result = Array.from(allYears)
      .sort((a, b) => a - b)
      .map(a => {
        const not  = notByYear[a]  ?? { munis: new Set(), exam: 0, pos: 0, trat: 0 };
        const trac = tracByYear[a] ?? { total: 0, tt: 0 };
        return {
          ano: a,
          munis: not.munis.size,
          examinados: not.exam,
          positivos: not.pos,
          prevalencia: not.exam > 0 ? (not.pos / not.exam) * 100 : 0,
          tratados: not.trat,
          cobertura: not.pos > 0 ? (not.trat / not.pos) * 100 : 0,
          traconet: trac.total,
          tt: trac.tt,
        };
      });

    return NextResponse.json(result);
  }

  // ── Conjuntivite: curva epidêmica por SE ────────────────────────────────────
  if (agravo !== "conjuntivite" || ano < 2000) {
    return NextResponse.json([]);
  }

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
    .or("Excluido.eq.0,Excluido.is.null");

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
