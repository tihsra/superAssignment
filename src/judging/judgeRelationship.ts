import { v4 as uuidv4 } from "uuid";
import { Fact, FactRelationship } from "../types";
import { LLMClient } from "../llm/types";
import { relationshipExists, insertRelationship } from "../storage/relationshipRepo";

/** Strips the raw embedding vector before sending a fact to the judge prompt — it's dead weight in the prompt and irrelevant to the reasoning. */
function factForPrompt(fact: Fact) {
  const { embedding, ...rest } = fact;
  return rest;
}

export async function judgeAndStore(factA: Fact, factB: Fact, llm: LLMClient): Promise<FactRelationship | null> {
  if (relationshipExists(factA.id, factB.id)) return null;

  const result = await llm.judgeRelationship({
    fact_a: factForPrompt(factA),
    fact_b: factForPrompt(factB),
  });

  const relationship: FactRelationship = {
    id: uuidv4(),
    fact_a_id: factA.id,
    fact_b_id: factB.id,
    relationship: result.relationship,
    reasoning: result.reasoning,
    confidence: result.confidence,
    created_at: new Date().toISOString(),
  };

  insertRelationship(relationship);
  return relationship;
}
