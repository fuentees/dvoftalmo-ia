import { NextRequest, NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function POST(request: NextRequest) {
  const { title = "Documento", content = "", format = "txt" } = await request.json();

  if (format === "docx") {
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 28 })] }), ...content.split("\n").map((line: string) => new Paragraph(line))] }]
    });
    const buffer = await Packer.toBuffer(doc);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${title}.docx"`
      }
    });
  }

  if (format === "pdf") {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(title, { x: 48, y: 790, size: 16, font, color: rgb(0.06, 0.45, 0.41) });
    content.slice(0, 3500).split("\n").forEach((line: string, index: number) => {
      page.drawText(line.slice(0, 95), { x: 48, y: 750 - index * 16, size: 10, font });
    });
    const bytes = await pdf.save();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${title}.pdf"`
      }
    });
  }

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${title}.txt"`
    }
  });
}
