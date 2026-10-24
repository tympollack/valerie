/**
 * Project Valerie: Vote Submission Server Action
 * File: app/actions/vote.ts
 *
 * Exposes submitVote and castVote server actions from valerieVoteActions.ts
 * for backwards compatibility.
 */

"use server";

import {
  submitVote as executeSubmitVote,
  type VotePayload,
  type VoteResult,
} from "./valerieVoteActions";

export type { VotePayload, VoteResult };

export async function submitVote(payload: VotePayload): Promise<VoteResult> {
  try {
    return await executeSubmitVote(payload);
  } catch (err: unknown) {
    console.error("[Project Valerie] Error proxying submitVote:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to commit vote. Please try again.",
    };
  }
}

export async function castVote(payload: VotePayload): Promise<VoteResult> {
  try {
    return await executeSubmitVote(payload);
  } catch (err: unknown) {
    console.error("[Project Valerie] Error proxying castVote:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to commit vote. Please try again.",
    };
  }
}
