import dotenv from "dotenv";
import path from "path";

dotenv.config();

function num(val: string | undefined, fallback: number): number {
  if (val === undefined || val === "") return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  extractionModel: process.env.GEMINI_EXTRACTION_MODEL || "gemini-3.6-flash",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
  port: num(process.env.PORT, 3001),
  dbPath: process.env.DB_PATH || path.join(__dirname, "..", "data", "facts.db"),
  llmCacheEnabled: (process.env.LLM_CACHE_ENABLED ?? "true") === "true",
  llmCacheDir: process.env.LLM_CACHE_DIR || path.join(__dirname, "..", "data", "llm-cache"),
  devMaxPages: process.env.DEV_MAX_PAGES ? num(process.env.DEV_MAX_PAGES, 0) || undefined : undefined,
  matchSimilarityThreshold: num(process.env.MATCH_SIMILARITY_THRESHOLD, 0.75),
  canonicalSimilarityThreshold: num(process.env.CANONICAL_SIMILARITY_THRESHOLD, 0.9),
};

export function assertApiKeyPresent(): void {
  if (!config.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add a free key from " +
        "https://aistudio.google.com/apikey (no credit card / GCP project needed)."
    );
  }
}
