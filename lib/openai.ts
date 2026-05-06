import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({
  path: ".env.local",
});

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY in .env.local");
}

export const openai = new OpenAI({
  apiKey,
});

export const EMBEDDING_MODEL = "text-embedding-3-small";

export async function createEmbedding(input: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  return response.data[0].embedding;
}