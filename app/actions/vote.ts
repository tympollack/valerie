/**
 * Project Valerie: Vote Submission Server Action
 * File: app/actions/vote.ts
 *
 * This Server Action handles the "Commit" phase of the Commit-and-Reveal
 * voting protocol. Running exclusively on the server prevents the client from
 * manipulating the user_id, locked_until, or bypassing DB constraints.
 *
 * DATA FLOW
 * ---------
 * 1. Client calls submitVote() from a 'use client' component via useTransition.
 * 2. Supabase SSR client reads the session cookie — no JWT passed from client.
 * 3. auth.getUser() validates the session against Supabase Auth (not trusting
 *    the cookie alone — this makes a network round-trip to verify).
 * 4. Payload is lightly validated server-side (DB constraints are the hard gate).
 * 5. INSERT into valerie.poll_responses — DB default sets locked_until = NOW()+24h.
 * 6. On UNIQUE violation (code 23505), return a user-facing duplicate-vote error.
 * 7. Return the locked_until timestamp so the client can display a countdown.
 *
 * PREREQUISITE
 * ------------
 * This action imports from '@/lib/supabase/server'. You must scaffold that
 * helper using @supabase/ssr:
 *
 *   // lib/supabase/server.ts
 *   import { createServerClient } from '@supabase/ssr'
 *   import { cookies } from 'next/headers'
 *
 *   export async function createClient() {
 *     const cookieStore = await cookies()
 *     return createServerClient(
 *       process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *       process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
 *       {
 *         cookies: {
 *           getAll: () => cookieStore.getAll(),
 *           setAll: (toSet) => toSet.forEach(({ name, value, options }) =>
 *             cookieStore.set(name, value, options)),
 *         },
 *       }
 *     )
 *   }
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Public types — imported by VotingCard and any other voting UI consumer
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
// Server Action
// ---------------------------------------------------------------------------

export async function submitVote(payload: VotePayload): Promise<VoteResult> {
  const supabase = await createClient();

  // --- Auth: validate session server-side (never trust client-passed user IDs)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "You must be signed in to vote." };
  }

  const { pollId, likertScore, confidenceScore, comment, h3HexIndex } = payload;

  // --- Light server-side validation (DB CHECK constraints are the hard gate)
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

  // --- Insert into valerie schema
  // Note: "valerie" must be listed in Supabase Dashboard → API Settings →
  // Exposed Schemas for this .schema() call to reach PostgREST correctly.
  const { data, error: insertError } = await supabase
    .schema("valerie")
    .from("poll_responses")
    .insert({
      poll_id:          pollId,
      user_id:          user.id,        // Sourced from verified session, not client
      likert_score:     likertScore,
      confidence_score: confidenceScore,
      comment:          comment?.trim() || null,
      h3_hex_index:     h3HexIndex ?? null,
      // locked_until is intentionally NOT set here — the DB default
      // (NOW() + INTERVAL '24 hours') owns this value to prevent tampering.
    })
    .select("id, locked_until")
    .single();

  if (insertError) {
    // PostgreSQL error code 23505 = unique_violation
    // Triggered by the CONSTRAINT uq_poll_user UNIQUE (poll_id, user_id)
    if (insertError.code === "23505") {
      return {
        success: false,
        error: "You have already voted on this poll. Each account may vote once.",
      };
    }

    // All other DB errors (FK violation, CHECK constraint, connectivity)
    console.error("[Project Valerie] Vote insert failed:", insertError);
    return {
      success: false,
      error: "Failed to record your vote. Please try again.",
    };
  }

  // --- Dynamic Topic Clustering Trigger (Asynchronous Post-Commit)
  supabase.functions
    .invoke("valerie-cluster-engine", {
      body: {
        poll_id:          pollId,
        response_id:      data?.id,
        user_id:          user.id,
        likert_score:     likertScore,
        confidence_score: confidenceScore,
        comment:          comment?.trim() || undefined,
      },
    })
    .catch((err) => {
      console.warn("[Project Valerie] Background cluster invocation non-blocking warning:", err);
    });

  // Bust any cached rendering of the poll results page
  revalidatePath(`/polls/${pollId}`);

  return {
    success:     true,
    lockedUntil: data.locked_until,   // ISO 8601 timestamp from DB
  };
}

