import type OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { AiSource, TracomaSurveyResult } from "@/lib/types";
import { getOpenAI, chatModel } from "@/services/ai/openai";
import { buildSystemPrompt } from "@/services/ai/prompts";
import { getAIConfig, generateCompletion } from "@/services/ai/provider";
import { runCevespAnalysis } from "@/services/cevesp-analytics";
import { fetchTracomaSurveys, estimateAzithromycin } from "@/services/tracoma-analytics";
import { retrieveContext } from "@/services/ai/rag";
import { findInvalidRecords, saveCorrectionsToQueue } from "@/services/cevesp-corrections";
import { getNotificationTableName } from "@/lib/external/notification-db";
import { auditarSinanTracoma, runSinanTracomaAnalysis } from "@/services/sinan-tracoma";
// 5-min in-memory cache for tracoma queries (REDCap is slow and data rarely changes)
const tracomaCache = new Map<string, { data: TracomaSurveyResult[]; expiresAt: number }>();

// ── Tool definitions ──────────────────────────────────────────────────────────

const COS_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "consultar_cevesp",
      description:
        "Consulta o banco de dados CEVESP com dados de notificações de conjuntivites do Estado de SP. " +
        "Use para perguntas sobre total de casos, distribuição por SE, GVE, DRS, município, surtos, " +
        "faixa etária, sexo ou tendência temporal.",
      parameters: {
        type: "object",
        properties: {
          pergunta: {
            type: "string",
            description: "Pergunta em linguagem natural. Ex.: total de casos por GVE nos últimos 3 anos por SE"
          }
        },
        required: ["pergunta"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_tracoma",
      description:
        "Consulta inquéritos de tracoma do REDCap. Retorna prevalência TF e TT por município, " +
        "status de eliminação OMS e estimativa de doses de azitromicina. " +
        "Use para perguntas sobre tracoma, TF, TT, eliminação, cobertura de tratamento.",
      parameters: {
        type: "object",
        properties: {
          municipio: { type: "string", description: "Nome do município (opcional)" },
          uf: { type: "string", description: "UF de 2 letras, ex.: SP (opcional)" },
          ano_inicio: { type: "number", description: "Ano de início do filtro (opcional)" },
          ano_fim: { type: "number", description: "Ano fim do filtro (opcional)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "estimar_azitromicina",
      description:
        "Estima o número de doses de azitromicina necessárias para tratamento em massa de tracoma " +
        "conforme protocolo OMS/OPAS (20 mg/kg, faixas de peso padrão).",
      parameters: {
        type: "object",
        properties: {
          total_examinados: {
            type: "number",
            description: "Total de crianças/adultos examinados no inquérito"
          },
          prevalencia_tf: {
            type: "number",
            description: "Prevalência TF em porcentagem (ex.: 12.5 para 12,5%)"
          },
          cobertura_populacao: {
            type: "number",
            description: "Fração da população a cobrir com tratamento (0 a 1, padrão: 1)"
          }
        },
        required: ["total_examinados", "prevalencia_tf"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "identificar_invalidos_cevesp",
      description:
        "Busca registros no CEVESP com data de notificação ou SE inválida (futuro, impossível). " +
        "Use para auditar qualidade de dado antes de propor correções. " +
        "Retorna lista de registros com o problema identificado e sugestão de correção.",
      parameters: {
        type: "object",
        properties: {
          limite: {
            type: "number",
            description: "Máximo de registros a retornar (padrão: 50, máximo: 100)"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_sinan_tracoma",
      description:
        "Consulta o cache SINAN Tracoma (bancos TRACONET e NOTTRACONET). " +
        "Retorna contagens agrupadas por município, GVE, DRS, ano, banco, classificação ou agravo. " +
        "Use para perguntas sobre casos de tracoma notificados, distribuição por região/ano, " +
        "comparação entre bancos, casos TF/TT no SINAN.",
      parameters: {
        type: "object",
        properties: {
          pergunta: {
            type: "string",
            description: "Pergunta em linguagem natural sobre os dados SINAN Tracoma. Ex.: total de casos TT por município em 2023"
          }
        },
        required: ["pergunta"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "auditar_sinan_tracoma",
      description:
        "Audita qualidade e consistência dos dados SINAN Tracoma. " +
        "Detecta: divergências entre TRACONET (consolidado) e NOTTRACONET (casos individuais) por município/ano, " +
        "casos sem graduação TF/TT, sem tratamento registrado, sem conclusão, TF sem tratamento, " +
        "TT sem cirurgia/epilation, anos impossíveis e completude de campos-chave. " +
        "Use para perguntas sobre completude, subregistro, inconsistências ou qualidade dos dados SINAN tracoma.",
      parameters: {
        type: "object",
        properties: {
          municipio: { type: "string", description: "Filtrar por município (opcional)" },
          gve: { type: "string", description: "Filtrar por GVE/regional de saúde (opcional)" },
          year_start: { type: "number", description: "Ano de início do filtro (opcional)" },
          year_end: { type: "number", description: "Ano fim do filtro (opcional)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "propor_correcao_cevesp",
      description:
        "Envia uma proposta de correção de registro CEVESP para a fila de aprovação. " +
        "Use após identificar_invalidos_cevesp. A correção só será aplicada após aprovação de um supervisor.",
      parameters: {
        type: "object",
        properties: {
          record_id: { type: "string", description: "ID do registro a corrigir" },
          pk_column: { type: "string", description: "Nome da coluna de chave primária" },
          field_name: { type: "string", description: "Campo a corrigir (ex: DtNotificacao, SemEpidemio)" },
          old_value: { type: "string", description: "Valor atual (inválido)" },
          new_value: { type: "string", description: "Valor proposto (correto)" },
          reason: { type: "string", description: "Motivo da correção" }
        },
        required: ["record_id", "pk_column", "field_name", "old_value", "new_value", "reason"]
      }
    }
  }
];

// ── Data quality: future SE/year filter ──────────────────────────────────────

function currentEpiWeek(): { year: number; se: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const se = Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
  return { year: now.getFullYear(), se };
}

interface DateQualityResult {
  valid: Record<string, unknown>[];
  excluded: number;
  suspicious: number;
  warnings: string[];
}

function validateDates(rows: Record<string, unknown>[]): DateQualityResult {
  if (!rows.length) return { valid: rows, excluded: 0, suspicious: 0, warnings: [] };

  const { year: currentYear, se: currentSe } = currentEpiWeek();
  const cols = Object.keys(rows[0]);

  const yearCol = cols.find((c) => /ano|year/i.test(c) && !/semana|week/i.test(c));
  const seCol   = cols.find((c) => /sem(ana)?epi|semepi|se_|^se$/i.test(c));

  if (!yearCol && !seCol) return { valid: rows, excluded: 0, suspicious: 0, warnings: [] };

  const excluded: Record<string, unknown>[] = [];
  const suspicious: Record<string, unknown>[] = [];
  const valid: Record<string, unknown>[] = [];

  // Earliest plausible year for CEVESP data
  const YEAR_MIN = 1990;
  // Flag as suspicious if older than 5 years (possible typo, e.g. 2006 instead of 2026)
  const SUSPECT_THRESHOLD = currentYear - 5;

  for (const row of rows) {
    const ano = yearCol ? Number(row[yearCol]) : NaN;
    const se  = seCol   ? Number(row[seCol])   : NaN;

    // Exclude: any year in the future, impossible SE, or year before CEVESP existed
    const shouldExclude =
      (!isNaN(ano) && ano > currentYear) ||
      (!isNaN(ano) && !isNaN(se) && ano === currentYear && se > currentSe) ||
      (!isNaN(ano) && ano < YEAR_MIN) ||
      (!isNaN(se)  && (se > 53 || se < 1));

    if (shouldExclude) {
      excluded.push(row);
    } else if (!isNaN(ano) && ano < SUSPECT_THRESHOLD) {
      // Keep in analysis but flag as suspicious
      suspicious.push(row);
      valid.push(row);
    } else {
      valid.push(row);
    }
  }

  const warnings: string[] = [];

  if (excluded.length > 0) {
    const examples = excluded.slice(0, 3).map((r) => {
      const parts: string[] = [];
      if (yearCol) parts.push(`${yearCol}=${r[yearCol]}`);
      if (seCol)   parts.push(`${seCol}=${r[seCol]}`);
      return parts.join(", ");
    });
    warnings.push(
      `EXCLUÍDOS — ${excluded.length} registro(s) com data inválida (futuro ou impossível): ` +
      examples.join(" | ") +
      `. Devem ser corrigidos na fonte (CEVESP/SINAN).`
    );
  }

  if (suspicious.length > 0) {
    // Group by year to summarize
    const byYear: Record<number, number> = {};
    for (const r of suspicious) {
      const y = Number(r[yearCol!]);
      byYear[y] = (byYear[y] ?? 0) + 1;
    }
    const summary = Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([y, n]) => `${y}: ${n} reg.`)
      .join(", ");
    warnings.push(
      `SUSPEITOS (mantidos, mas verifique) — ${suspicious.length} registro(s) com ano anterior a ${SUSPECT_THRESHOLD}, ` +
      `possivelmente erro de digitação (${summary}). ` +
      `Verifique se o ano correto não seria ${currentYear} ou período recente.`
    );
  }

  return { valid, excluded: excluded.length, suspicious: suspicious.length, warnings };
}

// ── Tool executors ────────────────────────────────────────────────────────────

interface ToolResult {
  content: string;
  sources?: AiSource[];
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  if (name === "consultar_cevesp") {
    try {
      const result = await runCevespAnalysis(String(args.pergunta ?? ""));
      if (!result.rows?.length) {
        const diagInfo = Array.isArray(result.interpretation) && result.interpretation.length > 0
          ? result.interpretation.join(" ")
          : "Nenhum dado encontrado para os filtros aplicados.";
        return { content: `CEVESP — sem resultados: ${diagInfo}` };
      }

      const { valid, excluded, suspicious, warnings } = validateDates(result.rows as Record<string, unknown>[]);

      if (!valid.length) {
        return {
          content:
            `Nenhum registro válido retornado. ${excluded} registro(s) foram descartados por data inválida.\n` +
            warnings.join("\n") +
            `\nVerifique se os filtros de data estão corretos.`
        };
      }

      const cols = result.columns ?? Object.keys(valid[0] ?? {});
      const header = cols.join(" | ");
      const rowLines = valid.slice(0, 60).map((r) =>
        cols.map((c) => String(r[c] ?? "")).join(" | ")
      ).join("\n");
      const interp = Array.isArray(result.interpretation)
        ? "\n\nInterpretação: " + result.interpretation.join(" ")
        : "";

      const qualityNote = (excluded > 0 || suspicious > 0)
        ? `\n\n--- Qualidade de dado ---\n` + warnings.join("\n")
        : "";

      return {
        content:
          `Métrica: ${result.metricLabel ?? ""} | Período: ${result.timeLabel ?? ""}\n` +
          `Registros analisados: ${valid.length}` +
          (excluded > 0 ? ` | Excluídos (inválidos): ${excluded}` : "") +
          (suspicious > 0 ? ` | Suspeitos (verificar): ${suspicious}` : "") +
          `\n\n${header}\n${rowLines}${interp}${qualityNote}`
      };
    } catch (err) {
      return { content: `Erro CEVESP: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "consultar_tracoma") {
    try {
      const cacheKey = JSON.stringify({
        m: args.municipio ?? null,
        u: args.uf ?? null,
        a: args.ano_inicio ?? null,
        b: args.ano_fim ?? null
      });
      const cached = tracomaCache.get(cacheKey);
      const surveys = (cached && Date.now() < cached.expiresAt)
        ? cached.data
        : await fetchTracomaSurveys({
            municipality: args.municipio ? String(args.municipio) : undefined,
            uf: args.uf ? String(args.uf) : undefined,
            yearFrom: args.ano_inicio ? Number(args.ano_inicio) : undefined,
            yearTo: args.ano_fim ? Number(args.ano_fim) : undefined
          }).then((data) => {
            tracomaCache.set(cacheKey, { data, expiresAt: Date.now() + 5 * 60_000 });
            return data;
          });
      if (!surveys.length) return { content: "Nenhum dado de tracoma encontrado." };
      const lines = surveys.map((s) =>
        `${s.municipality} (${s.uf}) ${s.examYear}: TF=${s.tfPrevalence.toFixed(1)}% ` +
        `(${s.tfEliminated ? "eliminado" : "acima do limiar OMS"}) | ` +
        `TT=${s.ttPrevalence.toFixed(2)}% (${s.ttEliminated ? "eliminado" : "acima do limiar OMS"}) | ` +
        `Examinados=${s.totalExamined}`
      );
      return { content: `Resultados de tracoma (${surveys.length} municípios/anos):\n` + lines.join("\n") };
    } catch (err) {
      return { content: `Erro tracoma: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "estimar_azitromicina") {
    try {
      const coveragePct = args.cobertura_populacao != null ? Number(args.cobertura_populacao) : 80;
      const estimate = estimateAzithromycin({
        targetPopulation: Number(args.total_examinados),
        coveragePercent: coveragePct
      });
      return {
        content:
          `Estimativa de doses de azitromicina:\n` +
          `- População alvo: ${estimate.population}\n` +
          `- Meta de cobertura: ${estimate.coveragePercent}% → ${estimate.treatmentTarget} pessoas a tratar\n` +
          `- Comprimidos 250 mg (crianças): ${estimate.tablets250mg}\n` +
          `- Comprimidos 500 mg (adultos): ${estimate.tablets500mg}\n` +
          `- Total de comprimidos: ${estimate.totalTablets}\n` +
          estimate.notes.join("\n")
      };
    } catch (err) {
      return { content: `Erro ao estimar doses: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "buscar_documentos") {
    try {
      const ctx = await retrieveContext(String(args.consulta ?? ""), userId);
      if (!ctx.content) return { content: "Nenhum documento relevante encontrado na base de conhecimento." };
      return { content: ctx.content, sources: ctx.sources };
    } catch (err) {
      return { content: `Erro na busca de documentos: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "identificar_invalidos_cevesp") {
    try {
      const limite = Math.min(Number(args.limite ?? 50), 100);
      const records = await findInvalidRecords(limite);
      if (!records.length) return { content: "Nenhum registro com data ou SE inválida encontrado no CEVESP." };
      const lines = records.map((r) =>
        `ID=${r.recordId} | ${r.municipio ?? "?"} | DtNotif=${r.dtNotificacao ?? "?"} | SE=${r.semEpidemio ?? "?"} | Problema: ${r.issue} | Sugestão: ${r.suggestedField}=${r.suggestedValue}`
      );
      return {
        content:
          `Encontrados ${records.length} registros com data/SE inválida:\n` +
          lines.join("\n") +
          `\n\nUse propor_correcao_cevesp para enviar as correções à fila de aprovação.`
      };
    } catch (err) {
      return { content: `Erro ao buscar inválidos: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "consultar_sinan_tracoma") {
    try {
      const result = await runSinanTracomaAnalysis(String(args.pergunta ?? ""));
      if (!result.rows?.length) {
        return { content: `SINAN Tracoma — sem resultados. ${result.interpretation?.join(" ") ?? ""}` };
      }
      const cols = result.columns ?? Object.keys(result.rows[0] ?? {});
      const header = cols.join(" | ");
      const rowLines = result.rows.slice(0, 60).map((r) =>
        cols.map((c) => String(r[c] ?? "")).join(" | ")
      ).join("\n");
      const interp = result.interpretation?.length
        ? "\n\nInterpretação: " + result.interpretation.join(" ")
        : "";
      return {
        content:
          `SINAN Tracoma | ${result.metricLabel ?? ""} | ${result.timeLabel ?? ""}\n` +
          `Total de registros: ${result.rows.find((r) => String(r[cols[0]]) === "Total")?.Valor ?? result.rows.length}\n\n` +
          `${header}\n${rowLines}${interp}`
      };
    } catch (err) {
      return { content: `Erro SINAN Tracoma: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "auditar_sinan_tracoma") {
    try {
      const result = await auditarSinanTracoma({
        municipio: args.municipio ? String(args.municipio) : undefined,
        gve: args.gve ? String(args.gve) : undefined,
        yearStart: args.year_start ? Number(args.year_start) : undefined,
        yearEnd: args.year_end ? Number(args.year_end) : undefined
      });
      const lines: string[] = [
        `=== AUDITORIA SINAN TRACOMA ===`,
        `Total TRACONET (consolidado): ${result.totalTraconet}`,
        `Total NOTTRACONET (individuais): ${result.totalNottraconet}`
      ];
      if (result.crossBankDivergences.length > 0) {
        lines.push(`\n--- Divergências TRACONET vs NOTTRACONET (${result.crossBankDivergences.length}) ---`);
        for (const d of result.crossBankDivergences.slice(0, 20)) {
          lines.push(`  ${d.municipio} ${d.ano}: consolidado=${d.traconet} individuais=${d.nottraconet} diff=${d.diff > 0 ? "+" : ""}${d.diff} [risco ${d.risco}]`);
        }
        if (result.crossBankDivergences.length > 20) {
          lines.push(`  ... e mais ${result.crossBankDivergences.length - 20} divergências.`);
        }
      } else {
        lines.push(`\nSem divergências entre TRACONET e NOTTRACONET.`);
      }
      lines.push(`\n--- Completude dos campos ---`);
      for (const [field, stat] of Object.entries(result.fieldCompleteness)) {
        lines.push(`  ${field}: ${stat.filled}/${stat.total} (${stat.pct.toFixed(1)}%)`);
      }
      lines.push(`\n--- Alertas de qualidade ---`);
      lines.push(`  Sem graduação TF/TT: ${result.semGraduacao}`);
      lines.push(`  Sem tratamento: ${result.semTratamento}`);
      lines.push(`  Sem conclusão: ${result.semConclusao}`);
      lines.push(`  TF confirmado sem tratamento: ${result.tfSemTratamento}`);
      lines.push(`  TT confirmado sem cirurgia/epilation: ${result.ttSemCircurgia}`);
      lines.push(`  Registros com ano impossível: ${result.anoImpossivel}`);
      if (result.recommendations.length > 0) {
        lines.push(`\n--- Recomendações ---`);
        result.recommendations.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));
      }
      return { content: lines.join("\n") };
    } catch (err) {
      return { content: `Erro na auditoria SINAN: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "propor_correcao_cevesp") {
    try {
      const tableName = getNotificationTableName();
      const { saved, skipped } = await saveCorrectionsToQueue(
        [{
          recordId: String(args.record_id),
          tableName,
          pkColumn: String(args.pk_column),
          fieldName: String(args.field_name),
          oldValue: String(args.old_value),
          newValue: String(args.new_value),
          reason: String(args.reason)
        }],
        userId
      );
      if (saved === 0) {
        return { content: `Correção para registro ${args.record_id} já está na fila aguardando aprovação.` };
      }
      return {
        content:
          `Correção enviada para aprovação: registro ${args.record_id}, ` +
          `campo ${args.field_name}: "${args.old_value}" → "${args.new_value}". ` +
          `Um supervisor precisa aprovar na tela de Fila de Correções antes de ser aplicada.`
      };
    } catch (err) {
      return { content: `Erro ao propor correção: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return { content: `Ferramenta desconhecida: ${name}` };
}

// ── COS Agent loop ────────────────────────────────────────────────────────────

export interface CosAgentInput {
  userId: string;
  message: string;
  conversationMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface CosAgentResult {
  answer: string;
  sources: AiSource[];
  toolsUsed: string[];
}

// ── OpenAI tool-loop ──────────────────────────────────────────────────────────
async function runWithOpenAI(input: CosAgentInput, apiKey: string, model: string): Promise<CosAgentResult> {
  const client = new (await import("openai")).default({ apiKey });
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt("cos") },
    ...(input.conversationMessages ?? []),
    { role: "user", content: input.message }
  ];
  const allSources: AiSource[] = [];
  const toolsUsed: string[] = [];
  const forcedTool = step0ToolName(input.message);

  for (let step = 0; step < 8; step++) {
    const toolChoice = step === 0
      ? { type: "function" as const, function: { name: forcedTool } }
      : "auto" as const;
    const response = await client.chat.completions.create({
      model, temperature: 0.2, tools: COS_TOOLS, tool_choice: toolChoice, messages
    });
    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg as OpenAI.ChatCompletionMessageParam);

    if (!assistantMsg.tool_calls?.length) {
      return { answer: assistantMsg.content ?? "Sem resposta.", sources: allSources, toolsUsed };
    }

    const fnCalls = assistantMsg.tool_calls.filter(
      (tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === "function"
    );
    const toolResults = await Promise.all(fnCalls.map(async (tc) => {
      const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      toolsUsed.push(tc.function.name);
      const result = await executeTool(tc.function.name, args, input.userId);
      if (result.sources) allSources.push(...result.sources);
      return { id: tc.id, content: result.content };
    }));
    for (const tr of toolResults) {
      messages.push({ role: "tool", tool_call_id: tr.id, content: tr.content });
    }
  }

  const final = await client.chat.completions.create({
    model, temperature: 0.2,
    messages: [...messages, { role: "user", content: "Elabore sua resposta final com os dados obtidos." }]
  });
  return { answer: final.choices[0]?.message.content ?? "Sem resposta.", sources: allSources, toolsUsed };
}

// ── Anthropic tool-loop ───────────────────────────────────────────────────────
const ANTHROPIC_TOOLS: Anthropic.Tool[] = COS_TOOLS
  .filter((t): t is OpenAI.ChatCompletionFunctionTool & { type: "function" } => t.type === "function")
  .map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters as Anthropic.Tool["input_schema"]
  }));

// Force the right first tool for the COS agent.
// Without this, Claude picks buscar_documentos for any question and responds
// with a generic "no access" message when embeddings are unavailable.
// Strategy: tracoma questions → consultar_tracoma; everything else → consultar_cevesp.
// Claude can still call other tools on step 1+ via tool_choice:"auto".
function step0ToolName(message: string): string {
  const n = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/auditoria|completude|subregistro|inconsistencia|sem tratamento|sem graduacao|sem conclusao|divergencia|traconet|nottraconet|qualidade.*sinan|sinan.*qualidade/.test(n)) {
    return "auditar_sinan_tracoma";
  }
  if (/sinan/.test(n)) return "consultar_sinan_tracoma";
  if (/tracoma|tf\b|tt\b|azitromicin|eliminac/.test(n)) return "consultar_tracoma";
  return "consultar_cevesp";
}

async function runWithAnthropic(input: CosAgentInput, apiKey: string, model: string): Promise<CosAgentResult> {
  const client = new Anthropic({ apiKey });
  type AnthropicMsg = Anthropic.MessageParam;
  const messages: AnthropicMsg[] = [
    ...(input.conversationMessages ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: input.message }
  ];
  const system = buildSystemPrompt("cos");
  const allSources: AiSource[] = [];
  const toolsUsed: string[] = [];
  const forcedTool = step0ToolName(input.message);

  for (let step = 0; step < 8; step++) {
    const response = await client.messages.create({
      model, max_tokens: 4096, temperature: 0.2,
      system, tools: ANTHROPIC_TOOLS,
      tool_choice: step === 0 ? { type: "tool", name: forcedTool } : { type: "auto" },
      messages
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      return {
        answer: textBlock?.type === "text" ? textBlock.text : "Sem resposta.",
        sources: allSources, toolsUsed
      };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(toolUseBlocks.map(async (block) => {
      toolsUsed.push(block.name);
      const result = await executeTool(block.name, block.input as Record<string, unknown>, input.userId);
      if (result.sources) allSources.push(...result.sources);
      return { type: "tool_result" as const, tool_use_id: block.id, content: result.content };
    }));
    messages.push({ role: "user", content: toolResults });
  }

  return { answer: "Limite de passos atingido.", sources: allSources, toolsUsed };
}

// ── Gemini text-mode (sem tool loop — injeta contexto CEVESP diretamente) ─────
async function runWithGemini(input: CosAgentInput): Promise<CosAgentResult> {
  const toolsUsed: string[] = [];
  const contextParts: string[] = [];

  // Auto-execute CEVESP query and inject as context
  try {
    const cevesp = await executeTool("consultar_cevesp", { pergunta: input.message }, input.userId);
    contextParts.push(`Dados CEVESP:\n${cevesp.content}`);
    toolsUsed.push("consultar_cevesp");
  } catch { /* skip */ }

  const systemContent = buildSystemPrompt("cos") +
    (contextParts.length ? `\n\nContexto obtido automaticamente:\n${contextParts.join("\n\n")}` : "");

  const messages = [
    { role: "system" as const, content: systemContent },
    ...(input.conversationMessages ?? []).map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
    { role: "user" as const, content: input.message }
  ];

  const answer = await generateCompletion(messages, { temperature: 0.2 });
  return { answer: answer || "Sem resposta.", sources: [], toolsUsed };
}

// ── Entry point ───────────────────────────────────────────────────────────────
export async function runCosAgent(input: CosAgentInput): Promise<CosAgentResult> {
  const config = await getAIConfig();

  if (config.provider === "anthropic" && config.apiKey) {
    return runWithAnthropic(input, config.apiKey, config.model);
  }
  if (config.provider === "gemini") {
    return runWithGemini(input);
  }
  // OpenAI (default)
  const openaiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
  return runWithOpenAI(input, openaiKey, config.model || chatModel);
}
