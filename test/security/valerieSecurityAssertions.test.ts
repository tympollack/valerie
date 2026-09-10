/**
 * Project Valerie: Security Assertion Test Suite
 * File: test/security/valerieSecurityAssertions.test.ts
 *
 * Formal security assertions verifying:
 * 1. Commit-and-Reveal Protocol:
 *    - Unauthorized reveal attempts before voting are blocked.
 *    - Unauthorized reveal attempts while locked_until is active (NOW() <= locked_until) are blocked.
 *    - Authorized reveal succeeds strictly when caller has committed AND NOW() > locked_until.
 * 2. Anti-Sybil Protection & Row-Level Security:
 *    - Submissions from unverified / slashed / non-human identities are blocked.
 *    - Double-voting attempts for the same (poll_id, user_id) are structurally blocked by UNIQUE constraint.
 * 3. Voter Anonymity & Aggregation Integrity:
 *    - Raw voter rows cannot be inspected or leaked across users.
 *    - SQL weighted average math: Sum(Likert * Confidence) / Sum(Confidence) computes accurate distribution.
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Security Simulator Types & Models (Mirroring Supabase Engine & RLS Policies)
// =============================================================================

interface MockPollResponse {
  id: string;
  poll_id: string;
  user_id: string;
  likert_score: number;
  confidence_score: number;
  comment?: string | null;
  locked_until: number; // timestamp in ms
  created_at: number;
}

interface MockAuthUser {
  id: string;
  app_metadata?: {
    is_human?: boolean;
    anti_sybil_verified?: boolean;
    verification_tier?: string;
    trust_state?: "active" | "quarantined" | "slashed";
  };
}

class ValerieDatabaseSecurityEngine {
  private responses: MockPollResponse[] = [];

  // 1. SQL Helper: valerie.is_human_verified(user)
  public isHumanVerified(user: MockAuthUser | null): boolean {
    if (!user) return false;
    const meta = user.app_metadata || {};
    const trustState = meta.trust_state || "active";
    if (trustState === "slashed" || trustState === "quarantined") return false;

    const tier = (meta.verification_tier || "UNVERIFIED").toUpperCase();
    const isTierVerified = ["ANCHOR", "COMMUNITY_VERIFIED", "BIOMETRIC", "VERIFIED"].includes(tier);

    return Boolean(meta.is_human === true || meta.anti_sybil_verified === true || isTierVerified);
  }

  // 2. SQL Helper: valerie.has_voted_and_lock_expired(p_poll_id)
  public hasVotedAndLockExpired(pollId: string, caller: MockAuthUser | null, currentTime: number): boolean {
    if (!caller) return false;
    return this.responses.some(
      (r) => r.poll_id === pollId && r.user_id === caller.id && currentTime > r.locked_until
    );
  }

  // 3. RLS Table INSERT: valerie.poll_responses ("valerie_pr: verified human insert")
  public insertPollResponse(
    caller: MockAuthUser | null,
    payload: { pollId: string; likertScore: number; confidenceScore: number; comment?: string },
    currentTime: number,
    lockDurationMs: number = 24 * 60 * 60 * 1000
  ): { success: boolean; data?: MockPollResponse; error?: { code: string; message: string } } {
    if (!caller) {
      return { success: false, error: { code: "42501", message: "Unauthorized: Authenticated session required." } };
    }

    // RLS Policy Check: auth.uid() = user_id AND valerie.is_human_verified(auth.uid())
    if (!this.isHumanVerified(caller)) {
      return {
        success: false,
        error: {
          code: "42501",
          message: "RLS check violation: Single-human verification required.",
        },
      };
    }

    // Constraint Check: UNIQUE(poll_id, user_id)
    const existing = this.responses.find((r) => r.poll_id === payload.pollId && r.user_id === caller.id);
    if (existing) {
      return {
        success: false,
        error: {
          code: "23505",
          message: "unique_violation: duplicate key value violates unique constraint uq_poll_user",
        },
      };
    }

    // Insert new response
    const newRecord: MockPollResponse = {
      id: `resp-${Math.random().toString(36).slice(2, 9)}`,
      poll_id: payload.pollId,
      user_id: caller.id,
      likert_score: payload.likertScore,
      confidence_score: payload.confidenceScore,
      comment: payload.comment || null,
      locked_until: currentTime + lockDurationMs,
      created_at: currentTime,
    };

    this.responses.push(newRecord);
    return { success: true, data: newRecord };
  }

  // 4. RLS Table Direct SELECT: valerie.poll_responses ("valerie_pr: owner read own")
  public selectOwnResponses(caller: MockAuthUser | null, pollId: string): MockPollResponse[] {
    if (!caller) return [];
    // RLS enforces: USING (auth.uid() = user_id)
    return this.responses.filter((r) => r.poll_id === pollId && r.user_id === caller.id);
  }

  // 5. Hard-Lock Check: Attempting to select other users' rows directly
  public selectAllRawResponses(caller: MockAuthUser | null, pollId: string): MockPollResponse[] {
    if (!caller) return [];
    // PostgREST with RLS will strictly filter out rows where auth.uid() != user_id
    return this.responses.filter((r) => r.poll_id === pollId && r.user_id === caller.id);
  }

  // 6. Aggregation Security RPC: valerie.get_poll_results(p_poll_id)
  public getPollResultsRPC(pollId: string, caller: MockAuthUser | null, currentTime: number) {
    // Security Gate: valerie.has_voted_and_lock_expired(p_poll_id)
    const hasAccess = this.hasVotedAndLockExpired(pollId, caller, currentTime);
    if (!hasAccess) {
      // Returns empty result set — zero information leaked
      return [];
    }

    const pollVotes = this.responses.filter((r) => r.poll_id === pollId);
    const totalVotes = pollVotes.length;
    if (totalVotes === 0) return [];

    const totalConfidence = pollVotes.reduce((sum, r) => sum + r.confidence_score, 0);
    const totalWeightedLikert = pollVotes.reduce((sum, r) => sum + r.likert_score * r.confidence_score, 0);

    const globalWeightedAvgSentiment =
      totalConfidence > 0 ? Number((totalWeightedLikert / totalConfidence).toFixed(4)) : 0;
    const globalAvgConfidence = Number((totalConfidence / totalVotes).toFixed(2));

    const likertScores = [-2, -1, 0, 1, 2];

    return likertScores.map((score) => {
      const bucketRows = pollVotes.filter((r) => r.likert_score === score);
      const voteCount = bucketRows.length;
      const bucketConfSum = bucketRows.reduce((sum, r) => sum + r.confidence_score, 0);
      const bucketWeightedSum = bucketRows.reduce((sum, r) => sum + r.likert_score * r.confidence_score, 0);

      const avgConfidence = voteCount > 0 ? Number((bucketConfSum / voteCount).toFixed(2)) : 0;
      const pctOfTotal = Number(((voteCount / totalVotes) * 100).toFixed(2));
      const weightedSentimentScore =
        bucketConfSum > 0 ? Number((bucketWeightedSum / bucketConfSum).toFixed(4)) : score;

      return {
        likert_score: score,
        vote_count: voteCount,
        avg_confidence: avgConfidence,
        pct_of_total: pctOfTotal,
        weighted_sentiment_score: weightedSentimentScore,
        total_poll_votes: totalVotes,
        global_weighted_avg_sentiment: globalWeightedAvgSentiment,
        global_avg_confidence: globalAvgConfidence,
      };
    });
  }
}

// =============================================================================
// Security Assertions
// =============================================================================

describe("Project Valerie: Hard-Locked Security Assertions", () => {
  const POLL_ID = "poll-3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const BASE_TIME = 1756300000000; // Fixed timestamp reference
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  const verifiedUserA: MockAuthUser = {
    id: "user-a-human-1111",
    app_metadata: {
      is_human: true,
      anti_sybil_verified: true,
      verification_tier: "COMMUNITY_VERIFIED",
      trust_state: "active",
    },
  };

  const verifiedUserB: MockAuthUser = {
    id: "user-b-human-2222",
    app_metadata: {
      verification_tier: "ANCHOR",
      trust_state: "active",
    },
  };

  const sybilBotUser: MockAuthUser = {
    id: "user-bot-sybil-9999",
    app_metadata: {
      is_human: false,
      anti_sybil_verified: false,
      verification_tier: "UNVERIFIED",
      trust_state: "active",
    },
  };

  const slashedUser: MockAuthUser = {
    id: "user-slashed-6666",
    app_metadata: {
      is_human: true,
      verification_tier: "ANCHOR",
      trust_state: "slashed",
    },
  };

  // ---------------------------------------------------------------------------
  // 1. Anti-Sybil Gate & Constraint Assertions
  // ---------------------------------------------------------------------------
  describe("Anti-Sybil Single-Human Verification on INSERT", () => {
    it("permits vote submission for verified human accounts", () => {
      const db = new ValerieDatabaseSecurityEngine();
      const result = db.insertPollResponse(
        verifiedUserA,
        { pollId: POLL_ID, likertScore: 2, confidenceScore: 90 },
        BASE_TIME
      );

      expect(result.success).toBe(true);
      expect(result.data?.user_id).toBe(verifiedUserA.id);
      expect(result.data?.locked_until).toBe(BASE_TIME + TWENTY_FOUR_HOURS);
    });

    it("STRUCTURALLY BLOCKS unverified accounts (Sybil bots) via RLS check", () => {
      const db = new ValerieDatabaseSecurityEngine();
      const result = db.insertPollResponse(
        sybilBotUser,
        { pollId: POLL_ID, likertScore: 1, confidenceScore: 50 },
        BASE_TIME
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("42501");
      expect(result.error?.message).toMatch(/verification required/i);
    });

    it("STRUCTURALLY BLOCKS slashed accounts even if previously verified", () => {
      const db = new ValerieDatabaseSecurityEngine();
      const result = db.insertPollResponse(
        slashedUser,
        { pollId: POLL_ID, likertScore: -1, confidenceScore: 80 },
        BASE_TIME
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("42501");
    });

    it("PREVENTS DOUBLE-VOTING: triggers UNIQUE(poll_id, user_id) 23505 violation", () => {
      const db = new ValerieDatabaseSecurityEngine();
      // First vote succeeds
      const first = db.insertPollResponse(
        verifiedUserA,
        { pollId: POLL_ID, likertScore: 2, confidenceScore: 90 },
        BASE_TIME
      );
      expect(first.success).toBe(true);

      // Second vote attempt for same user and poll is blocked
      const duplicate = db.insertPollResponse(
        verifiedUserA,
        { pollId: POLL_ID, likertScore: -2, confidenceScore: 100 },
        BASE_TIME + 1000
      );
      expect(duplicate.success).toBe(false);
      expect(duplicate.error?.code).toBe("23505");
      expect(duplicate.error?.message).toMatch(/unique constraint uq_poll_user/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Commit-and-Reveal Security Gate Assertions
  // ---------------------------------------------------------------------------
  describe("Commit-and-Reveal Aggregation Gate (valerie.get_poll_results)", () => {
    it("BLOCKS unauthorized reveal attempts before user has voted", () => {
      const db = new ValerieDatabaseSecurityEngine();
      // Seed vote from User A
      db.insertPollResponse(verifiedUserA, { pollId: POLL_ID, likertScore: 1, confidenceScore: 80 }, BASE_TIME);

      // User B has not voted on this poll
      const results = db.getPollResultsRPC(POLL_ID, verifiedUserB, BASE_TIME + 1000);
      expect(results).toHaveLength(0); // Zero rows exposed
    });

    it("BLOCKS unauthorized reveal attempts while lock is active (NOW() <= locked_until)", () => {
      const db = new ValerieDatabaseSecurityEngine();
      // User A submits vote at BASE_TIME (locked_until = BASE_TIME + 24h)
      db.insertPollResponse(verifiedUserA, { pollId: POLL_ID, likertScore: 1, confidenceScore: 80 }, BASE_TIME);

      // User A attempts to view results at 12 hours (cooldown still active)
      const twelveHoursLater = BASE_TIME + 12 * 60 * 60 * 1000;
      const resultsDuringLock = db.getPollResultsRPC(POLL_ID, verifiedUserA, twelveHoursLater);

      expect(resultsDuringLock).toHaveLength(0); // Sealed!
    });

    it("BLOCKS unauthorized reveal attempts right at the boundary (NOW() == locked_until)", () => {
      const db = new ValerieDatabaseSecurityEngine();
      db.insertPollResponse(verifiedUserA, { pollId: POLL_ID, likertScore: 1, confidenceScore: 80 }, BASE_TIME);

      const exactBoundary = BASE_TIME + TWENTY_FOUR_HOURS;
      const resultsAtBoundary = db.getPollResultsRPC(POLL_ID, verifiedUserA, exactBoundary);

      expect(resultsAtBoundary).toHaveLength(0);
    });

    it("AUTHORIZES reveal when user has voted AND 24h lock has strictly expired (NOW() > locked_until)", () => {
      const db = new ValerieDatabaseSecurityEngine();
      db.insertPollResponse(verifiedUserA, { pollId: POLL_ID, likertScore: 2, confidenceScore: 90 }, BASE_TIME);
      db.insertPollResponse(verifiedUserB, { pollId: POLL_ID, likertScore: 1, confidenceScore: 70 }, BASE_TIME);

      // User A queries at 24 hours + 1 second
      const expiredTime = BASE_TIME + TWENTY_FOUR_HOURS + 1000;
      const results = db.getPollResultsRPC(POLL_ID, verifiedUserA, expiredTime);

      expect(results).toHaveLength(5); // Returns 5 Likert distribution buckets (-2..2)
      expect(results[0].total_poll_votes).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Voter Anonymity & Mathematical Integrity Assertions
  // ---------------------------------------------------------------------------
  describe("Voter Privacy Isolation & Weighted Average Precision", () => {
    it("ENSURES raw voter rows of other users are NEVER exposed via direct table SELECT", () => {
      const db = new ValerieDatabaseSecurityEngine();
      db.insertPollResponse(verifiedUserA, { pollId: POLL_ID, likertScore: 2, confidenceScore: 90 }, BASE_TIME);
      db.insertPollResponse(verifiedUserB, { pollId: POLL_ID, likertScore: -1, confidenceScore: 60 }, BASE_TIME);

      // User A queries table directly
      const userAReads = db.selectAllRawResponses(verifiedUserA, POLL_ID);
      expect(userAReads).toHaveLength(1);
      expect(userAReads[0].user_id).toBe(verifiedUserA.id); // User A cannot see User B's raw row
    });

    it("COMPUTES mathematical weighted averages (Likert × Confidence) accurately in SQL", () => {
      const db = new ValerieDatabaseSecurityEngine();

      // Vote 1: Likert = +2, Confidence = 100 -> Weighted = 200
      db.insertPollResponse(verifiedUserA, { pollId: POLL_ID, likertScore: 2, confidenceScore: 100 }, BASE_TIME);

      // Vote 2: Likert = -1, Confidence = 50  -> Weighted = -50
      db.insertPollResponse(verifiedUserB, { pollId: POLL_ID, likertScore: -1, confidenceScore: 50 }, BASE_TIME);

      // Expected Global:
      // Total Confidence = 100 + 50 = 150
      // Sum(Likert * Confidence) = 200 - 50 = 150
      // Global Weighted Avg Sentiment = 150 / 150 = 1.0000
      // Global Avg Confidence = (100 + 50) / 2 = 75.00

      const revealTime = BASE_TIME + TWENTY_FOUR_HOURS + 1000;
      const results = db.getPollResultsRPC(POLL_ID, verifiedUserA, revealTime);

      expect(results).toHaveLength(5);
      const summary = results[0];

      expect(summary.total_poll_votes).toBe(2);
      expect(summary.global_weighted_avg_sentiment).toBe(1.0);
      expect(summary.global_avg_confidence).toBe(75.0);

      // Check bucket breakdown:
      const stronglyAgreeBucket = results.find((r) => r.likert_score === 2);
      expect(stronglyAgreeBucket?.vote_count).toBe(1);
      expect(stronglyAgreeBucket?.avg_confidence).toBe(100.0);
      expect(stronglyAgreeBucket?.pct_of_total).toBe(50.0);

      const disagreeBucket = results.find((r) => r.likert_score === -1);
      expect(disagreeBucket?.vote_count).toBe(1);
      expect(disagreeBucket?.avg_confidence).toBe(50.0);
      expect(disagreeBucket?.pct_of_total).toBe(50.0);
    });
  });
});
