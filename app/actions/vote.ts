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
  return executeSubmitVote(payload);
}

export async function castVote(payload: VotePayload): Promise<VoteResult> {
  return executeSubmitVote(payload);
}
