import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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
      admin.from("sinan_tracoma_rows").select("ano, municipio, raw").eq("source_bank", "nottraconet").limit(200000),
      admin.from("sinan_tracoma_rows").select("ano, classificacao").eq("source_bank", "traconet").limit(200000),
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

  // ── Conjuntivite: curva epidêmica por SE via cevesp_aggregate ───────────────
  // Aggregate server-side to avoid Supabase's 1000-row default limit when the
  // cache has tens of thousands of rows per year.
  if (agravo !== "conjuntivite" || ano < 2000) {
    return NextResponse.json([]);
  }

  const [casosRes, notifRes, surtosRes, coletasRes, acoesRes] = await Promise.all([
    admin.rpc("cevesp_aggregate", { p_metric: "total_casos",      p_dimension: "se", p_ano_start: ano, p_ano_end: ano, p_lim: 53 }),
    admin.rpc("cevesp_aggregate", { p_metric: "notificacoes",     p_dimension: "se", p_ano_start: ano, p_ano_end: ano, p_lim: 53 }),
    admin.rpc("cevesp_aggregate", { p_metric: "surtos",           p_dimension: "se", p_ano_start: ano, p_ano_end: ano, p_lim: 53 }),
    admin.rpc("cevesp_aggregate", { p_metric: "coletas",          p_dimension: "se", p_ano_start: ano, p_ano_end: ano, p_lim: 53 }),
    admin.rpc("cevesp_aggregate", { p_metric: "acoes_educativas", p_dimension: "se", p_ano_start: ano, p_ano_end: ano, p_lim: 53 }),
  ]);

  if (casosRes.error) return NextResponse.json({ error: casosRes.error.message }, { status: 500 });

  type AggRow = { label: string; valor: number };

  const seMap: Record<number, { notificacoes: number; casos: number; surtos: number; coletas: number; acoes: number }> = {};

  function mergeAgg(data: AggRow[] | null, field: "notificacoes" | "casos" | "surtos" | "coletas" | "acoes") {
    for (const row of data ?? []) {
      const se = Number(row.label);
      if (!se || se > 53) continue;
      if (!seMap[se]) seMap[se] = { notificacoes: 0, casos: 0, surtos: 0, coletas: 0, acoes: 0 };
      seMap[se][field] = Number(row.valor ?? 0);
    }
  }

  mergeAgg(casosRes.data  as AggRow[], "casos");
  mergeAgg(notifRes.data  as AggRow[], "notificacoes");
  mergeAgg(surtosRes.data as AggRow[], "surtos");
  mergeAgg(coletasRes.data as AggRow[], "coletas");
  mergeAgg(acoesRes.data  as AggRow[], "acoes");

  const result = Object.entries(seMap)
    .map(([se, d]) => ({ se: Number(se), ...d, treinamentos: 0, encaminhamentos: 0 }))
    .sort((a, b) => a.se - b.se);

  return NextResponse.json(result);
}
