import { NextRequest, NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/services/ai/prompts";
import { generateCompletion } from "@/services/ai/provider";
import type { AgentKind } from "@/lib/types";

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, (m) => m)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function markdownToParagraphs(text: string): Paragraph[] {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h1 = line.match(/^#\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)/);
    if (h1) {
      paragraphs.push(new Paragraph({ text: h1[1], heading: HeadingLevel.HEADING_1 }));
    } else if (h2) {
      paragraphs.push(new Paragraph({ text: h2[1], heading: HeadingLevel.HEADING_2 }));
    } else if (h3) {
      paragraphs.push(new Paragraph({ text: h3[1], heading: HeadingLevel.HEADING_3 }));
    } else if (bullet) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: `• ${bullet[1]}`, size: 20 })] }));
    } else if (numbered) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })] }));
    } else if (line === "") {
      paragraphs.push(new Paragraph(""));
    } else {
      // inline bold **text**
      const parts = line.split(/(\*\*.*?\*\*)/g);
      const runs = parts.map((p) => {
        const bold = p.match(/^\*\*(.*)\*\*$/);
        return bold
          ? new TextRun({ text: bold[1], bold: true, size: 20 })
          : new TextRun({ text: p, size: 20 });
      });
      paragraphs.push(new Paragraph({ children: runs }));
    }
  }
  return paragraphs;
}

async function generateContent(agent: AgentKind, userPrompt: string): Promise<string> {
  return generateCompletion([
    { role: "system", content: buildSystemPrompt(agent) },
    {
      role: "user",
      content:
        `Gere o documento completo conforme solicitado abaixo. Produza apenas o conteudo final, ` +
        `formatado para exportacao (sem explicacoes ou comentarios adicionais):\n\n${userPrompt}`
    }
  ], { temperature: 0.4 });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title = "Documento", prompt = "", agent = "geral", format = "txt" } = await request.json();

  if (!prompt.trim()) {
    return NextResponse.json({ error: "Informe o que deseja gerar." }, { status: 400 });
  }

  let content: string;
  try {
    content = await generateContent(agent as AgentKind, prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro";
    const isQuota = message.includes("429") || message.includes("quota") || message.includes("insufficient_quota");
    const isNetwork = message.toLowerCase().includes("connection") || message.toLowerCase().includes("fetch failed");
    return NextResponse.json(
      {
        error: isQuota
          ? "Cota do provedor de IA esgotada. Verifique os créditos nas configurações."
          : isNetwork
          ? "Provedor de IA inacessível nesta rede. Tente em outra conexão ou mude o provedor nas configurações."
          : message
      },
      { status: 500 }
    );
  }

  if (format === "docx") {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })] }),
          new Paragraph(""),
          ...markdownToParagraphs(content)
        ]
      }]
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
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const PAGE_W = 595, PAGE_H = 842;
    const MARGIN = 48, LINE_H = 15, TEXT_SIZE = 10, MAX_CHARS = 90;

    const plain = stripMarkdown(content);
    const allLines: string[] = [];
    for (const raw of plain.split("\n")) {
      if (raw.length <= MAX_CHARS) {
        allLines.push(raw);
      } else {
        const words = raw.split(" ");
        let cur = "";
        for (const w of words) {
          if ((cur + " " + w).trim().length > MAX_CHARS) {
            allLines.push(cur.trim());
            cur = w;
          } else {
            cur = cur ? cur + " " + w : w;
          }
        }
        if (cur) allLines.push(cur.trim());
      }
    }

    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    page.drawText(title, { x: MARGIN, y, size: 14, font: boldFont, color: rgb(0.06, 0.45, 0.41) });
    y -= LINE_H * 2;

    for (const line of allLines) {
      if (y < MARGIN + LINE_H) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      if (line) {
        page.drawText(line, { x: MARGIN, y, size: TEXT_SIZE, font });
      }
      y -= LINE_H;
    }

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
