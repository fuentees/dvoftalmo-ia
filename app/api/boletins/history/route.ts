import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agravo = searchParams.get("agravo");
  const ano = Number(searchParams.get("ano") ?? 0);

  const admin = createAdminClient();

  // ── Tracoma: série histórica por ano — agrega no banco para evitar row-limit ──
  if (agravo === "tracoma") {
    const [notRes, tracRes] = await Promise.all([
      admin.rpc("nottraconet_history_by_year"),
      admin.rpc("traconet_history_by_year"),
    ]);

    if (notRes.error) return NextResponse.json({ error: notRes.error.message }, { status: 500 });
    if (tracRes.error) return NextResponse.json({ error: tracRes.error.message }, { status: 500 });

    type NotRow  = { ano: number; munis: number; exam: number; pos: number };
    type TracRow = { ano: number; total: number; tf: number; ti: number; ts: number; tt: number; co: number };

    const notByYear: Record<number, NotRow>  = {};
    for (const r of (notRes.data ?? []) as NotRow[])  notByYear[r.ano]  = r;

    const tracByYear: Record<number, TracRow> = {};
    for (const r of (tracRes.data ?? []) as TracRow[]) tracByYear[r.ano] = r;

    const currentYear = new Date().getFullYear();
    const allYears = new Set([...Object.keys(notByYear), ...Object.keys(tracByYear)].map(Number));
    const result = Array.from(allYears)
      .filter(a => a >= 1990 && a <= currentYear)
      .sort((a, b) => a - b)
      .map(a => {
        const not  = notByYear[a]  ?? { munis: 0, exam: 0, pos: 0 };
        const trac = tracByYear[a] ?? { total: 0, tf: 0, ti: 0, ts: 0, tt: 0, co: 0 };
        return {
          ano: a,
          munis: Number(not.munis),
          examinados: Number(not.exam),
          positivos: Number(not.pos),
          prevalencia: Number(not.exam) > 0 ? (Number(not.pos) / Number(not.exam)) * 100 : 0,
          traconet: Number(trac.total),
          tf: Number(trac.tf),
          ti: Number(trac.ti),
          ts: Number(trac.ts),
          tt: Number(trac.tt),
          co: Number(trac.co),
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
