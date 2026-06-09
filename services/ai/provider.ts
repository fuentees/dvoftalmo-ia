import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptValue } from "@/lib/crypto";

export type AIProvider = "openai" | "anthropic" | "gemini";

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai:    "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5-20251001",
  gemini:    "gemini-3.5-flash"
};

// Simple 60s in-memory cache to avoid a Supabase round-trip on every request
let cachedConfig: AIConfig | null = null;
let cacheExpiry = 0;

function configFromEnv(): AIConfig {
  const provider = (process.env.AI_PROVIDER as AIProvider) ?? "openai";
  const apiKey =
    provider === "anthropic" ? (process.env.ANTHROPIC_API_KEY ?? "") :
    provider === "gemini"    ? (process.env.GEMINI_API_KEY    ?? "") :
                               (process.env.OPENAI_API_KEY    ?? "");
  const model = DEFAULT_MODELS[provider];
  return { provider, model, apiKey };
}

export async function getAIConfig(): Promise<AIConfig> {
  if (cachedConfig && Date.now() < cacheExpiry) return cachedConfig;

  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", [
        "ai_provider",
        "openai_api_key",    "openai_model",
        "anthropic_api_key", "anthropic_model",
        "gemini_api_key",    "gemini_model"
      ]);

    const cfg = Object.fromEntries((data ?? []).map((r) => [r.key, r.value as string]));
    const provider = (cfg.ai_provider as AIProvider) ?? (process.env.AI_PROVIDER as AIProvider) ?? "openai";

    const rawKey =
      provider === "openai"    ? (cfg.openai_api_key    ?? process.env.OPENAI_API_KEY    ?? "") :
      provider === "anthropic" ? (cfg.anthropic_api_key ?? process.env.ANTHROPIC_API_KEY ?? "") :
                                 (cfg.gemini_api_key    ?? process.env.GEMINI_API_KEY    ?? "");
    const apiKey = decryptValue(rawKey);

    const model =
      provider === "openai"    ? (cfg.openai_model    ?? DEFAULT_MODELS.openai) :
      provider === "anthropic" ? (cfg.anthropic_model ?? DEFAULT_MODELS.anthropic) :
                                 (cfg.gemini_model    ?? DEFAULT_MODELS.gemini);

    cachedConfig = { provider, model, apiKey };
    cacheExpiry = Date.now() + 60_000;
    return cachedConfig;
  } catch {
    // Supabase unreachable — fall back to env vars without caching
    return configFromEnv();
  }
}

export function invalidateConfigCache() {
  cachedConfig = null;
  cacheExpiry = 0;
}

export async function generateCompletion(
  messages: ChatMessage[],
  options: { temperature?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const config = await getAIConfig();
  const { temperature = 0.3 } = options;

  if (config.provider === "openai") {
    const client = new OpenAI({ apiKey: config.apiKey });
    const response = await client.chat.completions.create({
      model: config.model,
      temperature,
      response_format: options.jsonMode ? { type: "json_object" } : undefined,
      messages: messages.map((m) => ({ role: m.role, content: m.content }))
    });
    return response.choices[0]?.message.content?.trim() ?? "";
  }

  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const systemMsg = systemParts.join("\n\n");
    const userMsgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      temperature,
      system: systemMsg || undefined,
      messages: userMsgs
    });
    const block = response.content[0];
    return block?.type === "text" ? block.text.trim() : "";
  }

  // Gemini
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const geminiModel = genAI.getGenerativeModel({
    model: config.model,
    systemInstruction: systemParts.join("\n\n") || undefined
  });
  const history = messages
    .filter((m) => m.role !== "system")
    .slice(0, -1)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
  const lastMsg = messages.filter((m) => m.role !== "system").at(-1)?.content ?? "";
  const chat = geminiModel.startChat({ history });
  const result = await chat.sendMessage(lastMsg);
  return result.response.text().trim();
}

export async function* streamCompletion(
  messages: ChatMessage[],
  options: { temperature?: number } = {}
): AsyncGenerator<string> {
  const config = await getAIConfig();
  const { temperature = 0.3 } = options;

  if (config.provider === "openai") {
    const client = new OpenAI({ apiKey: config.apiKey });
    const stream = await client.chat.completions.create({
      model: config.model,
      temperature,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true
    });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) yield text;
    }
    return;
  }

  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const userMsgs = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const stream = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      temperature,
      stream: true,
      system: systemParts.join("\n\n") || undefined,
      messages: userMsgs
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
    return;
  }

  // Gemini — stream via generateContentStream
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const sysParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const geminiModel = genAI.getGenerativeModel({
    model: config.model,
    systemInstruction: sysParts.join("\n\n") || undefined
  });
  const hist = messages
    .filter((m) => m.role !== "system")
    .slice(0, -1)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
  const lastMsg = messages.filter((m) => m.role !== "system").at(-1)?.content ?? "";
  const chat = geminiModel.startChat({ history: hist });
  const result = await chat.sendMessageStream(lastMsg);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}
