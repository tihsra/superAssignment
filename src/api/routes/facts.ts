import { Router } from "express";
import { getFact } from "../../storage/factRepo";
import { getRelationshipsForFact } from "../../storage/relationshipRepo";

export const factsRouter = Router();

// GET /facts/:id — single fact with full evidence.
factsRouter.get("/:id", (req, res) => {
  const fact = getFact(req.params.id);
  if (!fact) {
    res.status(404).json({ error: "Fact not found" });
    return;
  }
  res.json(fact);
});

// GET /facts/:id/relationships — relationships involving this fact.
factsRouter.get("/:id/relationships", (req, res) => {
  const fact = getFact(req.params.id);
  if (!fact) {
    res.status(404).json({ error: "Fact not found" });
    return;
  }
  res.json(getRelationshipsForFact(req.params.id));
});
