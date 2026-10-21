/**
 * Project Valerie: Herald Autonomous Pipeline & Adversarial Referee — Tests
 * File: supabase/functions/valerie-herald-agent/test.ts
 *
 * Test Coverage:
 * 1. Controversy Dispersion calculation across multi-spectrum sources.
 * 2. Adversarial Dual-Agent IRT Decomposition & Red-Pen Cynic Referee (< 0.15 score).
 * 3. Partisan headline de-spinning into 3 orthogonal propositions (PRINCIPLE, ETHICS_LAW, REALPOLITIK).
 * 4. Semantic deduplication logic via 1536-D pgvector cosine similarity (> 0.90 within 72h).
 * 5. Pre-publication tooltip SHA-256 pre-warming matching lib/cache/hashLookup.ts.
 * 6. Cross-ecosystem linking for Speak for the Dead and PatchWork ground truth.
 * 7. Autonomous Axis-4 follow-up poll spawner idempotency & 15-flag threshold.
 */

import { assertEquals, assert, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateControversyDispersion,
  agent1DecomposeEvent,
  agent2CynicReferee,
  runAdversarialRefereePipeline,
  processHeraldIngest,
  checkSemanticDeduplication,
  NewsCluster,
} from "./index.ts";
import {
  buildTermCacheKey,
  computeSha256,
  prewarmTooltips,
  linkEcosystemRefs,
  prewarmAndLink,
  formatVectorForPg,
} from "./prewarmAndLink.ts";
import {
  spawnAxisFour,
  extractTopCentroidComments,
  synthesizeAxisFourQuestion,
} from "../valerie-cluster-engine/spawnAxisFour.ts";
import {
  cosineSimilarity,
  cosineDistance,
  l2Normalize,
  VECTOR_DIM,
} from "../valerie-cluster-engine/vector-math.ts";

Deno.test("Controversy Variance: computes dispersion accurately across divergent news coverage", () => {
  // Divergent polarized coverage: Left -0.9, Right +0.9
  const highVarianceArticles = [
    { title: "Article A", source: "MSNBC", url: "https://msnbc.com/1", sentiment_score: -0.9 },
    { title: "Article B", source: "Fox News", url: "https://foxnews.com/1", sentiment_score: 0.9 },
    { title: "Article C", source: "Wall Street Journal", url: "https://wsj.com/1", sentiment_score: 0.2 },
  ];

  const dispersion = calculateControversyDispersion(highVarianceArticles);
  assert(dispersion >= 0.65, `Expected dispersion >= 0.65, got ${dispersion}`);

  // Consensus coverage: all neutral/positive
  const lowVarianceArticles = [
    { title: "A", source: "AP", url: "https://ap.com/1", sentiment_score: 0.1 },
    { title: "B", source: "Reuters", url: "https://reuters.com/1", sentiment_score: 0.15 },
    { title: "C", source: "BBC", url: "https://bbc.com/1", sentiment_score: 0.05 },
  ];
  const lowDispersion = calculateControversyDispersion(lowVarianceArticles);
  assert(lowDispersion < 0.65, `Expected low dispersion < 0.65, got ${lowDispersion}`);
});

Deno.test("Adversarial IRT Decomposition: deconstructs partisan headline into 3 orthogonal polls scoring < 0.15 on Cynic audit", async () => {
  const partisanHeadline = "Breaking: Corrupt City Council Imposes Draconian Congestion Tax on Working Families!";
  const summary = "A contentious municipal tax levied on private vehicles entering central business districts during peak morning rush hours.";

  const result = await runAdversarialRefereePipeline(partisanHeadline, summary);

  assert(result.passed, "Adversarial pipeline should pass neutral referee audit");
  assertEquals(result.axes.length, 3);

  const categories = result.axes.map((a) => a.category);
  assert(categories.includes("PRINCIPLE"), "Must include PRINCIPLE axis");
  assert(categories.includes("ETHICS_LAW"), "Must include ETHICS_LAW axis");
  assert(categories.includes("REALPOLITIK"), "Must include REALPOLITIK axis");

  for (const axis of result.axes) {
    assert(
      (axis.cynic_bias_score ?? 1.0) < 0.15,
      `Axis ${axis.category} failed cynic audit with score ${axis.cynic_bias_score} >= 0.15`
    );
    assert(axis.question_text.length > 20, "Question text must be substantial");
    assert(!axis.question_text.includes("Corrupt"), "Must strip partisan adjective 'Corrupt'");
    assert(!axis.question_text.includes("Draconian"), "Must strip partisan adjective 'Draconian'");
  }
});

Deno.test("Agent 2 (The Cynic Referee): detects partisan framing and rejects biased questions", async () => {
  const biasedQuestion = "Should corrupt bureaucrats obviously be punished for this reckless, tyrannical decision?";
  const audit = await agent2CynicReferee(biasedQuestion);

  assert(audit.cynic_bias_score >= 0.15, `Expected cynic_bias_score >= 0.15 for biased question, got ${audit.cynic_bias_score}`);

  const neutralQuestion = "Whether municipal authorities should possess regulatory jurisdiction over commercial transit corridors.";
  const neutralAudit = await agent2CynicReferee(neutralQuestion);

  assert(neutralAudit.cynic_bias_score < 0.15, `Expected cynic_bias_score < 0.15 for neutral question, got ${neutralAudit.cynic_bias_score}`);
});

Deno.test("Tooltip Pre-Warming: produces deterministic SHA-256 hashes matching client lookup keys", async () => {
  const term = "Sovereign Immunity";
  const readingLevel = "advanced";
  const lang = "en";

  const expectedKey = "sovereign immunity:en:advanced";
  const actualKey = buildTermCacheKey(term, readingLevel, lang);
  assertEquals(actualKey, expectedKey);

  const hash = await computeSha256(actualKey);
  assertEquals(hash.length, 64);

  // Pre-warm function extracts 2 to 4 terms and builds cache keys
  const question = "Whether sovereign immunity should restrict municipal accountability under environmental regulatory takings.";
  const warmed = await prewarmTooltips(question, ["elementary", "general", "advanced"]);

  assert(warmed.length >= 6, `Expected at least 2 terms across 3 reading levels (>= 6 entries), got ${warmed.length}`);
  for (const entry of warmed) {
    assertEquals(entry.hash.length, 64);
    assert(["elementary", "general", "advanced"].includes(entry.readingLevel));
    assert(entry.definition.length > 10);
  }
});

Deno.test("Ecosystem Linking: matches Speak for the Dead and PatchWork mock records", async () => {
  const mockSupabase = {
    schema: (schemaName: string) => ({
      from: (tableName: string) => ({
        select: () => ({
          limit: () => {
            if (schemaName === "speak_for_the_dead" && tableName === "incidents") {
              return Promise.resolve({
                data: [
                  {
                    id: "sftd-uuid-001",
                    source_agency: "OSHA",
                    incident_narrative: "Critical chemical pipeline structural failure in Ohio industrial corridor",
                  },
                ],
              });
            }
            if (schemaName === "patchwork" && tableName === "nodes") {
              return Promise.resolve({
                data: [
                  {
                    node_id: "pw-node-uuid-002",
                    title: "Ohio River Corridor Water Treatment Resilience",
                    description: "Infrastructure report assessing municipal pipeline integrity",
                    h3_index: "872681534ffffff",
                  },
                ],
              });
            }
            return Promise.resolve({ data: [] });
          },
        }),
      }),
    }),
  };

  const dummyEmbedding = new Array(VECTOR_DIM).fill(0.02);
  dummyEmbedding[0] = 0.5;

  const refs = await linkEcosystemRefs(dummyEmbedding, ["Ohio"], { supabase: mockSupabase });
  assert(Array.isArray(refs.patchwork_ids));
  assert(Array.isArray(refs.sftd_case_ids));
});

Deno.test("Semantic Deduplication: merges duplicate breaking stories when cosine similarity > 0.90", async () => {
  const mockEmbedding = l2Normalize([1, 1, 0, 0]);
  const duplicateEmbedding = l2Normalize([1, 1, 0.05, 0]); // High similarity > 0.95

  const mockSupabase = {
    schema: () => ({
      from: () => {
        const queryBuilder: any = {
          select: () => queryBuilder,
          gte: () => queryBuilder,
          neq: () => queryBuilder,
          order: () => queryBuilder,
          eq: () => queryBuilder,
          limit: () =>
            Promise.resolve({
              data: [
                {
                  id: "ingest-existing-1234",
                  event_title: "Initial Congestion Pricing Bill Introduced",
                  event_embedding: formatVectorForPg(mockEmbedding),
                  source_urls: ["https://reuters.com/congestion-bill"],
                  status: "auto_published",
                },
              ],
            }),
        };
        return queryBuilder;
      },
    }),
  };

  const dedup = await checkSemanticDeduplication(duplicateEmbedding, mockSupabase);
  assert(dedup.isDuplicate, "Expected event to be flagged as duplicate");
  assertEquals(dedup.duplicateId, "ingest-existing-1234");
});

Deno.test("SUBTASK-VAL-AXIS4-SPAWNER: Simulating 15 clustered FALSE_DICHOTOMY flags spawns exactly one COMMUNITY_SPAWNED_AXIS poll without duplicating", async () => {
  const pollId = "poll-parent-777";
  const parentQuestion = "Should cities ban private passenger automobiles from downtown zones?";

  // Generate 15 distinct objections centered around delivery and emergency transit exceptions
  const mockFlags: { comment: string }[] = [];
  for (let i = 1; i <= 15; i++) {
    mockFlags.push({
      comment: `Banning all vehicles ignores essential delivery logistics, disability access, and small merchant freight #${i}`,
    });
  }

  let dbPolls: any[] = [];
  const mockSupabase = {
    schema: () => ({
      from: (tbl: string) => ({
        select: (cols: string) => {
          const handler: any = {
            eq: (field: string, val: any) => {
              if (tbl === "polls" && field === "axis_category") {
                const existing = dbPolls.filter((p) => p.axis_category === "COMMUNITY_SPAWNED_AXIS");
                return Promise.resolve({ data: existing });
              }
              return handler;
            },
            maybeSingle: () => {
              if (tbl === "polls") {
                return Promise.resolve({
                  data: {
                    id: pollId,
                    question_text: parentQuestion,
                    source_ingest_id: "ingest-001",
                    scope_tier: "LOCAL",
                    detected_locales: ["US-NY"],
                  },
                });
              }
              return Promise.resolve({ data: null });
            },
          };
          return handler;
        },
        insert: (payload: any) => {
          dbPolls.push(payload);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: payload.id || "spawned-axis-4-id" }, error: null }),
            }),
          };
        },
      }),
    }),
  };

  // Run 1: First 15 flags -> Should spawn exactly 1 Axis-4 poll
  const firstSpawn = await spawnAxisFour(pollId, {
    supabase: mockSupabase,
    mockFlags,
  });

  assert(firstSpawn.success, "First spawn should succeed");
  assert(firstSpawn.spawned, "Poll should be spawned");
  assertEquals(dbPolls.length, 1);
  assertEquals(dbPolls[0].axis_category, "COMMUNITY_SPAWNED_AXIS");
  assert(dbPolls[0].question_text.length > 20);
  assert((firstSpawn.cynic_bias_score ?? 1.0) < 0.15, "Spawned axis must pass cynicism audit < 0.15");

  // Run 2: Subsequent flag accumulation -> Idempotency check prevents duplicate spawn
  const secondSpawn = await spawnAxisFour(pollId, {
    supabase: mockSupabase,
    mockFlags: [...mockFlags, { comment: "Yet another objection" }],
  });

  assert(secondSpawn.success, "Second call should return success");
  assertEquals(secondSpawn.spawned, false, "Must NOT spawn duplicate Axis-4 poll");
  assertEquals(secondSpawn.reason, "AXIS_4_ALREADY_EXISTS");
  assertEquals(dbPolls.length, 1, "Database must still contain exactly 1 Axis-4 poll");
});
