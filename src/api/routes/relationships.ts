import { Router } from "express";
import { listRelationships } from "../../storage/relationshipRepo";
import { getFact } from "../../storage/factRepo";
import { RelationshipType } from "../../types";

export const relationshipsRouter = Router();

const VALID_TYPES: RelationshipType[] = ["corroborates", "contradicts", "reconciled_by_context", "unrelated"];

// GET /relationships?type=contradicts — browse all, filterable.
// Enriches each relationship with both facts inline (evidence + reasoning
// side by side, per additional-context.md §5: "the reasoning text visible in
// full" is the actual deliverable, not a graph view hiding it behind a click).
relationshipsRouter.get("/", (req, res) => {
  const typeParam = req.query.type as string | undefined;
  if (typeParam && !VALID_TYPES.includes(typeParam as RelationshipType)) {
    res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` });
    return;
  }

  const rels = listRelationships(typeParam as RelationshipType | undefined);
  const enriched = rels
    .map((rel) => ({
      ...rel,
      fact_a: getFact(rel.fact_a_id),
      fact_b: getFact(rel.fact_b_id),
    }))
    .filter((rel) => rel.fact_a && rel.fact_b);

  res.json(enriched);
});
