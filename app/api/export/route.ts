import { NextRequest, NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/services/ai/prompts";
import { generateCompletion } from "@/services/ai/provider";
import type { AgentKind } from "@/lib/types";

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
    return NextResponse.json(
      { error: isQuota ? "Cota da OpenAI esgotada. Adicione créditos em platform.openai.com/account/billing." : message },
      { status: 500 }
    );
  }

  if (format === "docx") {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 28 })] }),
          new Paragraph(""),
          ...content.split("\n").map((line) => new Paragraph(line))
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
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(title, { x: 48, y: 790, size: 16, font, color: rgb(0.06, 0.45, 0.41) });
    content.slice(0, 3500).split("\n").forEach((line, index) => {
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
