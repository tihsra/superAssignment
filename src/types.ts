/**
 * Fixed envelope, open content.
 *
 * These shapes never change across documents. What fills them (entity names,
 * metric names, qualifiers, values) is entirely LLM-derived per document, with
 * zero hardcoded vocabulary anywhere in this codebase. See
 * fact-knowledge-layer-additional-context.md §2 for the design rationale, and
 * grep the repo for hardcoded entity/metric/filename logic before considering
 * any change to this file done — there should be none.
 */

export type ExtractionConfidence = "high" | "medium" | "low";
export type ExtractionMethod = "tabular" | "narrative";
export type PageShape = "tabular" | "narrative" | "mixed";
export type TimeScopeType = "point_in_time" | "period" | "unspecified";
export type RelationshipType =
  | "corroborates"
  | "contradicts"
  | "reconciled_by_context"
  | "unrelated";
export type DocumentStatus = "processing" | "ready" | "failed";

export interface TimeScope {
  type: TimeScopeType;
  start: string | null; // ISO date, null if not derivable
  end: string | null;
  label: string; // raw text as written, e.g. "Q4 FY24"
}

export interface Fact {
  id: string;
  document_id: string;
  entity: string; // free text, LLM-derived
  metric: string; // free text, LLM-derived, exactly as labeled on the page
  metric_canonical: string | null; // filled by async clustering pass (§7.5)
  value: number | null;
  value_text: string | null; // for qualitative facts, e.g. "director resigned"
  unit: string | null; // "INR crore", "INR million", "%", null for qualitative
  time_scope: TimeScope;
  qualifiers: string[]; // e.g. ["standalone"], ["restated"]
  source_document_id: string;
  source_page: number;
  source_quote: string; // verbatim, <= ~40 words
  extraction_confidence: ExtractionConfidence;
  extraction_method: ExtractionMethod;
  has_visual_content?: boolean; // true if the page had chart-only data the text layer missed
  embedding: number[]; // over `entity + " " + metric`
  created_at: string;
}

/** Shape the LLM actually returns for one fact — everything except what we compute ourselves. */
export interface RawExtractedFact {
  entity: string;
  metric: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  time_scope: TimeScope;
  qualifiers: string[];
  source_quote: string;
  extraction_confidence: ExtractionConfidence;
  has_visual_content?: boolean;
}

export interface FactRelationship {
  id: string;
  fact_a_id: string;
  fact_b_id: string;
  relationship: RelationshipType;
  reasoning: string; // shown in UI verbatim — this is the case evidence
  confidence: ExtractionConfidence;
  created_at: string;
}

export interface Document {
  id: string;
  filename: string;
  uploaded_at: string;
  page_count: number;
  status: DocumentStatus;
  error: string | null;
}

export interface PageText {
  page_number: number;
  text: string;
  shape: PageShape;
}
