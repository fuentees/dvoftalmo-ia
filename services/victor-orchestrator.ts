import type { AgentKind, AiSource } from "@/lib/types";
import { retrieveVictorStyleExamples } from "@/lib/external/victor-style-db";
import { retrieveContext } from "@/services/ai/rag";
import { runTracomaContextQuery } from "@/services/tracoma-analytics";
import { runCevespAnalysis } from "@/services/cevesp-analytics";
import { getOpenAI, chatModel } from "@/services/ai/openai";
import { buildSystemPrompt } from "@/services/ai/prompts";

export interface VictorOrchestratorInput {
  userId: string;
  message: string;
  conversationMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface VictorOrchestratorResult {
  answer: string;
  sources: AiSource[];
  agentsUsed: AgentKind[];
}

export function detectRequiredAgents(message: string): AgentKind[] {
  const lower = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const agents: AgentKind[] = [];

  if (/tracoma|tf\b|tt\b|trichiasis|foliculo|azitromicina|redcap|prevalencia|eliminacao|oms|opas|levantamento/.test(lower)) {
    agents.push("tracoma");
  }
  if (/cevesp|conjuntivite|notificac|surto|gve|drs|uvis|se\s*\d|semana epidemio|boletim|canal endemico/.test(lower)) {
    agents.push("epidemiologico");
  }
  if (/planilha|csv|excel|xlsx|tabela|estatistic|media|mediana|desvio|frequencia|grafico|dado/.test(lower)) {
    agents.push("dados");
  }
  if (/oficio|despacho|memorando|justificativa|sei\b|portaria|comunicado|solicitacao/.test(lower)) {
    agents.push("documentos");
  }
  if (/e-mail|email|convite|comunicac/.test(lower)) {
    agents.push("email");
  }
  if (/treinamento|capacitacao|curso|certificado|cronograma|participante/.test(lower)) {
    agents.push("treinamentos");
  }
  if (/campo|visita|municipio|hospedagem|viatura|alimentacao|equipe|missao/.test(lower)) {
    agents.push("campo");
  }

  return agents.length > 0 ? agents : ["geral"];
}

export async function runVictorOrchestrator(input: VictorOrchestratorInput): Promise<VictorOrchestratorResult> {
  const agents = detectRequiredAgents(input.message);

  // Gather all contexts in parallel
  const [styleExamples, ragContext, ...agentContexts] = await Promise.allSettled([
    retrieveVictorStyleExamples(input.userId, input.message, 5),
    retrieveContext(input.message, input.userId),
    ...agents.map((agent) => gatherAgentContext(agent, input.message))
  ]);

  const systemMessages: Array<{ role: "system"; content: string }> = [
    { role: "system", content: buildSystemPrompt("cos") }
  ];

  // Style examples
  const styles = styleExamples.status === "fulfilled" ? styleExamples.value : [];
  if (styles.length > 0) {
    const examplesText = styles
      .map((s, i) => `[Exemplo ${i + 1} — ${s.documentType}]\n${s.content.slice(0, 600)}`)
      .join("\n\n");
    systemMessages.push({
      role: "system",
      content: `Exemplos do estilo de escrita de Victor (use para calibrar tom e vocabulario):\n\n${examplesText}`
    });
  }

  // RAG knowledge base
  const rag = ragContext.status === "fulfilled" ? ragContext.value : null;
  if (rag?.content) {
    systemMessages.push({
      role: "system",
      content: `Base de conhecimento recuperada:\n${rag.content}`
    });
  }

  // Each agent's real-time context
  for (let i = 0; i < agents.length; i++) {
    const ctx = agentContexts[i];
    if (ctx?.status === "fulfilled" && ctx.value) {
      systemMessages.push({
        role: "system",
        content: `Contexto do Agente ${agents[i]} (dados em tempo real):\n${ctx.value}`
      });
    }
  }

  if (agents.length > 1) {
    systemMessages.push({
      role: "system",
      content: `Para esta resposta, voce esta orquestrando os seguintes agentes: ${agents.join(", ")}. Integre todas as informacoes em uma resposta unica, coerente e no seu estilo pessoal.`
    });
  }

  const response = await getOpenAI().chat.completions.create({
    model: chatModel,
    temperature: 0.25,
    messages: [
      ...systemMessages,
      ...(input.conversationMessages ?? []),
      { role: "user", content: input.message }
    ]
  });

  return {
    answer: response.choices[0]?.message.content ?? "Nao foi possivel gerar uma resposta.",
    sources: rag?.sources ?? [],
    agentsUsed: agents
  };
}

async function gatherAgentContext(agent: AgentKind, message: string): Promise<string> {
  try {
    if (agent === "tracoma") {
      const result = await runTracomaContextQuery(message);
      return result.summary;
    }
    if (agent === "epidemiologico") {
      const result = await runCevespAnalysis(message);
      if (result.rows && result.rows.length > 0) {
        const rows = result.rows.slice(0, 30);
        const header = (result.columns ?? Object.keys(rows[0] ?? {})).join(" | ");
        const body = rows.map((row: Record<string, unknown>) => Object.values(row).join(" | ")).join("\n");
        return `Metrica: ${result.metricLabel}\n${header}\n${body}`;
      }
    }
    return "";
  } catch {
    return "";
  }
}
