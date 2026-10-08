import { parseChannelFilters } from "@/lib/cevesp-filters";
import { CHANNEL_METHODOLOGY, CHANNEL_ZONE_LABELS, classifyChannelPoint } from "@/lib/cevesp-channel";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runEndemicChannel } from "@/services/cevesp-endemic";
import { currentCalendarYear, currentCalendarMonth, currentEpiWeek, formatBusinessDate, pickCurrentPoint } from "@/lib/epi-week";

// Zone fill colours (ARGB, no #)
const FILL_SUCESSO  = "FFD1FAE5"; // green-100
const FILL_ALERTA   = "FFFEF3C7"; // amber-100
const FILL_EPIDEMIA = "FFFEE2E2"; // red-100
const FILL_HEADER   = "FF0F766E"; // teal-700
const FILL_SUMMARY  = "FFE0F2FE"; // sky-100

function zoneFill(point: Parameters<typeof classifyChannelPoint>[0]) {
  const zone = classifyChannelPoint(point);
  return zone === "acima" ? FILL_EPIDEMIA : zone === "esperado" ? FILL_ALERTA : zone === "abaixo" ? FILL_SUCESSO : undefined;
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
      return NextResponse.json({ error: "Sem dados para exportar." }, { status: 404 });
    }

    const now    = new Date();
    const scope  = [gve && `GVE: ${gve}`, municipality && `Município: ${municipality}`]
      .filter(Boolean).join(" | ") || "Estado de São Paulo";

    const lastPt     = pickCurrentPoint(data, year < currentCalendarYear() ? (grain === "month" ? 12 : 53) : year > currentCalendarYear() ? 0 : grain === "month" ? currentCalendarMonth() : currentEpiWeek().se);
    const zonaAtual  = lastPt ? CHANNEL_ZONE_LABELS[classifyChannelPoint(lastPt)] : "—";

    // ── Workbook ────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = "CVE/CEVESP — Centro de Oftalmologia Sanitária";
    wb.created  = now;
    wb.modified = now;

    // ── Sheet 1: Canal Endêmico ──────────────────────────────────────────────
    const ws = wb.addWorksheet("Canal Endêmico");
    ws.properties.defaultRowHeight = 16;

    // Title rows
    ws.mergeCells("A1:M1");
    const t1 = ws.getCell("A1");
    t1.value = "CANAL ENDÊMICO — VIGILÂNCIA DAS CONJUNTIVITES — CEVESP/SP";
    t1.font  = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    t1.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
    t1.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 22;

    ws.mergeCells("A2:M2");
    const t2 = ws.getCell("A2");
    t2.value = `Gerado em: ${formatBusinessDate(now)}  |  Abrangência: ${scope}  |  Ano de referência: ${year}`;
    t2.font  = { size: 10, italic: true, color: { argb: "FF374151" } };
    t2.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_SUMMARY } };
    t2.alignment = { horizontal: "center" };
    ws.getRow(2).height = 18;

    ws.addRow([]); // spacer

    // Summary row
    ws.mergeCells("A4:M4");
    const summary = ws.getCell("A4");
    summary.value = lastPt
      ? `Último período observado: ${lastPt.se}  |  Casos: ${lastPt.currentYear ?? "—"}  |  Incidência: ${lastPt.currentIncidence ?? "—"} por 100 mil hab.  |  Zona: ${zonaAtual}  |  Limite inferior=${lastPt.baselineValid ? lastPt.q1 : "—"}  |  Média=${lastPt.baselineValid ? lastPt.median : "—"}  |  Limite superior=${lastPt.baselineValid ? lastPt.q3 : "—"}`
      : "Sem dados do ano atual disponíveis.";
    summary.font = { bold: true, size: 10 };
    const sumFill = lastPt ? zoneFill(lastPt) : FILL_SUMMARY;
    summary.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sumFill ?? FILL_SUMMARY } };
    summary.alignment = { horizontal: "center" };
    ws.getRow(4).height = 18;

    ws.addRow([]); // spacer

    // Header row
    const headerRow = ws.addRow([
      bucketLabel,
      `Casos ${year}`,
      `Incidência ${year} por 100 mil hab.`,
      "Limite inferior incidência (média − 2 DP)",
      "Média histórica incidência",
      "Limite superior incidência (média + 2 DP)",
      "Mín histórico incidência",
      "Máx histórico incidência",
      `Zona ${year}`,
      "Anos históricos válidos",
      "Anos com contagem inválida",
      "Registros atuais com contagem inválida",
      "Ano da população atual"
    ]);
    headerRow.eachCell((cell) => {
      cell.font  = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
      cell.alignment = { horizontal: "center" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FF0F766E" } }
      };
    });
    ws.getRow(headerRow.number).height = 18;

    // Data rows
    for (const pt of data) {
      const fill = zoneFill(pt);
      const row = ws.addRow([
        pt.se,
        pt.currentYear ?? null,
        pt.currentIncidence ?? null,
        pt.baselineValid ? pt.q1 : null,
        pt.baselineValid ? pt.median : null,
        pt.baselineValid ? pt.q3 : null,
        pt.baselineValid ? pt.min : null,
        pt.baselineValid ? pt.max : null,
        CHANNEL_ZONE_LABELS[classifyChannelPoint(pt)],
        pt.baselineCount,
        pt.invalidBaselineYears,
        pt.invalidCurrentCaseRecords,
        pt.populationYear
      ]);
      if (fill) {
        const dataCell = row.getCell(2); // "Casos" column
        const zonaCell = row.getCell(9); // "Zona" column
        dataCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        zonaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
      row.eachCell((cell) => {
        cell.alignment = { horizontal: "center" };
        cell.font = { size: 10 };
      });
    }

    // Column widths
    ws.getColumn(1).width = 8;   // SE
    ws.getColumn(2).width = 14;  // Casos
    ws.getColumn(3).width = 20;  // Incidencia
    ws.getColumn(4).width = 24;  // Limite inferior
    ws.getColumn(5).width = 22;  // Média
    ws.getColumn(6).width = 24;  // Limite superior
    ws.getColumn(7).width = 20;  // Min
    ws.getColumn(8).width = 20;  // Max
    ws.getColumn(9).width = 14;  // Zona
    ws.getColumn(10).width = 24;
    ws.getColumn(11).width = 28;
    ws.getColumn(12).width = 34;
    ws.getColumn(13).width = 24;

    // ── Sheet 2: Legenda ─────────────────────────────────────────────────────
    const wl = wb.addWorksheet("Legenda");
    wl.getColumn(1).width = 20;
    wl.getColumn(2).width = 60;

    const addLegendRow = (zona: string, desc: string, fillColor: string) => {
      const r = wl.addRow([zona, desc]);
      r.getCell(1).font = { bold: true, size: 10 };
      r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      r.getCell(2).font = { size: 10 };
      r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      r.height = 18;
    };

    wl.addRow(["LEGENDA DAS ZONAS DO CANAL ENDÊMICO"]).getCell(1).font = { bold: true, size: 12 };
    wl.addRow([]);
    wl.addRow(["Zona", "Descrição"]).eachCell((c) => { c.font = { bold: true }; });
    addLegendRow("Abaixo", "Incidência abaixo da faixa histórica. Pode refletir subnotificação; não confirma sucesso do controle.", FILL_SUCESSO);
    addLegendRow("Dentro", "Incidência dentro da faixa histórica.", FILL_ALERTA);
    addLegendRow("Acima", "Incidência acima da faixa histórica; requer investigação e não confirma epidemia.", FILL_EPIDEMIA);
    wl.addRow([]);
    wl.addRow(["Metodologia", CHANNEL_METHODOLOGY]);
    wl.addRow(["Qualidade", "Contagem ausente, negativa ou fracionária invalida o período antes da soma. Esses grupos não compõem o histórico; zero informado permanece válido."]);
    wl.addRow(["População", "O ano efetivo do denominador atual aparece na primeira aba. Pode ser substituto quando não há população do ano solicitado."]);
    wl.addRow(["Fonte", "CEVESP — Centro de Vigilância Epidemiológica / Centro de Oftalmologia Sanitária — SES-SP"]);
    wl.addRow(["Exportado em", formatBusinessDate(now)]);

    // ── Serialize ────────────────────────────────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer();
    const slug   = [gve, municipality].filter(Boolean).join("-").replace(/[^a-zA-Z0-9_-]/g, "_") || "SP";
    const filename = `canal-endemico-conjuntivites-${slug}-${year}-${grain}.xlsx`;

    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao exportar XLSX." },
      { status: 500 }
    );
  }
}
