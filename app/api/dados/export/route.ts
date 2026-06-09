import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { DataAnalysisResult, ColumnStats } from "@/lib/types";
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle
} from "docx";

function makeHeaderCell(text: string): TableCell {
  return new TableCell({
    shading: { fill: "0f766e", type: "clear" as never },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })]
    })]
  });
}

function makeCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })]
  });
}

function buildStatsTable(summary: Record<string, ColumnStats>): Table {
  const headerRow = new TableRow({
    children: ["Variavel", "Tipo", "N validos", "Ausentes", "Media", "Mediana", "DP", "Min", "Max"].map(makeHeaderCell)
  });

  const dataRows = Object.entries(summary).map(([col, s]) =>
    new TableRow({
      children: [
        makeCell(col),
        makeCell(s.type),
        makeCell(String(s.count)),
        makeCell(String(s.missing)),
        makeCell(s.mean !== undefined ? String(s.mean) : "—"),
        makeCell(s.median !== undefined ? String(s.median) : "—"),
        makeCell(s.stdDev !== undefined ? String(s.stdDev) : "—"),
        makeCell(s.min !== undefined ? String(s.min) : "—"),
        makeCell(s.max !== undefined ? String(s.max) : "—")
      ]
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 }
    },
    rows: [headerRow, ...dataRows]
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { result: DataAnalysisResult; title?: string; format?: string };
  const { result, title = "Relatorio de Analise de Dados" } = body;

  if (!result) return NextResponse.json({ error: "result obrigatorio." }, { status: 400 });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          text: title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER
        }),
        new Paragraph({
          children: [new TextRun({ text: `Arquivo: ${result.fileName}  |  Registros: ${result.rows}  |  Variaveis: ${result.columns.length}`, size: 18, color: "666666" })]
        }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "Estatisticas Descritivas", heading: HeadingLevel.HEADING_2 }),
        buildStatsTable(result.summary),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "Interpretacao", heading: HeadingLevel.HEADING_2 }),
        ...result.interpretation.map((line) =>
          new Paragraph({ children: [new TextRun({ text: line, size: 20 })] })
        )
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = `${title.replace(/\s+/g, "_")}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`
    }
  });
}
