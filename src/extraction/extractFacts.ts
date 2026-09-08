import { v4 as uuidv4 } from "uuid";
import { Fact, ExtractionMethod, PageShape } from "../types";
import { LLMClient } from "../llm/types";

/**
 * Runs the appropriate extraction prompt for a page's shape and fills in the
 * envelope fields (id, document linkage, embedding, timestamps) that the LLM
 * never produces itself — per implementation guide §7.3, those are computed
 * after the LLM call, not part of the response schema.
 */
export async function extractFactsFromPage(params: {
  documentId: string;
  pageNumber: number;
  pageText: string;
  shape: PageShape;
  llm: LLMClient;
}): Promise<Fact[]> {
  const { documentId, pageNumber, pageText, shape, llm } = params;

  if (!pageText.trim()) return [];

  // "mixed" pages: run the tabular prompt, since its column/period-mapping
  // step is a strict superset of what the narrative prompt does and is safer
  // to apply to prose than the reverse (a narrative prompt over a table with
  // no restate-the-columns step is exactly the failure mode §7.2 exists to
  // prevent).
  const method: ExtractionMethod = shape === "narrative" ? "narrative" : "tabular";

  const rawFacts = await llm.extractFacts(pageText, method);

  const facts: Fact[] = [];
  for (const raw of rawFacts) {
    const embeddingInput = `${raw.entity} ${raw.metric}`;
    const embedding = await llm.embed(embeddingInput);
    facts.push({
      id: uuidv4(),
      document_id: documentId,
      entity: raw.entity,
      metric: raw.metric,
      metric_canonical: null, // filled by the async canonicalization pass, §7.5
      value: raw.value,
      value_text: raw.value_text,
      unit: raw.unit,
      time_scope: raw.time_scope,
      qualifiers: raw.qualifiers ?? [],
      source_document_id: documentId,
      source_page: pageNumber,
      source_quote: raw.source_quote,
      extraction_confidence: raw.extraction_confidence,
      extraction_method: method,
      has_visual_content: raw.has_visual_content ?? false,
      embedding,
      created_at: new Date().toISOString(),
    });
  }
  return facts;
}
