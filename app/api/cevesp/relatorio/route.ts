import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runEndemicChannel } from "@/services/cevesp-endemic";
import { pickCurrentChannelPoint } from "@/lib/epi-week";

function seZone(atual: number | null, q1: number, q3: number): string {
  if (atual === null) return "sem dado";
  if (atual > q3) return "epidemia";
  if (atual >= q1) return "alerta";
  return "sucesso";
}

function csvRow(cells: (string | number | null)[]): string {
  return cells
    .map((c) => {
      const s = c === null || c === undefined ? "" : String(c);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gve          = request.nextUrl.searchParams.get("gve")          ?? undefined;
  const municipality = request.nextUrl.searchParams.get("municipality") ?? undefined;
  const yearParam    = request.nextUrl.searchParams.get("year");
  const year         = yearParam ? Number(yearParam) : new Date().getFullYear();

  try {
    const data = await runEndemicChannel({ gve, municipality, year });
    if (!data.length) {
      return NextResponse.json({ error: "Sem dados para gerar relatório." }, { status: 404 });
    }

    const now      = new Date();
    const dateStr  = now.toLocaleDateString("pt-BR");
    const lastPt = pickCurrentChannelPoint(data);
    const lastSE = lastPt?.se ?? null;
    const zona   = lastPt ? seZone(lastPt.currentIncidence, lastPt.q1, lastPt.q3) : "sem dado";

    const scope = [gve && `GVE: ${gve}`, municipality && `Município: ${municipality}`]
      .filter(Boolean)
      .join(" | ") || "Estado de São Paulo";

    const lines: string[] = [];

    // ── Cabeçalho institucional ──────────────────────────────────────────────
    lines.push(csvRow(["CENTRO DE VIGILÂNCIA EPIDEMIOLÓGICA — CVE/CEVESP"]));
    lines.push(csvRow(["Relatório de Vigilância das Conjuntivites"]));
    lines.push(csvRow([`Gerado em: ${dateStr}`]));
    lines.push(csvRow([`Abrangência: ${scope}`]));
    lines.push(csvRow([`Ano de referência: ${year}`]));
    lines.push(csvRow(["Canal endêmico calculado sobre coeficiente de incidência por 100 mil habitantes: limite inferior = média − 1 desvio-padrão; limite superior = média + 2 desvios-padrão dos últimos 10 anos (por SE), excluindo 2011, 2021 e 2022 e considerando apenas anos com casos registrados."]));
    lines.push("");

    // ── KPIs da última SE ────────────────────────────────────────────────────
    lines.push(csvRow(["RESUMO — ÚLTIMA SEMANA OBSERVADA"]));
    lines.push(csvRow(["SE atual", "Casos", "Incidência por 100 mil hab.", "Limite inferior", "Média histórica", "Limite superior", "Zona"]));
    if (lastSE && lastPt) {
      lines.push(csvRow([
        lastSE,
        lastPt.currentYear,
        lastPt.currentIncidence,
        lastPt.q1,
        lastPt.median,
        lastPt.q3,
        zona,
      ]));
    }
    lines.push("");

    // ── Tabela completa por SE ────────────────────────────────────────────────
    lines.push(csvRow(["SÉRIE TEMPORAL POR SEMANA EPIDEMIOLÓGICA"]));
    lines.push(csvRow(["SE", "Casos " + year, "Incidência " + year + " por 100 mil hab.", "Limite inferior incidência (média − 1 DP)", "Média histórica incidência", "Limite superior incidência (média + 2 DP)", "Mínimo histórico incidência", "Máximo histórico incidência", "Zona " + year]));
    for (const pt of data) {
      lines.push(csvRow([
        pt.se,
        pt.currentYear,
        pt.currentIncidence,
        pt.q1,
        pt.median,
        pt.q3,
        pt.min,
        pt.max,
        seZone(pt.currentIncidence, pt.q1, pt.q3),
      ]));
    }

    const csv  = lines.join("\r\n");
    const slug = [gve, municipality].filter(Boolean).join("-").replace(/\s+/g, "_") || "SP";
    const filename = `relatorio-conjuntivites-${slug}-${year}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao gerar relatório." },
      { status: 500 }
    );
  }
}
