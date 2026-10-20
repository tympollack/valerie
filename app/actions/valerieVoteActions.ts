/**
 * Project Valerie: Vote Submission Server Actions
 * File: app/actions/valerieVoteActions.ts
 * Work Item: TASK-VAL-LOCALE-INGEST-STAMP / STORY-VAL-LOCALE-HEATMAP-UI
 *
 * Implements the submitVote and castVote Server Actions for the Commit-and-Reveal
 * voting protocol with anonymized multi-scale locale stamping.
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { extractAntiSybilProof, extractSSOToken } from "@/lib/auth/ssoHandshake";
import { resolveVoterLocale } from "@/lib/geo/resolveVoterLocale";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Public types — imported by BivariatePollCard, VotingCard, and consumers
// ---------------------------------------------------------------------------

export interface VotePayload {
  pollId:          string;
  likertScore:     number;   // Validated: integer in [-2, 2]
  confidenceScore: number;   // Validated: integer in [0, 100]
  comment?:        string;
  h3HexIndex?:     string;   // Optional H3 resolution-7 cell index (15-char hex)
}

export interface VoteResult {
  success:      boolean;
  lockedUntil?: string;   // ISO 8601 — when community results become readable
  error?:       string;
}

// ---------------------------------------------------------------------------
// Server Action: submitVote / castVote
// ---------------------------------------------------------------------------

export async function submitVote(payload: VotePayload): Promise<VoteResult> {
  const supabase = await createClient();

  // 1. Session & Auth Validation
  let {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // If Supabase SSR has no stored session cookie, check for Hub SSO token and validate it
  if (!user) {
    const cookieStore = await cookies();
    const ssoToken = extractSSOToken(cookieStore);
    if (ssoToken) {
      const { data: ssoData, error: ssoError } = await supabase.auth.getUser(ssoToken);
      if (!ssoError && ssoData?.user) {
        user = ssoData.user;
        authError = null;
      }
    }
  }

  if (authError || !user) {
    return { success: false, error: "You must be signed in to vote." };
  }

  const antiSybilProof = extractAntiSybilProof(user);
  const isHuman = antiSybilProof.isHuman;
  const trustState = antiSybilProof.trustState;

  // 2. Anti-Sybil Verification check (Defense-in-depth before DB RLS hard gate)
  if (!isHuman || trustState !== "active") {
    return {
      success: false,
      error: "Single-human identity verification required. Please complete verification on the SunShade Hub.",
    };
  }

  const resolvedUserId = user.id;
  const { pollId, likertScore, confidenceScore, comment, h3HexIndex } = payload;

  // 3. Server-side validation
  if (!pollId || typeof pollId !== "string") {
    return { success: false, error: "Poll ID is required." };
  }

  if (
    !Number.isInteger(likertScore) ||
    likertScore < -2 ||
    likertScore > 2
  ) {
    return { success: false, error: "Invalid sentiment score." };
  }

  if (
    !Number.isInteger(confidenceScore) ||
    confidenceScore < 0 ||
    confidenceScore > 100
  ) {
    return { success: false, error: "Invalid confidence score." };
  }

  // 4. Resolve coarse-to-fine locale buckets (Zero raw coordinates)
  const locale = await resolveVoterLocale(undefined, user);
  const finalH3Res7 = locale.h3_res7 ?? h3HexIndex ?? null;

  // 5. Insert into valerie.poll_responses
  const { data, error: insertError } = await supabase
    .schema("valerie")
    .from("poll_responses")
    .insert({
      poll_id:          pollId,
      user_id:          resolvedUserId,
      likert_score:     likertScore,
      confidence_score: confidenceScore,
      comment:          comment?.trim() || null,
      h3_hex_index:     finalH3Res7,
      country_iso:      locale.country_iso,
      admin1_code:      locale.admin1_code,
      admin2_code:      locale.admin2_code,
      h3_res7:          finalH3Res7,
      // locked_until is intentionally NOT set here — the DB default
      // (NOW() + INTERVAL '24 hours') owns this value to prevent tampering.
    })
    .select("id, locked_until")
    .single();

  if (insertError) {
    // PostgreSQL error code 23505 = unique_violation
    if (insertError.code === "23505") {
      return {
        success: false,
        error: "You have already voted on this poll. Each account may vote once.",
      };
    }

    // PostgreSQL error code 42501 = insufficient_privilege (RLS policy check failed)
    if (insertError.code === "42501") {
      return {
        success: false,
        error: "Vote rejected: Your account must have active human verification.",
      };
    }

    console.error("[Project Valerie] Vote insert failed:", insertError);
    return {
      success: false,
      error: "Failed to record your vote. Please try again.",
    };
  }

  // 6. Dynamic Topic Clustering Trigger (Asynchronous Post-Commit)
  supabase.functions
    .invoke("valerie-cluster-engine", {
      body: {
        poll_id:          pollId,
        response_id:      data?.id,
        user_id:          resolvedUserId,
        likert_score:     likertScore,
        confidence_score: confidenceScore,
        comment:          comment?.trim() || undefined,
      },
    })
    .catch((err: unknown) => {
      console.warn("[Project Valerie] Background cluster invocation non-blocking warning:", err);
    });

  // 7. Revalidate cached rendering of the poll page
  revalidatePath(`/polls/${pollId}`);

  return {
    success:     true,
    lockedUntil: data.locked_until,
  };
}

/**
 * Server Action alias matching task specification:
 * castVote({ pollId, likertScore, confidenceScore, comment })
 */
export const castVote = submitVote;
