import { PageShape, RawExtractedFact, RelationshipType, ExtractionConfidence } from "../types";

export interface JudgeInput {
  fact_a: unknown;
  fact_b: unknown;
}

export interface JudgeResult {
  relationship: RelationshipType;
  confidence: ExtractionConfidence;
  reasoning: string;
}

/**
 * Every LLM call the pipeline needs, behind one interface. Nothing outside
 * /src/llm should import @google/generative-ai directly — that keeps the
 * provider swappable per implementation guide §5.
 */
export interface LLMClient {
  classifyPage(pageText: string): Promise<PageShape>;
  extractFacts(pageText: string, method: "tabular" | "narrative"): Promise<RawExtractedFact[]>;
  judgeRelationship(input: JudgeInput): Promise<JudgeResult>;
  embed(text: string): Promise<number[]>;
}
