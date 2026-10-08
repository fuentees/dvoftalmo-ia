import { parseChannelFilters } from "@/lib/cevesp-filters";
import { CHANNEL_METHODOLOGY, CHANNEL_ZONE_LABELS, classifyChannelPoint } from "@/lib/cevesp-channel";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runEndemicChannel } from "@/services/cevesp-endemic";
import { currentCalendarYear, currentCalendarMonth, currentEpiWeek, formatBusinessDate, pickCurrentPoint } from "@/lib/epi-week";

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

  let filters;
  try { filters = parseChannelFilters(request.nextUrl.searchParams); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const { gve, municipality, grain } = filters;
  const year = filters.year ?? currentCalendarYear();
  const bucketLabel = grain === "month" ? "Mês" : "SE";

  try {
    const data = await runEndemicChannel({ gve, municipality, year, grain });
    if (!data.length) {
      return NextResponse.json({ error: "Sem dados para gerar relatório." }, { status: 404 });
    }

    const dateStr  = formatBusinessDate();
    const lastPt = pickCurrentPoint(data, year < currentCalendarYear() ? (grain === "month" ? 12 : 53) : year > currentCalendarYear() ? 0 : grain === "month" ? currentCalendarMonth() : currentEpiWeek().se);
    const lastSE = lastPt?.se ?? null;
    const zona   = lastPt ? CHANNEL_ZONE_LABELS[classifyChannelPoint(lastPt)] : "sem dado";

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
    lines.push(csvRow([CHANNEL_METHODOLOGY]));
    lines.push("");

    // ── KPIs da última SE ────────────────────────────────────────────────────
    lines.push(csvRow(["RESUMO — ÚLTIMO PERÍODO OBSERVADO"]));
    lines.push(csvRow([bucketLabel, "Casos", "Incidência por 100 mil hab.", "Limite inferior", "Média histórica", "Limite superior", "Zona"]));
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
    lines.push(csvRow([grain === "month" ? "SÉRIE TEMPORAL MENSAL" : "SÉRIE TEMPORAL SEMANAL"]));
    lines.push(csvRow([bucketLabel, "Casos " + year, "Incidência " + year + " por 100 mil hab.", "Limite inferior incidência (média − 2 DP)", "Média histórica incidência", "Limite superior incidência (média + 2 DP)", "Mínimo histórico incidência", "Máximo histórico incidência", "Zona " + year]));
    for (const pt of data) {
      lines.push(csvRow([
        pt.se,
        pt.currentYear,
        pt.currentIncidence,
        pt.baselineValid ? pt.q1 : null,
        pt.baselineValid ? pt.median : null,
        pt.baselineValid ? pt.q3 : null,
        pt.baselineValid ? pt.min : null,
        pt.baselineValid ? pt.max : null,
        CHANNEL_ZONE_LABELS[classifyChannelPoint(pt)],
      ]));
    }

    const csv  = lines.join("\r\n");
    const slug = [gve, municipality].filter(Boolean).join("-").replace(/[^a-zA-Z0-9_-]/g, "_") || "SP";
    const filename = `relatorio-conjuntivites-${slug}-${year}-${grain}.csv`;

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
