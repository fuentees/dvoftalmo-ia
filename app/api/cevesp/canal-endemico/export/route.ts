import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { runEndemicChannel } from "@/services/cevesp-endemic";
import { pickCurrentChannelPoint } from "@/lib/epi-week";

// Zone fill colours (ARGB, no #)
const FILL_SUCESSO  = "FFD1FAE5"; // green-100
const FILL_ALERTA   = "FFFEF3C7"; // amber-100
const FILL_EPIDEMIA = "FFFEE2E2"; // red-100
const FILL_HEADER   = "FF0F766E"; // teal-700
const FILL_SUMMARY  = "FFE0F2FE"; // sky-100

function zoneFill(atual: number | null, q1: number, q3: number) {
  if (atual === null) return undefined;
  if (atual > q3) return FILL_EPIDEMIA;
  if (atual >= q1) return FILL_ALERTA;
  return FILL_SUCESSO;
}

function zonaLabel(atual: number | null, q1: number, q3: number) {
  if (atual === null) return "sem dado";
  if (atual > q3) return "Epidemia";
  if (atual >= q1) return "Alerta";
  return "Sucesso";
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
      return NextResponse.json({ error: "Sem dados para exportar." }, { status: 404 });
    }

    const now    = new Date();
    const scope  = [gve && `GVE: ${gve}`, municipality && `Município: ${municipality}`]
      .filter(Boolean).join(" | ") || "Estado de São Paulo";

    const lastPt     = pickCurrentChannelPoint(data);
    const zonaAtual  = lastPt ? zonaLabel(lastPt.currentIncidence, lastPt.q1, lastPt.q3) : "—";

    // ── Workbook ────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = "CVE/CEVESP — Centro de Oftalmologia Sanitária";
    wb.created  = now;
    wb.modified = now;

    // ── Sheet 1: Canal Endêmico ──────────────────────────────────────────────
    const ws = wb.addWorksheet("Canal Endêmico");
    ws.properties.defaultRowHeight = 16;

    // Title rows
    ws.mergeCells("A1:I1");
    const t1 = ws.getCell("A1");
    t1.value = "CANAL ENDÊMICO — VIGILÂNCIA DAS CONJUNTIVITES — CEVESP/SP";
    t1.font  = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    t1.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEADER } };
    t1.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 22;

    ws.mergeCells("A2:I2");
    const t2 = ws.getCell("A2");
    t2.value = `Gerado em: ${now.toLocaleDateString("pt-BR")}  |  Abrangência: ${scope}  |  Ano de referência: ${year}`;
    t2.font  = { size: 10, italic: true, color: { argb: "FF374151" } };
    t2.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_SUMMARY } };
    t2.alignment = { horizontal: "center" };
    ws.getRow(2).height = 18;

    ws.addRow([]); // spacer

    // Summary row
    ws.mergeCells("A4:I4");
    const summary = ws.getCell("A4");
    summary.value = lastPt
      ? `Última SE observada: ${lastPt.se}  |  Casos: ${lastPt.currentYear}  |  Incidência: ${lastPt.currentIncidence} por 100 mil hab.  |  Zona: ${zonaAtual}  |  Limite inferior=${lastPt.q1}  |  Média=${lastPt.median}  |  Limite superior=${lastPt.q3}`
      : "Sem dados do ano atual disponíveis.";
    summary.font = { bold: true, size: 10 };
    const sumFill = lastPt ? zoneFill(lastPt.currentIncidence, lastPt.q1, lastPt.q3) : FILL_SUMMARY;
    summary.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sumFill ?? FILL_SUMMARY } };
    summary.alignment = { horizontal: "center" };
    ws.getRow(4).height = 18;

    ws.addRow([]); // spacer

    // Header row
    const headerRow = ws.addRow([
      "SE",
      `Casos ${year}`,
      `Incidência ${year} por 100 mil hab.`,
      "Limite inferior incidência (média − 2 DP)",
      "Média histórica incidência",
      "Limite superior incidência (média + 2 DP)",
      "Mín histórico incidência",
      "Máx histórico incidência",
      `Zona ${year}`
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
      const fill = zoneFill(pt.currentIncidence, pt.q1, pt.q3);
      const row = ws.addRow([
        pt.se,
        pt.currentYear ?? null,
        pt.currentIncidence ?? null,
        pt.q1,
        pt.median,
        pt.q3,
        pt.min,
        pt.max,
        zonaLabel(pt.currentIncidence, pt.q1, pt.q3)
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
    addLegendRow("Sucesso", "Incidência abaixo do limite inferior (média − 2 desvios-padrão) — transmissão baixa, controle bem-sucedido.", FILL_SUCESSO);
    addLegendRow("Alerta",  "Incidência entre o limite inferior e o limite superior (média ± 2 desvios-padrão) — monitorar GVEs.", FILL_ALERTA);
    addLegendRow("Epidemia","Incidência acima do limite superior (média + 2 desvios-padrão) — zona epidêmica confirmada, acionar protocolos.", FILL_EPIDEMIA);
    wl.addRow([]);
    wl.addRow(["Metodologia", "Canal endêmico calculado sobre coeficiente de incidência por 100 mil habitantes, com média histórica ± 2 desvios-padrão dos últimos 10 anos por semana epidemiológica, excluindo 2011 e considerando apenas anos com casos registrados."]);
    wl.addRow(["Fonte", "CEVESP — Centro de Vigilância Epidemiológica / Centro de Oftalmologia Sanitária — SES-SP"]);
    wl.addRow(["Exportado em", now.toLocaleString("pt-BR")]);

    // ── Serialize ────────────────────────────────────────────────────────────
    const buffer = await wb.xlsx.writeBuffer();
    const slug   = [gve, municipality].filter(Boolean).join("-").replace(/\s+/g, "_") || "SP";
    const filename = `canal-endemico-conjuntivites-${slug}-${year}.xlsx`;

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
