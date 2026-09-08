import { getDb } from "./db";
import { Fact, ExtractionConfidence, ExtractionMethod, TimeScopeType } from "../types";

interface FactRow {
  id: string;
  document_id: string;
  entity: string;
  metric: string;
  metric_canonical: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  time_scope_type: TimeScopeType;
  time_scope_start: string | null;
  time_scope_end: string | null;
  time_scope_label: string;
  qualifiers: string; // JSON
  source_document_id: string;
  source_page: number;
  source_quote: string;
  extraction_confidence: ExtractionConfidence;
  extraction_method: ExtractionMethod;
  has_visual_content: number;
  created_at: string;
}

function rowToFact(row: FactRow): Fact {
  return {
    id: row.id,
    document_id: row.document_id,
    entity: row.entity,
    metric: row.metric,
    metric_canonical: row.metric_canonical,
    value: row.value,
    value_text: row.value_text,
    unit: row.unit,
    time_scope: {
      type: row.time_scope_type,
      start: row.time_scope_start,
      end: row.time_scope_end,
      label: row.time_scope_label,
    },
    qualifiers: JSON.parse(row.qualifiers),
    source_document_id: row.source_document_id,
    source_page: row.source_page,
    source_quote: row.source_quote,
    extraction_confidence: row.extraction_confidence,
    extraction_method: row.extraction_method,
    has_visual_content: !!row.has_visual_content,
    embedding: [], // populated separately via getFactEmbedding when actually needed
    created_at: row.created_at,
  };
}

/** Inserts a fact and its embedding (into the vec0 side table) in one transaction. */
export function insertFact(fact: Fact): void {
  const db = getDb();
  const insertFactStmt = db.prepare(
    `INSERT INTO facts (
      id, document_id, entity, metric, metric_canonical, value, value_text, unit,
      time_scope_type, time_scope_start, time_scope_end, time_scope_label,
      qualifiers, source_document_id, source_page, source_quote,
      extraction_confidence, extraction_method, has_visual_content, created_at
    ) VALUES (
      @id, @document_id, @entity, @metric, @metric_canonical, @value, @value_text, @unit,
      @time_scope_type, @time_scope_start, @time_scope_end, @time_scope_label,
      @qualifiers, @source_document_id, @source_page, @source_quote,
      @extraction_confidence, @extraction_method, @has_visual_content, @created_at
    )`
  );
  const insertVecStmt = db.prepare(`INSERT INTO vec_facts (embedding) VALUES (?)`);
  const insertMapStmt = db.prepare(`INSERT INTO fact_vec_map (fact_id, vec_rowid) VALUES (?, ?)`);

  const tx = db.transaction(() => {
    insertFactStmt.run({
      id: fact.id,
      document_id: fact.document_id,
      entity: fact.entity,
      metric: fact.metric,
      metric_canonical: fact.metric_canonical,
      value: fact.value,
      value_text: fact.value_text,
      unit: fact.unit,
      time_scope_type: fact.time_scope.type,
      time_scope_start: fact.time_scope.start,
      time_scope_end: fact.time_scope.end,
      time_scope_label: fact.time_scope.label,
      qualifiers: JSON.stringify(fact.qualifiers),
      source_document_id: fact.source_document_id,
      source_page: fact.source_page,
      source_quote: fact.source_quote,
      extraction_confidence: fact.extraction_confidence,
      extraction_method: fact.extraction_method,
      has_visual_content: fact.has_visual_content ? 1 : 0,
      created_at: fact.created_at,
    });

    if (fact.embedding && fact.embedding.length > 0) {
      const info = insertVecStmt.run(Buffer.from(new Float32Array(fact.embedding).buffer));
      insertMapStmt.run(fact.id, info.lastInsertRowid);
    }
  });
  tx();
}

export function getFact(id: string): Fact | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM facts WHERE id = ?`).get(id) as FactRow | undefined;
  return row ? rowToFact(row) : null;
}

export function getFactsByDocument(documentId: string): Fact[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM facts WHERE document_id = ? ORDER BY source_page, created_at`)
    .all(documentId) as FactRow[];
  return rows.map(rowToFact);
}

export function getAllFacts(): Fact[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM facts ORDER BY created_at`).all() as FactRow[];
  return rows.map(rowToFact);
}

export function updateMetricCanonical(factId: string, canonical: string | null): void {
  const db = getDb();
  db.prepare(`UPDATE facts SET metric_canonical = ? WHERE id = ?`).run(canonical, factId);
}

/**
 * K nearest neighbors by cosine similarity, excluding facts from the same
 * document (relationships are meant to be cross-document comparisons; two
 * facts on the same page are not "corroborating" each other in the sense
 * this system cares about).
 */
export interface Candidate {
  fact_id: string;
  similarity: number;
}

export function findNearestFacts(
  embedding: number[],
  excludeFactId: string,
  excludeDocumentId: string,
  k: number,
  minSimilarity: number
): Candidate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.rowid as rowid, v.distance as distance
       FROM vec_facts v
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`
    )
    .all(Buffer.from(new Float32Array(embedding).buffer), k) as { rowid: number; distance: number }[];

  if (rows.length === 0) return [];

  const rowids = rows.map((r) => r.rowid);
  const placeholders = rowids.map(() => "?").join(",");
  const mapRows = db
    .prepare(`SELECT fact_id, vec_rowid FROM fact_vec_map WHERE vec_rowid IN (${placeholders})`)
    .all(...rowids) as { fact_id: string; vec_rowid: number }[];
  const rowidToFactId = new Map(mapRows.map((m) => [m.vec_rowid, m.fact_id]));

  const excludeDocFactIds = new Set(
    (db.prepare(`SELECT id FROM facts WHERE document_id = ?`).all(excludeDocumentId) as { id: string }[]).map(
      (r) => r.id
    )
  );

  const out: Candidate[] = [];
  for (const row of rows) {
    const factId = rowidToFactId.get(row.rowid);
    if (!factId) continue;
    if (factId === excludeFactId) continue;
    if (excludeDocFactIds.has(factId)) continue;
    // cosine distance -> similarity
    const similarity = 1 - row.distance;
    if (similarity >= minSimilarity) {
      out.push({ fact_id: factId, similarity });
    }
  }
  return out;
}

export function getFactEmbeddingRaw(factId: string): number[] | null {
  const db = getDb();
  const mapRow = db.prepare(`SELECT vec_rowid FROM fact_vec_map WHERE fact_id = ?`).get(factId) as
    | { vec_rowid: number }
    | undefined;
  if (!mapRow) return null;
  const vecRow = db.prepare(`SELECT embedding FROM vec_facts WHERE rowid = ?`).get(mapRow.vec_rowid) as
    | { embedding: Buffer }
    | undefined;
  if (!vecRow) return null;
  return Array.from(new Float32Array(vecRow.embedding.buffer, vecRow.embedding.byteOffset, vecRow.embedding.length / 4));
}
