import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { chatSchema } from "@/lib/validation/domain";
import { streamRagAnswer } from "@/services/ai/rag";
import { runCevespAnalysis } from "@/services/cevesp-analytics";
import { runTracomaContextQuery } from "@/services/tracoma-analytics";
import { runSinanTracomaContextQuery } from "@/services/sinan-tracoma";
import { runCosAgent } from "@/services/cos-agent";
import type { AiSource } from "@/lib/types";

export type ChartData = {
  chartType: "bar" | "area" | "pie";
  title: string;
  data: Array<{ label: string; value: number }>;
};

const LABEL_RE  = /gve|municipio|munic|drs|uvis|nome|semana|se\b|ano|mes|subgrupo/i;
const VALUE_RE  = /total|casos|caso|count|coleta|surto|trein|acao|afasta|enca|faixa|sex/i;
const CODE_RE   = /ibge|codigo|cnes|numero|^id$/i;
const TIME_RE   = /semana|se\b|ano|mes/i;
const CEVESP_RE = /\b(cevesp|conjuntivite|conjuntivites|notificac|surto|surtos|gve|drs|uvis|semana epidemiologica|se\s*\d+|total de casos|casos por|municipio|munic[ií]pio|faixa etaria|idade|sexo|masculino|feminino|coleta|material biologico|acao educativa|atividade educativa|treinamento|afastamento|encaminhamento|unidade notificadora|cnes)\b/i;
const SINAN_TRACOMA_RE = /\b(sinan|traconet|nottraconet|nottraconect|banco de tracoma|agravo|tracoma)\b/i;

function shouldQueryCevesp(agent: string, message: string) {
  if (agent === "epidemiologico" || agent === "cos") return true;
  return CEVESP_RE.test(message);
}

function extractChartData(
  rows: Record<string, unknown>[],
  columns: string[],
  metricLabel: string,
  timeLabel: string
): ChartData | null {
  if (rows.length < 2) return null;

  const safe = columns.filter(c => !CODE_RE.test(c));
  let labelCol = safe.find(c => LABEL_RE.test(c));
  let valueCol = safe.find(c => VALUE_RE.test(c) && c !== labelCol);

  if (!labelCol) labelCol = safe.find(c => typeof rows[0]?.[c] === "string") ?? safe[0];
  if (!valueCol) valueCol = safe.find(c => c !== labelCol && typeof rows[0]?.[c] === "number") ?? safe[1];
  if (!labelCol || !valueCol) return null;

  const data = rows
    .slice(0, 12)
    .map(r => ({ label: String(r[labelCol!] ?? ""), value: Number(r[valueCol!] ?? 0) }))
    .filter(d => d.label && !isNaN(d.value) && d.value > 0);

  if (data.length < 2) return null;

  const isTime   = TIME_RE.test(labelCol);
  const chartType = isTime ? "area" : data.length <= 5 ? "pie" : "bar";

  return { chartType, title: `${metricLabel} — ${timeLabel}`, data };
}

function formatCevespContext(result: {
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  metricLabel?: string;
  timeLabel?: string;
  interpretation?: string[];
  understanding?: {
    metric?: string;
    period?: string;
    temporalGrouping?: string;
    dimensions?: string[];
    filters?: string[];
    source?: string;
    warnings?: string[];
  };
  fromCache?: boolean;
}) {
  const rows = result.rows ?? [];
  const cols = result.columns ?? Object.keys(rows[0] ?? {});
  const header = cols.length > 0 ? cols.join(" | ") : "";
  const bodyRows = rows.slice(0, 60).map((row) => cols.map((col) => row[col]).join(" | ")).join("\n");
  const interpretation = Array.isArray(result.interpretation) ? result.interpretation.join("\n") : "";
  const understanding = result.understanding
    ? [
        `Fonte: ${result.understanding.source ?? (result.fromCache ? "Cache Supabase CEVESP" : "CEVESP")}`,
        `Indicador entendido: ${result.understanding.metric ?? result.metricLabel ?? ""}`,
        `Periodo entendido: ${result.understanding.period ?? result.timeLabel ?? ""}`,
        `Agrupamento: ${result.understanding.temporalGrouping ?? ""}`,
        `Dimensoes: ${(result.understanding.dimensions ?? []).join(", ") || "nenhuma"}`,
        `Filtros: ${(result.understanding.filters ?? []).join(", ") || "nenhum"}`,
        ...(result.understanding.warnings ?? []).map((warning) => `Aviso: ${warning}`)
      ].join("\n")
    : `Metrica: ${result.metricLabel ?? ""}\nPeriodo: ${result.timeLabel ?? ""}`;

  return [
    "O sistema TEM acesso aos dados CEVESP por consulta em tempo real ou cache importado.",
    "Use obrigatoriamente os dados abaixo. Se nao houver linhas, explique o diagnostico retornado pelo cache/banco e oriente importar/sincronizar.",
    understanding,
    header && bodyRows ? `${header}\n${bodyRows}` : "",
    interpretation ? `Interpretacao automatica:\n${interpretation}` : ""
  ].filter(Boolean).join("\n\n");
}

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
  let cevespChart:   ChartData | null = null;
  let tracomaContext: string | undefined;
  let dataContext: string | undefined;

  await Promise.allSettled([
    (async () => {
      if (shouldQueryCevesp(body.agent, body.message)) {
        const result = await runCevespAnalysis(body.message);
        const rows = result.rows?.slice(0, 60) ?? [];
        const cols = result.columns ?? Object.keys(rows[0] ?? {});
        cevespContext = formatCevespContext(result);
        cevespChart = extractChartData(rows, cols, result.metricLabel ?? "Dados", result.timeLabel ?? "");
      }
    })(),
    (async () => {
      if (body.agent === "tracoma") {
        if (SINAN_TRACOMA_RE.test(body.message)) {
          const result = await runSinanTracomaContextQuery(body.message);
          tracomaContext = result.summary;
        } else {
          const result = await runTracomaContextQuery(body.message);
          tracomaContext = result.summary;
        }
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

  // ── Streaming SSE response ─────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const ragInput = {
    userId: user.id,
    message: body.message,
    agent: body.agent,
    conversationMessages: (previous ?? []).filter((item: { role: string }) => item.role !== "system"),
    cevespContext,
    tracomaContext,
    dataContext
  };

  const readableStream = new ReadableStream({
    async start(controller) {
      let fullAnswer = "";
      let sources: AiSource[] = [];
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const event of streamRagAnswer(ragInput)) {
          if (event.type === "sources") {
            sources = event.sources;
          } else {
            fullAnswer += event.text;
            send({ t: "c", v: event.text });
          }
        }
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: "assistant",
          content: fullAnswer || "Nao foi possivel gerar uma resposta.",
          sources
        });
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        send({ t: "done", conversationId, sources, chartData: cevespChart ?? undefined });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isQuota = msg.includes("429") || msg.includes("quota") || msg.includes("insufficient_quota");
        send({ t: "err", e: isQuota ? "Cota esgotada. Verifique os créditos do provedor ativo." : msg });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
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
