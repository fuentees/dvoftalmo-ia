import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const CEVESP_FIELD_LABELS: Record<string, string> = {
  DtNotificacao: "Data de notificação",
  SemEpidemio: "Semana epidemiológica",
  MunicipioNotificacao: "Município",
  GVE_NOME: "GVE",
  TotalCaso: "Total de casos",
  FxMenorUmAno: "Faixa <1 ano",
  FxUmQuatro: "Faixa 1–4 anos",
  FxCincoNove: "Faixa 5–9 anos",
  FxDezQuatorze: "Faixa 10–14 anos",
  FxQuizeOuMais: "Faixa 15+ anos",
  SexMasc: "Sexo masculino",
  SexFem: "Sexo feminino"
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const anoParam = searchParams.get("ano");
    const ano = anoParam ? Number(anoParam) : undefined;
    const gve = searchParams.get("gve") ?? undefined;

    const admin = createAdminClient();
    const cols = Object.keys(CEVESP_FIELD_LABELS);
    const selectCols = cols.map((c) => `"${c}"`).join(",");
    const pageSize = 2000;
    const allRows: Array<Record<string, unknown>> = [];

    for (let from = 0; ; from += pageSize) {
      let q = admin
        .from("cevesp_notificacoes")
        .select(selectCols)
        .range(from, from + pageSize - 1);
      if (ano) q = q.eq('"ANO"', ano) as typeof q;
      if (gve) q = q.eq('"GVE_NOME"', gve) as typeof q;
      const { data, error } = await q;
      if (error) throw new Error(`Erro de completude: ${error.message}`);
      allRows.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
      if (!data || data.length < pageSize) break;
    }

    const total = allRows.length;

    function isFilled(v: unknown) {
      return v !== null && v !== undefined && String(v).trim() !== "";
    }

    const fieldCompleteness: Record<string, { total: number; filled: number; pct: number; label: string }> = {};
    for (const col of cols) {
      const filled = allRows.filter((r) => isFilled(r[col])).length;
      fieldCompleteness[col] = {
        total,
        filled,
        pct: total ? Math.round((filled / total) * 100) : 0,
        label: CEVESP_FIELD_LABELS[col]
      };
    }

    // byGve: group by GVE_NOME, compute avg fill rate across all tracked cols
    const gveGroups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of allRows) {
      const gve = String(row["GVE_NOME"] ?? "").trim() || "Não informado";
      if (!gveGroups.has(gve)) gveGroups.set(gve, []);
      gveGroups.get(gve)!.push(row);
    }
    const byGve = Array.from(gveGroups.entries()).map(([gve, rows]) => {
      const fieldPcts = cols.map((col) => {
        const filled = rows.filter((r) => isFilled(r[col])).length;
        return rows.length ? (filled / rows.length) * 100 : 0;
      });
      const avgPct = Math.round(fieldPcts.reduce((a, b) => a + b, 0) / (fieldPcts.length || 1));
      const criticalFields = fieldPcts.filter((p) => p < 70).length;
      return { gve, totalRows: rows.length, avgPct, criticalFields };
    }).sort((a, b) => a.avgPct - b.avgPct);

    // byYear: group by year extracted from DtNotificacao
    const yearGroups = new Map<number, Array<Record<string, unknown>>>();
    for (const row of allRows) {
      const raw = String(row["DtNotificacao"] ?? "");
      const year = raw ? new Date(raw).getFullYear() : NaN;
      const key = isNaN(year) ? 0 : year;
      if (!yearGroups.has(key)) yearGroups.set(key, []);
      yearGroups.get(key)!.push(row);
    }
    const byYear = Array.from(yearGroups.entries()).map(([ano, rows]) => {
      const fieldPcts = cols.map((col) => {
        const filled = rows.filter((r) => isFilled(r[col])).length;
        return rows.length ? (filled / rows.length) * 100 : 0;
      });
      const avgPct = Math.round(fieldPcts.reduce((a, b) => a + b, 0) / (fieldPcts.length || 1));
      return { ano, totalRows: rows.length, avgPct };
    }).sort((a, b) => a.ano - b.ano);

    return NextResponse.json({ fieldCompleteness, totalRows: total, byGve, byYear });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
