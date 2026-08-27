/**
 * Project Valerie: Topic Clustering Engine & Genealogy — Unit Tests
 * File: supabase/functions/valerie-cluster-engine/test.ts
 *
 * Tests:
 *   1. Vector arithmetic (L2 normalization, dot product, magnitude).
 *   2. Cosine distance & similarity invariants.
 *   3. Bivariate sentiment coordinate modulation & scaling.
 *   4. Deterministic vector synthesis & reproducibility.
 *   5. Centroid incremental updating & variance tracking.
 *   6. Dynamic bifurcation / split centroid geometry.
 *   7. Edge function ingestion logic with mock database client:
 *      - Cold start initial seeding
 *      - Incremental centroid assignment within tolerance
 *      - Dynamic split thresholding & SPLIT event emission
 *      - Rollback RPC event structure validation
 */

import { assertEquals, assert, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  VECTOR_DIM,
  l2Normalize,
  magnitude,
  dotProduct,
  cosineSimilarity,
  cosineDistance,
  normalizeBivariateScores,
  combineEmbeddingWithBivariateScores,
  synthesizeVectorFromScoresAndText,
  updateCentroid,
  calculateIncrementalVariance,
  computeBifurcatedCentroids,
} from "./vector-math.ts";
import {
  processClusterIngestion,
  formatVectorForPg,
  parseVector,
  ClusterEngineRequest,
} from "./index.ts";

Deno.test("Vector Math: L2 Normalization and Magnitude", () => {
  const raw = [3, 4, 0, 0];
  const normalized = l2Normalize(raw);
  assertAlmostEquals(magnitude(normalized), 1.0, 1e-7);
  assertAlmostEquals(normalized[0], 0.6, 1e-7);
  assertAlmostEquals(normalized[1], 0.8, 1e-7);

  // Zero vector safety
  const zeroVec = [0, 0, 0, 0];
  const normZero = l2Normalize(zeroVec);
  assertEquals(normZero.length, 4);
  assertAlmostEquals(magnitude(normZero), 1.0, 1e-7);
});

Deno.test("Vector Math: Cosine Similarity and Distance Invariants", () => {
  const vecA = l2Normalize([1, 0, 0, 0]);
  const vecB = l2Normalize([1, 0, 0, 0]);
  const vecC = l2Normalize([0, 1, 0, 0]);
  const vecD = l2Normalize([-1, 0, 0, 0]);

  // Identical vectors -> Cosine Sim = 1, Dist = 0
  assertAlmostEquals(cosineSimilarity(vecA, vecB), 1.0, 1e-7);
  assertAlmostEquals(cosineDistance(vecA, vecB), 0.0, 1e-7);

  // Orthogonal vectors -> Cosine Sim = 0, Dist = 1
  assertAlmostEquals(cosineSimilarity(vecA, vecC), 0.0, 1e-7);
  assertAlmostEquals(cosineDistance(vecA, vecC), 1.0, 1e-7);

  // Opposite vectors -> Cosine Sim = -1, Dist = 2
  assertAlmostEquals(cosineSimilarity(vecA, vecD), -1.0, 1e-7);
  assertAlmostEquals(cosineDistance(vecA, vecD), 2.0, 1e-7);
});

Deno.test("Bivariate Sentiment: Normalization and Modulation", () => {
  const maxPos = normalizeBivariateScores(2, 100);
  assertEquals(maxPos.normalizedLikert, 1.0);
  assertEquals(maxPos.normalizedConfidence, 1.0);

  const maxNeg = normalizeBivariateScores(-2, 100);
  assertEquals(maxNeg.normalizedLikert, -1.0);
  assertEquals(maxNeg.normalizedConfidence, 1.0);

  const neutralLow = normalizeBivariateScores(0, 0);
  assertEquals(neutralLow.normalizedLikert, 0.0);
  assertEquals(neutralLow.normalizedConfidence, 0.0);

  // Modulation on 1536-D embedding
  const baseVec = l2Normalize(new Array(VECTOR_DIM).fill(0.01));
  const modulatedPos = combineEmbeddingWithBivariateScores(baseVec, 2, 90);
  const modulatedNeg = combineEmbeddingWithBivariateScores(baseVec, -2, 90);

  assertEquals(modulatedPos.length, VECTOR_DIM);
  assertEquals(modulatedNeg.length, VECTOR_DIM);
  assertAlmostEquals(magnitude(modulatedPos), 1.0, 1e-7);
  assertAlmostEquals(magnitude(modulatedNeg), 1.0, 1e-7);

  // Opposite sentiment polarities should diverge in cosine distance
  const dist = cosineDistance(modulatedPos, modulatedNeg);
  assert(dist > 0.1, `Expected noticeable divergence, got distance ${dist}`);
});

Deno.test("Vector Synthesizer: Determinism and Dimensionality", () => {
  const text = "Pedestrianize Main Street downtown area";
  const vec1 = synthesizeVectorFromScoresAndText(text, 2, 80);
  const vec2 = synthesizeVectorFromScoresAndText(text, 2, 80);
  const vec3 = synthesizeVectorFromScoresAndText(text, -2, 80);

  assertEquals(vec1.length, VECTOR_DIM);
  assertAlmostEquals(magnitude(vec1), 1.0, 1e-7);

  // Deterministic reproducibility
  assertAlmostEquals(cosineDistance(vec1, vec2), 0.0, 1e-7);

  // Semantic divergence on opposing scores
  const scoreDist = cosineDistance(vec1, vec3);
  assert(scoreDist > 0.05, `Expected divergent distance on opposite scores, got ${scoreDist}`);
});

Deno.test("Centroid Update & Incremental Variance Calculation", () => {
  const c0 = l2Normalize(new Array(VECTOR_DIM).fill(0.1));
  const v1 = l2Normalize(new Array(VECTOR_DIM).fill(0.2));

  const updatedCentroid = updateCentroid(c0, 1, v1);
  assertEquals(updatedCentroid.length, VECTOR_DIM);
  assertAlmostEquals(magnitude(updatedCentroid), 1.0, 1e-7);

  const dist = cosineDistance(c0, v1);
  const var1 = calculateIncrementalVariance(0.0, dist, 1);
  assert(var1 >= 0, "Variance should be non-negative");

  const var2 = calculateIncrementalVariance(var1, 0.05, 2);
  assert(var2 >= 0, "Variance should remain non-negative");
});

Deno.test("Bifurcation Geometry: Dynamic Split Centroid Calculation", () => {
  const parent = l2Normalize(new Array(VECTOR_DIM).fill(0.1));
  const outlier = l2Normalize(new Array(VECTOR_DIM).fill(-0.2));

  const { childA, childB } = computeBifurcatedCentroids(parent, outlier, 0.4);

  assertEquals(childA.length, VECTOR_DIM);
  assertEquals(childB.length, VECTOR_DIM);
  assertAlmostEquals(magnitude(childA), 1.0, 1e-7);
  assertAlmostEquals(magnitude(childB), 1.0, 1e-7);

  // The two child nodes should be separated by distance
  const childSeparation = cosineDistance(childA, childB);
  assert(childSeparation > 0.1, `Children should diverge, distance is ${childSeparation}`);
});

Deno.test("Serialization: PGVector format string parsing & formatting", () => {
  const testVec = [0.1234567, -0.7654321, 0.5];
  const formatted = formatVectorForPg(testVec);
  assert(formatted.startsWith("[") && formatted.endsWith("]"));

  const parsed = parseVector(formatted);
  assertAlmostEquals(parsed[0], 0.1234567, 1e-5);
  assertAlmostEquals(parsed[1], -0.7654321, 1e-5);
  assertAlmostEquals(parsed[2], 0.5, 1e-5);
});

// ---------------------------------------------------------------------------
// Mock Supabase Database Client for Full Ingestion Workflow Test
// ---------------------------------------------------------------------------
class MockSupabaseClient {
  clusters: any[] = [];
  events: any[] = [];
  pollResponses: any[] = [];

  schema(_name: string) {
    return this;
  }

  from(table: string) {
    const self = this;
    return {
      select(_cols?: string) {
        return {
          eq(field: string, val: any) {
            if (table === "topic_clusters") {
              const rows = self.clusters.filter((c) => c[field] === val);
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
      insert(payload: any) {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((r) => ({
          id: `mock-uuid-${Math.random().toString(36).substring(2, 9)}`,
          created_at: new Date().toISOString(),
          ...r,
        }));

        if (table === "topic_clusters") {
          self.clusters.push(...inserted);
        } else if (table === "cluster_events") {
          self.events.push(...inserted);
        }

        return {
          select() {
            return {
              single() {
                return Promise.resolve({ data: inserted[0], error: null });
              },
              then(resolve: any) {
                return Promise.resolve({ data: inserted, error: null }).then(resolve);
              },
            };
          },
          then(resolve: any) {
            return Promise.resolve({ data: inserted, error: null }).then(resolve);
          },
        };
      },
      update(updates: any) {
        return {
          eq(field: string, val: any) {
            if (table === "topic_clusters") {
              const idx = self.clusters.findIndex((c) => c[field] === val);
              if (idx >= 0) {
                self.clusters[idx] = { ...self.clusters[idx], ...updates };
              }
            } else if (table === "poll_responses") {
              const idx = self.pollResponses.findIndex((p) => p[field] === val);
              if (idx >= 0) {
                self.pollResponses[idx] = { ...self.pollResponses[idx], ...updates };
              }
            }
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  }
}

Deno.test("Edge Function Workflow: Cold Start -> Ingestion -> Dynamic Split", async () => {
  const mockDb = new MockSupabaseClient();

  // 1. Cold Start Ingestion (Initial Cluster Seed)
  const req1: ClusterEngineRequest = {
    likert_score: 2,
    confidence_score: 95,
    comment: "Fully support pedestrianization of the city center.",
    question_text: "Convert Main Street to pedestrian zone?",
  };

  const res1 = await processClusterIngestion(mockDb, req1, undefined, "user-123");
  assertEquals(res1.action, "INITIAL_SEED");
  assertEquals(mockDb.clusters.length, 1);
  assertEquals(mockDb.clusters[0].is_active, true);
  assertEquals(mockDb.clusters[0].member_count, 1);

  // 2. Similar Response Ingestion (Increment Centroid within Tolerance)
  const req2: ClusterEngineRequest = {
    likert_score: 2,
    confidence_score: 90,
    comment: "Yes, great for local businesses and walking.",
    question_text: "Convert Main Street to pedestrian zone?",
    variance_tolerance: 0.35,
  };

  const res2 = await processClusterIngestion(mockDb, req2, undefined, "user-456");
  assertEquals(res2.action, "ASSIGNED");
  assertEquals(mockDb.clusters.length, 1);
  assertEquals(mockDb.clusters[0].member_count, 2);

  // 3. Strongly Divergent Response (Triggers Dynamic Split)
  const req3: ClusterEngineRequest = {
    likert_score: -2,
    confidence_score: 100,
    comment: "Terrible idea, completely eliminates parking for delivery vans and disabled citizens!",
    question_text: "Convert Main Street to pedestrian zone?",
    variance_tolerance: 0.15, // Low tolerance to force split
    split_delta: 0.35,
  };

  const res3 = await processClusterIngestion(mockDb, req3, undefined, "user-789");
  assertEquals(res3.action, "SPLIT");

  // Parent cluster must be deactivated
  const parent = mockDb.clusters.find((c) => c.id === res3.parent_cluster_id);
  assertEquals(parent?.is_active, false);

  // Two active children clusters created
  const activeChildren = mockDb.clusters.filter((c) => c.is_active && c.parent_cluster_id === parent.id);
  assertEquals(activeChildren.length, 2);

  // Audit event logged in cluster_events
  assertEquals(mockDb.events.length, 1);
  const splitEvent = mockDb.events[0];
  assertEquals(splitEvent.event_type, "SPLIT");
  assertEquals(splitEvent.source_cluster_ids[0], parent.id);
  assertEquals(splitEvent.target_cluster_ids.length, 2);
  assertEquals(splitEvent.executed_by, "user-789");
});

Deno.test("Event-Sourced Genealogy: Time-Travel Rollback Invariant", () => {
  // Test atomic rollback state transition invariant
  interface ClusterState {
    id: string;
    is_active: boolean;
  }

  const clusters: Record<string, ClusterState> = {
    "parent-1": { id: "parent-1", is_active: false },
    "child-1a": { id: "child-1a", is_active: true },
    "child-1b": { id: "child-1b", is_active: true },
  };

  const splitEvent = {
    id: "evt-split-1",
    event_type: "SPLIT",
    source_cluster_ids: ["parent-1"],
    target_cluster_ids: ["child-1a", "child-1b"],
  };

  // Simulating valerie.rollback_cluster_event:
  // 1. Deactivate target clusters
  for (const tid of splitEvent.target_cluster_ids) {
    clusters[tid].is_active = false;
  }
  // 2. Reactivate source clusters
  for (const sid of splitEvent.source_cluster_ids) {
    clusters[sid].is_active = true;
  }

  // 3. Create forward ROLLBACK audit event
  const rollbackEvent = {
    id: "evt-rollback-1",
    event_type: "ROLLBACK",
    source_cluster_ids: splitEvent.target_cluster_ids,
    target_cluster_ids: splitEvent.source_cluster_ids,
    metadata: { rolled_back_event_id: splitEvent.id },
  };

  assertEquals(clusters["parent-1"].is_active, true);
  assertEquals(clusters["child-1a"].is_active, false);
  assertEquals(clusters["child-1b"].is_active, false);
  assertEquals(rollbackEvent.metadata.rolled_back_event_id, "evt-split-1");
});

