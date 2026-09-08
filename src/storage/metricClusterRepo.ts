import { getDb } from "./db";

export interface ClusterRepresentative {
  id: string;
  label: string;
  embedding: number[];
}

function bufferToEmbedding(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}

/** All existing cluster representatives, for comparing new metric vocabulary against. Scales with distinct clusters, not with total fact count. */
export function getAllClusterRepresentatives(): ClusterRepresentative[] {
  const db = getDb();
  const rows = db.prepare(`SELECT id, label, representative_embedding FROM metric_clusters`).all() as {
    id: string;
    label: string;
    representative_embedding: Buffer;
  }[];
  return rows.map((r) => ({ id: r.id, label: r.label, embedding: bufferToEmbedding(r.representative_embedding) }));
}

/** Existing cluster assignment for a metric string, if this exact metric text has already been seen and clustered before (in any prior ingestion). */
export function getClusterForMetricKey(metricKey: string): { cluster_id: string; label: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT mc.id as cluster_id, mc.label as label
       FROM metric_cluster_members mcm JOIN metric_clusters mc ON mcm.cluster_id = mc.id
       WHERE mcm.metric_key = ?`
    )
    .get(metricKey) as { cluster_id: string; label: string } | undefined;
  return row ?? null;
}

export function createCluster(id: string, label: string, embedding: number[], anchorMetricKey: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO metric_clusters (id, label, representative_embedding, created_at) VALUES (?, ?, ?, ?)`
    ).run(id, label, Buffer.from(new Float32Array(embedding).buffer), new Date().toISOString());
    db.prepare(`INSERT INTO metric_cluster_members (metric_key, cluster_id, original_label) VALUES (?, ?, ?)`).run(
      anchorMetricKey,
      id,
      label
    );
  });
  tx();
}

export function addMemberToCluster(metricKey: string, clusterId: string, originalLabel: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO metric_cluster_members (metric_key, cluster_id, original_label) VALUES (?, ?, ?)`
  ).run(metricKey, clusterId, originalLabel);
}

export function getClusterMemberKeys(clusterId: string): string[] {
  const db = getDb();
  const rows = db.prepare(`SELECT metric_key FROM metric_cluster_members WHERE cluster_id = ?`).all(clusterId) as {
    metric_key: string;
  }[];
  return rows.map((r) => r.metric_key);
}

export function getClusterMemberCount(clusterId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as n FROM metric_cluster_members WHERE cluster_id = ?`)
    .get(clusterId) as { n: number };
  return row.n;
}

/** Bulk-updates facts.metric_canonical for every fact whose normalized metric text matches one of the given keys. Bounded by facts sharing this specific metric vocabulary, never a full-corpus scan. */
export function setCanonicalForMetricKeys(metricKeys: string[], canonicalLabel: string | null): void {
  if (metricKeys.length === 0) return;
  const db = getDb();
  const placeholders = metricKeys.map(() => "?").join(",");
  db.prepare(
    `UPDATE facts SET metric_canonical = ? WHERE lower(trim(metric)) IN (${placeholders})`
  ).run(canonicalLabel, ...metricKeys);
}
