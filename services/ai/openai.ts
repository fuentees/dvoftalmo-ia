import OpenAI from "openai";

export const chatModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
export const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

export function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY nao configurada.");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

export async function createEmbedding(input: string) {
  const response = await getOpenAI().embeddings.create({
    model: embeddingModel,
    input
  });

  return response.data[0].embedding;
}
