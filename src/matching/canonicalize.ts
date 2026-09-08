import { LLMClient } from "../llm/types";
import { Fact } from "../types";
import { cosineSimilarity } from "./vectorMath";
import { config } from "../config";
import { v4 as uuidv4 } from "uuid";
import {
  getAllClusterRepresentatives,
  getClusterForMetricKey,
  createCluster,
  addMemberToCluster,
  getClusterMemberKeys,
  getClusterMemberCount,
  setCanonicalForMetricKeys,
} from "../storage/metricClusterRepo";

/**
 * INCREMENTAL canonicalization — the one extension additional-context.md §9
 * asks to pick and finish properly: "only re-run candidate matching for
 * facts touching the newly uploaded document, not the whole corpus." The
 * matching/judging step (candidateMatch.ts) already gets this for free from
 * sqlite-vec's KNN index. This module is what makes canonicalization match
 * that property too, instead of re-embedding and re-clustering every metric
 * string in the whole corpus on every upload.
 *
 * Only pass the NEW document's facts in. Cost scales with (a) how much new
 * metric vocabulary this document introduces, and (b) how many existing
 * facts share a metric string with a cluster that just grew past size 1 —
 * never with total corpus size.
 *
 * Same tight-threshold design intent as before (additional-context.md §3):
 * a cluster only gets a non-null metric_canonical once it has 2+ members. A
 * metric nobody else has used yet stays null rather than guessing a merge.
 */
export async function canonicalizeMetricsIncremental(
  llm: LLMClient,
  newFacts: Fact[]
): Promise<{ newClusters: number; clustersGrown: number; factsBackfilled: number }> {
  if (newFacts.length === 0) return { newClusters: 0, clustersGrown: 0, factsBackfilled: 0 };

  // De-dupe to the distinct metric strings this document actually introduced.
  const metricGroups = new Map<string, string>(); // normalized key -> original-casing label
  for (const f of newFacts) {
    const key = f.metric.trim().toLowerCase();
    if (!metricGroups.has(key)) metricGroups.set(key, f.metric);
  }

  let newClusters = 0;
  const clustersTouched = new Set<string>();

  for (const [key, originalLabel] of metricGroups) {
    // Already-seen vocabulary (e.g. "Total income" appearing again in a new
    // document): reuse its existing cluster assignment, no embed call spent.
    const existingAssignment = getClusterForMetricKey(key);
    if (existingAssignment) {
      clustersTouched.add(existingAssignment.cluster_id);
      continue;
    }

    const embedding = await llm.embed(originalLabel);

    const representatives = getAllClusterRepresentatives();
    let bestClusterId: string | null = null;
    let bestSim = -1;
    for (const rep of representatives) {
      const sim = cosineSimilarity(embedding, rep.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestClusterId = rep.id;
      }
    }

    if (bestClusterId && bestSim >= config.canonicalSimilarityThreshold) {
      addMemberToCluster(key, bestClusterId, originalLabel);
      clustersTouched.add(bestClusterId);
    } else {
      const newClusterId = uuidv4();
      createCluster(newClusterId, originalLabel, embedding, key);
      clustersTouched.add(newClusterId);
      newClusters++;
    }
  }

  // For every cluster this ingestion touched, re-derive whether it should
  // carry a canonical label (size >= 2) and push that to every fact sharing
  // any of that cluster's metric keys — including OLD facts from earlier
  // documents, if this ingestion is what pushed the cluster from a singleton
  // to a real cluster. This backfill is bounded by that cluster's member
  // keys, not the corpus.
  let clustersGrown = 0;
  let factsBackfilled = 0;
  for (const clusterId of clustersTouched) {
    const memberCount = getClusterMemberCount(clusterId);
    const keys = getClusterMemberKeys(clusterId);
    if (memberCount >= 2) {
      // Look up the cluster's label once via any member's original_label is
      // unnecessary — getAllClusterRepresentatives already carries `label`,
      // but for a touched-and-newly-created cluster it's simplest to refetch.
      const rep = getAllClusterRepresentatives().find((r) => r.id === clusterId);
      const label = rep ? rep.label : null;
      setCanonicalForMetricKeys(keys, label);
      clustersGrown++;
    } else {
      setCanonicalForMetricKeys(keys, null);
    }
    factsBackfilled += keys.length;
  }

  return { newClusters, clustersGrown, factsBackfilled };
}
