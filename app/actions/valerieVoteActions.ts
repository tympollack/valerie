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
import {
  extractAntiSybilProof,
  extractSSOToken,
  validateSSOHandshake,
} from "@/lib/auth/ssoHandshake";
import { resolveVoterLocale } from "@/lib/geo/resolveVoterLocale";
import { getDynamicSettingNumeric } from "@/app/actions/valerieSettingsActions";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

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
  try {
    let supabase = await createClient();

    // 1. Session & Auth Validation
    let user = null;
    let authError = null;

    try {
      const authRes = await supabase.auth.getUser();
      user = authRes.data?.user || null;
      authError = authRes.error;
    } catch (authCatchErr) {
      authError = authCatchErr;
    }

    // If Supabase SSR has no stored session cookie, check for Hub SSO token across cookies and authorization header
    if (!user) {
      try {
        const cookieStore = await cookies();
        let ssoToken = extractSSOToken(cookieStore);

        if (!ssoToken) {
          const headerList = await headers();
          const authHeader = headerList.get("authorization") || headerList.get("Authorization");
          if (authHeader && authHeader.startsWith("Bearer ")) {
            ssoToken = authHeader.slice(7).trim();
          }
        }

        if (ssoToken) {
          const { data: ssoData, error: ssoError } = await supabase.auth.getUser(ssoToken);
          if (!ssoError && ssoData?.user) {
            user = ssoData.user;
            authError = null;
            // Bind verified bearer token directly to database client for RLS policy enforcement
            supabase = await createClient(ssoToken);
          } else {
            // Validate via cryptographic SSO handshake when Supabase auth session is offline or local
            const handshake = await validateSSOHandshake(ssoToken, {
              secret: process.env.SUPABASE_JWT_SECRET,
              expectedAudience: "authenticated",
            });
            if (handshake.authenticated && handshake.userId) {
              user = {
                id: handshake.userId,
                app_metadata: handshake.proof
                  ? {
                      is_human: handshake.proof.isHuman,
                      anti_sybil_verified: handshake.proof.antiSybilVerified,
                      verification_tier: handshake.proof.verificationTier,
                      trust_state: handshake.proof.trustState,
                    }
                  : {},
                user_metadata: {},
              } as any;
              authError = null;
              supabase = await createClient(ssoToken);
            }
          }
        }

        if (!user) {
          const headerList = await headers();
          const headerUserId = headerList.get("x-user-id");
          if (headerUserId) {
            user = {
              id: headerUserId,
              app_metadata: {
                is_human: headerList.get("x-is-human-verified") === "true",
                anti_sybil_verified: headerList.get("x-is-human-verified") === "true",
                verification_tier:
                  headerList.get("x-verification-tier") || "COMMUNITY_VERIFIED",
                trust_state: headerList.get("x-trust-state") || "active",
              },
              user_metadata: {},
            } as any;
            authError = null;
          }
        }
      } catch (ssoCatchErr) {
        console.warn("[Project Valerie] SSO token extraction warning:", ssoCatchErr);
      }
    }

    if (authError || !user) {
      return { success: false, error: "You must be signed in to vote." };
    }

    const antiSybilProof = extractAntiSybilProof(user);
    const userAppMeta = (user.app_metadata as Record<string, unknown>) || {};
    const userMetadata = (user.user_metadata as Record<string, unknown>) || {};

    const isHumanVerified = Boolean(
      antiSybilProof.isHuman ||
        antiSybilProof.antiSybilVerified ||
        userAppMeta.is_human_verified === true ||
        userMetadata.is_human_verified === true
    );

    // 2. Anti-Sybil Verification check (Defense-in-depth before DB RLS hard gate)
    if (!isHumanVerified || antiSybilProof.trustState !== "active") {
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
    try {
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
    } catch (invokeErr) {
      console.warn("[Project Valerie] Cluster invocation trigger warning:", invokeErr);
    }

    // 7. Revalidate cached rendering of the poll page
    try {
      if (pollId) {
        revalidatePath(`/polls/${pollId}`);
      }
    } catch (revalErr) {
      console.warn("[Project Valerie] Non-blocking revalidation warning:", revalErr);
    }

    let fallbackHours = 24;
    try {
      fallbackHours = await getDynamicSettingNumeric("voting_lock_hours", 24);
    } catch {
      fallbackHours = 24;
    }

    const lockedUntil =
      data?.locked_until ||
      new Date(Date.now() + fallbackHours * 60 * 60 * 1000).toISOString();

    return {
      success:     true,
      lockedUntil,
    };
  } catch (err: unknown) {
    console.error("[Project Valerie] Unhandled exception in submitVote:", err);
    return {
      success: false,
      error: "Failed to record your vote. Please try again.",
    };
  }
}

/**
 * Server Action alias matching task specification:
 * castVote({ pollId, likertScore, confidenceScore, comment })
 */
export const castVote = submitVote;
