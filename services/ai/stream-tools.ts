import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import type { ModelMessage } from "ai";
import { createAISdkModel } from "@/lib/ai-provider-sdk";
import { buildSystemPrompt } from "@/services/ai/prompts";
import { executeTool } from "@/services/cos-agent";
import { retrieveContext } from "@/services/ai/rag";
import type { AiSource, AgentKind } from "@/lib/types";

// ── Event types emitted by streamWithTools ───────────────────────────────────

export type ToolStreamEvent =
  | { type: "chunk";     text: string }
  | { type: "tool_call"; name: string }
  | { type: "tool_done"; name: string }
  | { type: "sources";   sources: AiSource[] };

// ── Labels shown in the UI while a tool runs ─────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  consultar_cevesp:             "Consultando CEVESP…",
  consultar_tracoma:            "Consultando tracoma REDCap…",
  consultar_sinan_tracoma:      "Consultando SINAN Tracoma…",
  auditar_sinan_tracoma:        "Auditando SINAN Tracoma…",
  estimar_azitromicina:         "Calculando doses de azitromicina…",
  buscar_documentos:            "Buscando documentos…",
  identificar_invalidos_cevesp: "Identificando registros inválidos…",
  propor_correcao_cevesp:       "Registrando proposta de correção…",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Executando ${name}…`;
}

// ── Tool definitions (AI SDK v7: inputSchema instead of parameters) ───────────

function buildTools(userId: string) {
  const exec = (name: string, args: Record<string, unknown>) =>
    executeTool(name, args, userId).then((r) => ({
      text:    r.content,
      sources: (r.sources ?? []) as AiSource[],
    }));

  return {
    consultar_cevesp: tool({
      description:
        "Consulta o banco CEVESP com dados de notificações de conjuntivites do Estado de SP. " +
        "Use para perguntas sobre total de casos, distribuição por SE, GVE, DRS, município, surtos, " +
        "faixa etária, sexo ou tendência temporal.",
      inputSchema: z.object({
        pergunta: z.string().describe("Pergunta em linguagem natural sobre os dados CEVESP"),
      }),
      execute: ({ pergunta }) => exec("consultar_cevesp", { pergunta }),
    }),

    consultar_tracoma: tool({
      description:
        "Consulta inquéritos de tracoma do REDCap. Retorna prevalência TF e TT por município, " +
        "status de eliminação OMS e estimativa de doses de azitromicina.",
      inputSchema: z.object({
        municipio:  z.string().optional().describe("Nome do município (opcional)"),
        uf:         z.string().optional().describe("UF de 2 letras, ex.: SP"),
        ano_inicio: z.number().optional(),
        ano_fim:    z.number().optional(),
      }),
      execute: (args) => exec("consultar_tracoma", args as Record<string, unknown>),
    }),

    estimar_azitromicina: tool({
      description:
        "Estima doses de azitromicina para tratamento em massa de tracoma conforme protocolo OMS/OPAS.",
      inputSchema: z.object({
        total_examinados:    z.number(),
        prevalencia_tf:      z.number(),
        cobertura_populacao: z.number().optional(),
      }),
      execute: (args) => exec("estimar_azitromicina", args as Record<string, unknown>),
    }),

    identificar_invalidos_cevesp: tool({
      description:
        "Busca registros no CEVESP com data de notificação ou SE inválida (futuro, impossível). " +
        "Use para auditar qualidade de dado.",
      inputSchema: z.object({
        limite: z.number().optional().describe("Máximo de registros (padrão: 50)"),
      }),
      execute: (args) => exec("identificar_invalidos_cevesp", args as Record<string, unknown>),
    }),

    propor_correcao_cevesp: tool({
      description:
        "Envia proposta de correção de registro CEVESP para fila de aprovação. " +
        "Use após identificar_invalidos_cevesp.",
      inputSchema: z.object({
        record_id:  z.string(),
        pk_column:  z.string(),
        field_name: z.string(),
        old_value:  z.string(),
        new_value:  z.string(),
        reason:     z.string(),
      }),
      execute: (args) => exec("propor_correcao_cevesp", args as Record<string, unknown>),
    }),

    consultar_sinan_tracoma: tool({
      description:
        "Consulta o cache SINAN Tracoma. TRACONET = casos individuais. " +
        "NOTTRACONET = consolidado/agregados.",
      inputSchema: z.object({
        pergunta: z.string().describe("Pergunta em linguagem natural sobre SINAN Tracoma"),
      }),
      execute: ({ pergunta }) => exec("consultar_sinan_tracoma", { pergunta }),
    }),

    auditar_sinan_tracoma: tool({
      description:
        "Audita qualidade e consistência dos dados SINAN Tracoma. " +
        "Detecta divergências TRACONET vs NOTTRACONET, completude, subregistro.",
      inputSchema: z.object({
        municipio:  z.string().optional(),
        gve:        z.string().optional(),
        year_start: z.number().optional(),
        year_end:   z.number().optional(),
      }),
      execute: (args) => exec("auditar_sinan_tracoma", args as Record<string, unknown>),
    }),

    buscar_documentos: tool({
      description:
        "Busca documentos na base de conhecimento (RAG) — protocolos, manuais, normas, " +
        "boletins e documentos técnicos indexados pelo sistema.",
      inputSchema: z.object({
        consulta: z.string().describe("Termos de busca em linguagem natural"),
      }),
      execute: async ({ consulta }) => {
        const ctx = await retrieveContext(consulta, userId).catch(() => ({
          content: "Erro ao buscar documentos.",
          sources: [] as AiSource[],
        }));
        return {
          text:    ctx.content || "Nenhum documento relevante encontrado.",
          sources: ctx.sources,
        };
      },
    }),
  };
}

// ── Main streaming generator ──────────────────────────────────────────────────

export async function* streamWithTools(params: {
  userId: string;
  agent: AgentKind;
  messages: ModelMessage[];
  userModel?: string | null;
}): AsyncGenerator<ToolStreamEvent> {
  const sdkModel = await createAISdkModel(params.userModel);
  const tools    = buildTools(params.userId);

  const result = streamText({
    model:       sdkModel,
    system:      buildSystemPrompt(params.agent),
    messages:    params.messages,
    tools,
    stopWhen:    stepCountIs(8),
    temperature: 0.2,
  });

  const allSources: AiSource[] = [];

  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      yield { type: "chunk", text: (part as { type: "text-delta"; text: string }).text };
    } else if (part.type === "tool-call") {
      const tc = part as { type: "tool-call"; toolName: string };
      yield { type: "tool_call", name: tc.toolName };
    } else if (part.type === "tool-result") {
      const tr = part as { type: "tool-result"; toolName: string; output: unknown };
      const out = tr.output as { sources?: AiSource[] } | undefined;
      if (Array.isArray(out?.sources)) allSources.push(...out!.sources);
      yield { type: "tool_done", name: tr.toolName };
    }
  }

  yield { type: "sources", sources: allSources };
}
