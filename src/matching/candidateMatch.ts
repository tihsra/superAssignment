import { Fact } from "../types";
import { findNearestFacts, Candidate } from "../storage/factRepo";
import { config } from "../config";

/**
 * Blocking step (guide §7.6): for a fact, returns candidate facts from OTHER
 * documents above the similarity threshold. This exists specifically so full
 * pairwise LLM comparison never happens — additional-context.md §5 calls
 * that out as an anti-pattern ("expensive, and it's brute force, not
 * reasoning"). Only these candidates are eligible for the judge LLM.
 */
export function findCandidatesForFact(fact: Fact, k = 10): Candidate[] {
  return findNearestFacts(fact.embedding, fact.id, fact.document_id, k, config.matchSimilarityThreshold);
}
