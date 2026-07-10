import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { chatSchema } from "@/lib/validation/domain";
import { streamWithTools, toolLabel } from "@/services/ai/stream-tools";
import type { AiSource } from "@/lib/types";
import type { ChartData } from "@/services/ai/chart-utils";
import type { ModelMessage } from "ai";

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
    .select("id,title,agent,updated_at,is_favorite")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("is_favorite", { ascending: false })
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

  // Resolve user's preferred model (non-blocking; falls back to global config on error)
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("selected_model")
    .eq("id", user.id)
    .single();
  const userModel: string | null = profileRow?.selected_model ?? null;

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
    // ── Streaming com tool-calling via AI SDK, unificado para todos os agentes ──
    // Cada agente recebe seu próprio subconjunto de ferramentas (services/ai/stream-tools.ts);
    // o modelo decide quando consultar CEVESP/tracoma/documentos em vez de um regex
    // pré-filtrar o contexto antes da chamada.
    const conversationMessages: ModelMessage[] = [
      ...(previous ?? [])
        .filter((item: { role: string }) => item.role !== "system")
        .map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      { role: "user", content: body.message },
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let fullAnswer = "";
        let sources: AiSource[] = [];
        let chartData: ChartData | undefined;
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          for await (const event of streamWithTools({
            userId: user.id,
            agent: body.agent,
            messages: conversationMessages,
            userModel,
          })) {
            if (event.type === "chunk") {
              fullAnswer += event.text;
              send({ t: "c", v: event.text });
            } else if (event.type === "tool_call") {
              send({ t: "tool_call", name: event.name, label: toolLabel(event.name) });
            } else if (event.type === "tool_done") {
              send({ t: "tool_done", name: event.name });
            } else if (event.type === "chart") {
              chartData = event.chart;
            } else if (event.type === "sources") {
              sources = event.sources;
            }
          }
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            user_id: user.id,
            role: "assistant",
            content: fullAnswer || "Não foi possível gerar uma resposta.",
            sources,
          });
          await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
          send({ t: "done", conversationId, sources, chartData });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isQuota = msg.includes("429") || msg.includes("quota") || msg.includes("insufficient_quota");
          send({ t: "err", e: isQuota ? "Cota esgotada. Verifique os créditos do provedor ativo." : msg });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
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

  const body = await request.json() as {
    conversationId: string;
    title?: string;
    is_favorite?: boolean;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {};
  if (body.title !== undefined)      patch.title       = body.title;
  if (body.is_favorite !== undefined) patch.is_favorite = body.is_favorite;
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nenhum campo para atualizar." }, { status: 400 });

  const { error } = await supabase
    .from("conversations")
    .update(patch)
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
