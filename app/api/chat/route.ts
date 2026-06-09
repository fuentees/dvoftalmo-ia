import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { chatSchema } from "@/lib/validation/domain";
import { answerWithRag } from "@/services/ai/rag";
import { runCevespAnalysis } from "@/services/cevesp-analytics";
import { runTracomaContextQuery } from "@/services/tracoma-analytics";
import { runCosAgent } from "@/services/cos-agent";
import { buildAnalysisContext } from "@/services/data-analysis";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");

  if (conversationId) {
    const { data, error } = await supabase
      .from("messages")
      .select("id,role,content,sources,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const search = request.nextUrl.searchParams.get("search") ?? "";
  let query = supabase
    .from("conversations")
    .select("id,title,agent,updated_at")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("updated_at", { ascending: false });

  if (search) query = query.ilike("title", `%${search}%`);
  const { data, error } = await query.limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = chatSchema.parse(await request.json());
  let conversationId = body.conversationId;

  if (!conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: body.message.slice(0, 80), agent: body.agent })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversationId = data.id;
  }

  const { data: previous } = await supabase
    .from("messages")
    .select("role,content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(10);

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "user",
    content: body.message
  });

  try {
  // ── Agente COS: loop real com ferramentas ─────────────────────────────────
  if (body.agent === "cos") {
    const cosResult = await runCosAgent({
      userId: user.id,
      message: body.message,
      conversationMessages: (previous ?? []).filter((item: { role: string }) => item.role !== "system")
    });

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "assistant",
      content: cosResult.answer,
      sources: cosResult.sources
    });

    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    return NextResponse.json({ conversationId, ...cosResult });
  }

  // ── Contextos em tempo real para agentes especializados ───────────────────
  let cevespContext: string | undefined;
  let tracomaContext: string | undefined;
  let dataContext: string | undefined;

  await Promise.allSettled([
    (async () => {
      if (body.agent === "epidemiologico") {
        const result = await runCevespAnalysis(body.message);
        if (result.rows && result.rows.length > 0) {
          const rows = result.rows.slice(0, 40);
          const header = (result.columns ?? Object.keys(rows[0] ?? {})).join(" | ");
          const bodyRows = rows.map((row: Record<string, unknown>) => Object.values(row).join(" | ")).join("\n");
          const interp = Array.isArray(result.interpretation) ? result.interpretation.join("\n") : "";
          cevespContext =
            `Metrica: ${result.metricLabel ?? ""}\nPeriodo: ${result.timeLabel ?? ""}\n\n${header}\n${bodyRows}` +
            (interp ? `\n\nInterpretacao automatica:\n${interp}` : "");
        }
      }
    })(),
    (async () => {
      if (body.agent === "tracoma") {
        const result = await runTracomaContextQuery(body.message);
        tracomaContext = result.summary;
      }
    })(),
    (async () => {
      if (body.agent === "dados" && body.fileIds && body.fileIds.length > 0) {
        const { data: files } = await supabase
          .from("documents")
          .select("title,file_name")
          .in("id", body.fileIds)
          .limit(3);
        if (files && files.length > 0) {
          dataContext = files.map((f: { title: string; file_name: string }) =>
            `Documento indexado: ${f.title ?? f.file_name}`
          ).join("\n");
        }
      }
    })()
  ]);

  const result = await answerWithRag({
    userId: user.id,
    message: body.message,
    agent: body.agent,
    conversationMessages: (previous ?? []).filter((item: { role: string }) => item.role !== "system"),
    cevespContext,
    tracomaContext,
    dataContext
  });

  await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "assistant",
    content: result.answer,
    sources: result.sources
  });

  await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  return NextResponse.json({ conversationId, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/chat] Erro:", message);
    const isQuota = message.includes("429") || message.includes("quota") || message.includes("insufficient_quota");
    return NextResponse.json(
      { error: isQuota ? "Cota esgotada. Verifique os créditos do provedor ativo." : message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { error } = await supabase
    .from("conversations")
    .update({ title: body.title })
    .eq("id", body.conversationId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "conversationId obrigatorio" }, { status: 400 });

  const { error } = await supabase
    .from("conversations")
    .update({ archived: true })
    .eq("id", conversationId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
