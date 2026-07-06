import type { AIProvider } from "@/services/ai/provider";

export interface ModelOption {
  id: string;
  label: string;
  provider: AIProvider;
  description: string;
}

export const MODEL_CATALOG: ModelOption[] = [
  // OpenAI
  { id: "gpt-4.1-mini",       label: "GPT-4.1 Mini",        provider: "openai",    description: "Rápido e econômico" },
  { id: "gpt-4.1",            label: "GPT-4.1",             provider: "openai",    description: "Equilibrado" },
  { id: "o4-mini",            label: "o4-mini",             provider: "openai",    description: "Raciocínio rápido" },
  // Anthropic
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  provider: "anthropic", description: "Rápido e econômico" },
  { id: "claude-sonnet-4-5",         label: "Claude Sonnet 4.5", provider: "anthropic", description: "Equilibrado" },
  { id: "claude-opus-4-8",           label: "Claude Opus 4.8",  provider: "anthropic", description: "Máxima capacidade" },
  // Gemini
  { id: "gemini-2.5-flash",   label: "Gemini 2.5 Flash",   provider: "gemini",    description: "Rápido" },
  { id: "gemini-2.5-pro",     label: "Gemini 2.5 Pro",     provider: "gemini",    description: "Avançado" },
];

export function modelById(id: string): ModelOption | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function modelsByProvider(provider: AIProvider): ModelOption[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}
