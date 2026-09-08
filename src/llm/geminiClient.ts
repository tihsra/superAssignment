import { config, assertApiKeyPresent } from "../config";
import { LLMClient, JudgeInput, JudgeResult } from "./types";
import { PageShape, RawExtractedFact } from "../types";
import { withBackoff } from "./retry";
import { cached, PROMPT_VERSIONS } from "./cache";
import { EMBEDDING_DIM } from "../storage/db";
import { tabularPrompt, narrativePrompt, CLASSIFY_PROMPT_PREFIX } from "../extraction/prompts";
import { judgePrompt } from "../judging/prompts";

/**
 * Uses @google/genai, the current unified Google Gen AI SDK — not
 * @google/generative-ai, which Google has fully deprecated (its own README
 * now says "This SDK is now deprecated, use the new unified Google GenAI
 * SDK"). This project originally shipped on the old SDK; migrated after a
 * live run against a real Gemini key returned a 404 for the gemini-2.0-flash
 * model ID with an explicit "no longer available" message. Two things
 * changed, not just a model name:
 *   1. The SDK package itself (@google/generative-ai -> @google/genai).
 *   2. The embedding model: text-embedding-004 was fully shut down on
 *      January 14, 2026, not just renamed. Its replacement (gemini-embedding-2)
 *      defaults to 3072-dimensional output; `outputDimensionality` below
 *      truncates it back to 768 (Matryoshka Representation Learning — the
 *      model supports this natively) so it stays compatible with this
 *      project's fixed-width sqlite-vec schema without a migration.
 * See README "A real finding" section for the full write-up.
 *
 * @google/genai v2 ships ESM-only, same situation as pdfjs-dist
 * (src/ingestion/pdfExtractor.ts) — hence the dynamic import from this
 * CommonJS module rather than a static `import`. Response-schema objects
 * below use plain string literals ("OBJECT", "STRING", ...) instead of the
 * SDK's `Type` enum so no value-level import of the package is needed at
 * module-eval time; the SDK's own `responseSchema` field type accepts
 * `unknown`, so this needs no cast.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let genaiModulePromise: Promise<any> | null = null;
function loadGenAI() {
  if (!genaiModulePromise) genaiModulePromise = import("@google/genai");
  return genaiModulePromise;
}

const timeScopeSchema = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ["point_in_time", "period", "unspecified"] },
    start: { type: "STRING", nullable: true, description: "ISO date or null" },
    end: { type: "STRING", nullable: true, description: "ISO date or null" },
    label: { type: "STRING", description: "raw text as written, e.g. 'Q4 FY24'" },
  },
  required: ["type", "label"],
};

const factSchema = {
  type: "OBJECT",
  properties: {
    entity: { type: "STRING" },
    metric: { type: "STRING" },
    value: { type: "NUMBER", nullable: true },
    value_text: { type: "STRING", nullable: true },
    unit: { type: "STRING", nullable: true },
    time_scope: timeScopeSchema,
    qualifiers: { type: "ARRAY", items: { type: "STRING" } },
    source_quote: { type: "STRING" },
    extraction_confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    has_visual_content: { type: "BOOLEAN", nullable: true },
  },
  required: [
    "entity",
    "metric",
    "value",
    "value_text",
    "unit",
    "time_scope",
    "qualifiers",
    "source_quote",
    "extraction_confidence",
  ],
};

const extractionResponseSchema = {
  type: "OBJECT",
  properties: {
    facts: { type: "ARRAY", items: factSchema },
  },
  required: ["facts"],
};

const classifyResponseSchema = {
  type: "OBJECT",
  properties: {
    shape: { type: "STRING", enum: ["tabular", "narrative", "mixed"] },
  },
  required: ["shape"],
};

const judgeResponseSchema = {
  type: "OBJECT",
  properties: {
    relationship: {
      type: "STRING",
      enum: ["corroborates", "contradicts", "reconciled_by_context", "unrelated"],
    },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    reasoning: { type: "STRING" },
  },
  required: ["relationship", "confidence", "reasoning"],
};

export class GeminiClient implements LLMClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private aiPromise: Promise<any> | null = null;

  constructor() {
    assertApiKeyPresent();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getAI(): Promise<any> {
    if (!this.aiPromise) {
      this.aiPromise = loadGenAI().then((mod) => new mod.GoogleGenAI({ apiKey: config.geminiApiKey }));
    }
    return this.aiPromise;
  }

  async classifyPage(pageText: string): Promise<PageShape> {
    return cached("classify", PROMPT_VERSIONS.classify, pageText, async () => {
      const ai = await this.getAI();
      const response: any = await withBackoff(
        () =>
          ai.models.generateContent({
            model: config.extractionModel,
            contents: CLASSIFY_PROMPT_PREFIX + pageText,
            config: {
              responseMimeType: "application/json",
              responseSchema: classifyResponseSchema,
            },
          }),
        "classifyPage"
      );
      const parsed = JSON.parse(response.text ?? "{}");
      return parsed.shape as PageShape;
    });
  }

  async extractFacts(pageText: string, method: "tabular" | "narrative"): Promise<RawExtractedFact[]> {
    const prompt = method === "tabular" ? tabularPrompt(pageText) : narrativePrompt(pageText);
    const promptVersion =
      method === "tabular" ? PROMPT_VERSIONS.extractTabular : PROMPT_VERSIONS.extractNarrative;

    return cached(`extract-${method}`, promptVersion, pageText, async () => {
      const ai = await this.getAI();
      const response: any = await withBackoff(
        () =>
          ai.models.generateContent({
            model: config.extractionModel,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: extractionResponseSchema,
            },
          }),
        `extractFacts:${method}`
      );
      const parsed = JSON.parse(response.text ?? "{}");
      return (parsed.facts ?? []) as RawExtractedFact[];
    });
  }

  async judgeRelationship(input: JudgeInput): Promise<JudgeResult> {
    const factAJson = JSON.stringify(input.fact_a);
    const factBJson = JSON.stringify(input.fact_b);
    const cacheKey = `${factAJson}|||${factBJson}`;

    return cached("judge", PROMPT_VERSIONS.judge, cacheKey, async () => {
      const ai = await this.getAI();
      const response: any = await withBackoff(
        () =>
          ai.models.generateContent({
            model: config.extractionModel,
            contents: judgePrompt(factAJson, factBJson),
            config: {
              responseMimeType: "application/json",
              responseSchema: judgeResponseSchema,
            },
          }),
        "judgeRelationship"
      );
      const parsed = JSON.parse(response.text ?? "{}");
      return parsed as JudgeResult;
    });
  }

  async embed(text: string): Promise<number[]> {
    return cached("embed", PROMPT_VERSIONS.embed, text, async () => {
      const ai = await this.getAI();
      const response: any = await withBackoff(
        () =>
          ai.models.embedContent({
            model: config.embeddingModel,
            contents: text,
            config: { outputDimensionality: EMBEDDING_DIM },
          }),
        "embed"
      );
      const values = response.embeddings?.[0]?.values;
      if (!values) {
        throw new Error(`embedContent returned no embedding values for model ${config.embeddingModel}`);
      }
      return values;
    });
  }
}

let singleton: LLMClient | null = null;

/** Lazy singleton so importing this module doesn't require an API key until an LLM call is actually made. */
export function getLLMClient(): LLMClient {
  if (!singleton) singleton = new GeminiClient();
  return singleton;
}
