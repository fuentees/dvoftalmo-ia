import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { getAIConfig } from "@/services/ai/provider";

/**
 * Returns an AI SDK LanguageModelV4 instance wired to our existing config system
 * (DB app_config → env fallback). Accepts an optional per-user model override.
 */
export async function createAISdkModel(userModel?: string | null): Promise<LanguageModelV4> {
  const { provider, model, apiKey } = await getAIConfig(userModel);

  if (provider === "anthropic") {
    return createAnthropic({ apiKey })(model) as unknown as LanguageModelV4;
  }
  if (provider === "gemini") {
    return createGoogleGenerativeAI({ apiKey })(model) as unknown as LanguageModelV4;
  }
  // openai (default)
  return createOpenAI({ apiKey })(model) as unknown as LanguageModelV4;
}
