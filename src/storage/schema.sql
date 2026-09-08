-- Fixed relational shape for the Fact/FactRelationship/Document envelope.
-- See src/types.ts for the canonical TypeScript definitions this mirrors.

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  metric TEXT NOT NULL,
  metric_canonical TEXT,
  value REAL,
  value_text TEXT,
  unit TEXT,
  time_scope_type TEXT NOT NULL,
  time_scope_start TEXT,
  time_scope_end TEXT,
  time_scope_label TEXT NOT NULL,
  qualifiers TEXT NOT NULL DEFAULT '[]', -- JSON array
  source_document_id TEXT NOT NULL,
  source_page INTEGER NOT NULL,
  source_quote TEXT NOT NULL,
  extraction_confidence TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  has_visual_content INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facts_document_id ON facts(document_id);
CREATE INDEX IF NOT EXISTS idx_facts_metric_canonical ON facts(metric_canonical);

CREATE TABLE IF NOT EXISTS fact_relationships (
  id TEXT PRIMARY KEY,
  fact_a_id TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  fact_b_id TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(fact_a_id, fact_b_id)
);

CREATE INDEX IF NOT EXISTS idx_rel_fact_a ON fact_relationships(fact_a_id);
CREATE INDEX IF NOT EXISTS idx_rel_fact_b ON fact_relationships(fact_b_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON fact_relationships(relationship);

-- Maps a fact's TEXT id to the INTEGER rowid that sqlite-vec's vec0 table requires.
CREATE TABLE IF NOT EXISTS fact_vec_map (
  fact_id TEXT PRIMARY KEY REFERENCES facts(id) ON DELETE CASCADE,
  vec_rowid INTEGER NOT NULL UNIQUE
);

-- Incremental metric canonicalization state (the extension described in
-- additional-context.md §9). Persisting cluster representatives means a new
-- ingestion only has to embed and compare its OWN new metric vocabulary
-- against existing cluster representatives, not re-embed and re-cluster
-- every metric string in the whole corpus on every upload.
CREATE TABLE IF NOT EXISTS metric_clusters (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,               -- original-casing text of the anchor metric
  representative_embedding BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_cluster_members (
  metric_key TEXT PRIMARY KEY,       -- normalized (trim+lowercase) metric text
  cluster_id TEXT NOT NULL REFERENCES metric_clusters(id) ON DELETE CASCADE,
  original_label TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster_id ON metric_cluster_members(cluster_id);

-- vec0 virtual table itself is created at runtime in db.ts (its dimension is a
-- config constant, not something we want silently hardcoded in two places).
