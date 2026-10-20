/**
 * Project Valerie: Vote Submission Server Action
 * File: app/actions/vote.ts
 *
 * Re-exports the submitVote and castVote server actions from valerieVoteActions.ts
 * for backwards compatibility.
 */

"use server";

export {
  submitVote,
  castVote,
  type VotePayload,
  type VoteResult,
} from "./valerieVoteActions";
