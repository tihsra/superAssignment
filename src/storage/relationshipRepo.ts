import { getDb } from "./db";
import { FactRelationship, RelationshipType, ExtractionConfidence } from "../types";

interface RelRow {
  id: string;
  fact_a_id: string;
  fact_b_id: string;
  relationship: RelationshipType;
  reasoning: string;
  confidence: ExtractionConfidence;
  created_at: string;
}

function rowToRel(row: RelRow): FactRelationship {
  return { ...row };
}

/** Order-independent: (A,B) and (B,A) are treated as the same pair via a canonical ordering. */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function relationshipExists(factAId: string, factBId: string): boolean {
  const db = getDb();
  const [a, b] = orderedPair(factAId, factBId);
  const row = db
    .prepare(`SELECT 1 FROM fact_relationships WHERE fact_a_id = ? AND fact_b_id = ?`)
    .get(a, b);
  return !!row;
}

export function insertRelationship(rel: FactRelationship): void {
  const db = getDb();
  const [a, b] = orderedPair(rel.fact_a_id, rel.fact_b_id);
  db.prepare(
    `INSERT OR IGNORE INTO fact_relationships (id, fact_a_id, fact_b_id, relationship, reasoning, confidence, created_at)
     VALUES (@id, @a, @b, @relationship, @reasoning, @confidence, @created_at)`
  ).run({ ...rel, a, b });
}

export function getRelationshipsForFact(factId: string): FactRelationship[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM fact_relationships WHERE fact_a_id = ? OR fact_b_id = ? ORDER BY created_at DESC`)
    .all(factId, factId) as RelRow[];
  return rows.map(rowToRel);
}

export function listRelationships(type?: RelationshipType): FactRelationship[] {
  const db = getDb();
  const rows = type
    ? (db
        .prepare(`SELECT * FROM fact_relationships WHERE relationship = ? ORDER BY created_at DESC`)
        .all(type) as RelRow[])
    : (db.prepare(`SELECT * FROM fact_relationships ORDER BY created_at DESC`).all() as RelRow[]);
  return rows.map(rowToRel);
}
