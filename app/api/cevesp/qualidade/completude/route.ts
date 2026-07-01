import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const CEVESP_FIELD_LABELS: Record<string, string> = {
  ANO: "Ano",
  Mes: "Mês",
  SemEpidemio: "Semana epidemiológica",
  DtNotificacao: "Data de notificação",
  MunicipioNotificacao: "Município de notificação",
  IbgeNotificacao: "Cód. IBGE",
  GVE_NOME: "GVE",
  DRS_NOME: "DRS",
  SUBGRUPOS_VE: "Subgrupo VE",
  Unid_notificacao: "Unidade notificadora",
  UVIS: "UVIS",
  Nome_notificante: "Nome do notificante",
  CargoFuncao: "Cargo/Função",
  TotalCaso: "Total de casos",
  SexMasc: "Sexo masculino",
  SexFem: "Sexo feminino",
  FxMenorUmAno: "Faixa <1 ano",
  FxUmQuatro: "Faixa 1–4 anos",
  FxCincoNove: "Faixa 5–9 anos",
  FxDezQuatorze: "Faixa 10–14 anos",
  FxQuizeOuMais: "Faixa 15+ anos",
  Surto: "Surto",
  NuSurto: "N° surto",
  NuColetaMaterialBio: "N° coleta material biológico",
  ColetaMaterialBio: "Coleta mat. biológico",
  NuAcaoEducativa: "N° ações educativas",
  NuTreinamento: "N° treinamentos",
  AfastamentoProfSintomatico: "Afastamento prof. sintomático",
  NuEncamimento: "N° encaminhamentos",
  MedidaAdotada: "Medida adotada",
};

const cols = Object.keys(CEVESP_FIELD_LABELS);

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

    // Fast path: três RPCs em paralelo — uma passagem no banco por tipo de agregação.
    // Substitui a paginação de 300k linhas × 30 colunas que causava timeout no Vercel.
    const [fieldsRes, gveRes, anoRes] = await Promise.all([
      admin.rpc("cevesp_completude_campos", { p_ano: ano ?? null, p_gve: gve ?? null }),
      admin.rpc("cevesp_completude_gve",    { p_ano: ano ?? null }),
      admin.rpc("cevesp_completude_ano",    { p_gve: gve ?? null }),
    ]);

    if (!fieldsRes.error && fieldsRes.data) {
      const d = fieldsRes.data as Record<string, number>;
      const total = Number(d.total ?? 0);

      const fieldCompleteness: Record<string, { total: number; filled: number; pct: number; label: string }> = {};
      for (const col of cols) {
        const filled = Number(d[col] ?? 0);
        fieldCompleteness[col] = {
          total,
          filled,
          pct: total ? Math.round((filled / total) * 100) : 0,
          label: CEVESP_FIELD_LABELS[col]
        };
      }

      const byGve = (!gveRes.error && Array.isArray(gveRes.data))
        ? (gveRes.data as Array<{ gve: string; total_rows: number; avg_pct: number; critical_fields: number }>)
            .map((r) => ({ gve: r.gve, totalRows: r.total_rows, avgPct: r.avg_pct, criticalFields: r.critical_fields }))
        : [];

      const byYear = (!anoRes.error && Array.isArray(anoRes.data))
        ? (anoRes.data as Array<{ ano: number; total_rows: number; avg_pct: number }>)
            .map((r) => ({ ano: r.ano, totalRows: r.total_rows, avgPct: r.avg_pct }))
        : [];

      return NextResponse.json({ fieldCompleteness, totalRows: total, byGve, byYear });
    }

    // Fallback: paginação lenta (só usado se as RPCs não estiverem deployadas)
    const selectCols = cols.map((c) => `"${c}"`).join(",");
    const pageSize = 1000;
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

    const gveGroups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of allRows) {
      const g = String(row["GVE_NOME"] ?? "").trim() || "Não informado";
      if (!gveGroups.has(g)) gveGroups.set(g, []);
      gveGroups.get(g)!.push(row);
    }
    const byGve = Array.from(gveGroups.entries()).map(([g, rows]) => {
      const fieldPcts = cols.map((col) => {
        const filled = rows.filter((r) => isFilled(r[col])).length;
        return rows.length ? (filled / rows.length) * 100 : 0;
      });
      const avgPct = Math.round(fieldPcts.reduce((a, b) => a + b, 0) / (fieldPcts.length || 1));
      const criticalFields = fieldPcts.filter((p) => p < 70).length;
      return { gve: g, totalRows: rows.length, avgPct, criticalFields };
    }).sort((a, b) => a.avgPct - b.avgPct);

    const yearGroups = new Map<number, Array<Record<string, unknown>>>();
    for (const row of allRows) {
      const raw = String(row["DtNotificacao"] ?? "");
      const year = raw ? new Date(raw).getFullYear() : NaN;
      const key = isNaN(year) ? 0 : year;
      if (!yearGroups.has(key)) yearGroups.set(key, []);
      yearGroups.get(key)!.push(row);
    }
    const byYear = Array.from(yearGroups.entries()).map(([a, rows]) => {
      const fieldPcts = cols.map((col) => {
        const filled = rows.filter((r) => isFilled(r[col])).length;
        return rows.length ? (filled / rows.length) * 100 : 0;
      });
      const avgPct = Math.round(fieldPcts.reduce((a, b) => a + b, 0) / (fieldPcts.length || 1));
      return { ano: a, totalRows: rows.length, avgPct };
    }).sort((a, b) => a.ano - b.ano);

    return NextResponse.json({ fieldCompleteness, totalRows: total, byGve, byYear });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
