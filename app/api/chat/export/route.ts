import { NextRequest, NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user     = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  const format         = request.nextUrl.searchParams.get("format") ?? "txt";
  if (!conversationId) return NextResponse.json({ error: "conversationId obrigatório." }, { status: 400 });

  const { data: conv } = await supabase
    .from("conversations").select("title,agent").eq("id", conversationId).single();
  const { data: msgs } = await supabase
    .from("messages").select("role,content,created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: true });

  if (!msgs?.length) return NextResponse.json({ error: "Conversa vazia." }, { status: 404 });

  const title = conv?.title ?? "Conversa";
  const lines = msgs.map((m: { role: string; content: string; created_at: string }) => {
    const who  = m.role === "user" ? "Você" : "IA";
    const ts   = new Date(m.created_at).toLocaleString("pt-BR");
    return `[${who}] ${ts}\n${m.content}`;
  });

  if (format === "txt") {
    const body = `${title}\n${"=".repeat(title.length)}\n\n` + lines.join("\n\n---\n\n");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${title}.txt"`
      }
    });
  }

  if (format === "docx") {
    const children: Paragraph[] = [
      new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
      new Paragraph("")
    ];
    for (const m of msgs as Array<{ role: string; content: string; created_at: string }>) {
      const who = m.role === "user" ? "Você" : "Assistente IA";
      children.push(new Paragraph({ children: [new TextRun({ text: `${who}:`, bold: true, size: 20 })] }));
      for (const line of m.content.split("\n")) {
        children.push(new Paragraph({ children: [new TextRun({ text: line, size: 20 })] }));
      }
      children.push(new Paragraph(""));
    }
    const doc = new Document({ sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${title}.docx"`
      }
    });
  }

  if (format === "pdf") {
    const pdf    = await PDFDocument.create();
    const font   = await pdf.embedFont(StandardFonts.Helvetica);
    const bold   = await pdf.embedFont(StandardFonts.HelveticaBold);
    const W = 595, H = 842, M = 48, LH = 14, TS = 9.5;
    let page = pdf.addPage([W, H]);
    let y    = H - M;

    page.drawText(title, { x: M, y, size: 14, font: bold, color: rgb(0.06, 0.45, 0.41) });
    y -= LH * 2;

    for (const m of msgs as Array<{ role: string; content: string; created_at: string }>) {
      const who = m.role === "user" ? "Você" : "Assistente IA";
      if (y < M + LH * 2) { page = pdf.addPage([W, H]); y = H - M; }
      page.drawText(`${who}:`, { x: M, y, size: TS, font: bold, color: rgb(0.1, 0.1, 0.1) });
      y -= LH;
      for (const raw of m.content.split("\n")) {
        const words = raw.split(" ");
        let cur = "";
        const wrapped: string[] = [];
        for (const w of words) {
          if ((cur + " " + w).trim().length > 90) { wrapped.push(cur.trim()); cur = w; }
          else cur = cur ? cur + " " + w : w;
        }
        if (cur) wrapped.push(cur.trim());
        for (const wl of wrapped) {
          if (y < M + LH) { page = pdf.addPage([W, H]); y = H - M; }
          if (wl) page.drawText(wl, { x: M, y, size: TS, font });
          y -= LH;
        }
      }
      y -= LH * 0.5;
    }
    const bytes = await pdf.save();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${title}.pdf"`
      }
    });
  }

  return NextResponse.json({ error: "Formato inválido." }, { status: 400 });
}
