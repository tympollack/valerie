/**
 * Project Valerie: Sovereign Decree Automated Compiler Runner
 * File: lib/valerie/decreeCompilerRunner.ts
 * Work Item: [TASK-VAL-DECREE-COMPILER-RUNNER] / [STORY-VAL-DECREE-INACTION]
 *
 * Scans active deliberation polls that have completed the 24-hour commit-lock
 * window, detects cross-spectrum supermajorities (>=70%), and seals them into
 * cryptographically immutable sovereign decrees.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DecreeCompilerSettings {
  enabled: boolean;
  minConstituentCount: number;
  supermajorityThreshold: number;
}

export const DEFAULT_DECREE_SETTINGS: DecreeCompilerSettings = {
  enabled: true,
  minConstituentCount: 250,
  supermajorityThreshold: 0.70,
};

export interface DecreeCompilationResult {
  pollId: string;
  questionText?: string;
  success: boolean;
  decreeId?: string;
  reason?: string;
  consensusShare?: number;
  totalVotes?: number;
  merkleRootHash?: string;
}

export interface DecreeCompilerSummary {
  status: "success" | "paused_by_admin" | "error";
  eligiblePolls: number;
  evaluatedPolls: number;
  compiledDecrees: number;
  results: DecreeCompilationResult[];
  message?: string;
  error?: string;
}

/**
 * Loads dynamic decree compiler settings from valerie.system_settings.
 */
export async function getDecreeCompilerSettings(
  adminClient: SupabaseClient
): Promise<DecreeCompilerSettings> {
  const settings: DecreeCompilerSettings = { ...DEFAULT_DECREE_SETTINGS };
  try {
    const target =
      typeof (adminClient as any).schema === "function"
        ? (adminClient as any).schema("valerie").from("system_settings")
        : adminClient.from("system_settings");

    const { data } = await target
      .select("key, value")
      .in("key", [
        "decree.cron_enabled",
        "decree.enabled",
        "decree_min_constituent_count",
        "decree_supermajority_threshold",
      ]);

    if (Array.isArray(data)) {
      for (const row of data) {
        if (row.key === "decree.cron_enabled" || row.key === "decree.enabled") {
          settings.enabled = row.value === true || row.value === "true";
        } else if (row.key === "decree_min_constituent_count") {
          settings.minConstituentCount = Number(row.value) || settings.minConstituentCount;
        } else if (row.key === "decree_supermajority_threshold") {
          settings.supermajorityThreshold = Number(row.value) || settings.supermajorityThreshold;
        }
      }
    }
  } catch {
    // Non-blocking fallback to defaults
  }
  return settings;
}

/**
 * Executes an hourly scan over active polls to trigger compile_sovereign_decree.
 */
export async function processDecreeCompiler(
  adminClient: SupabaseClient,
  options: {
    targetPollId?: string;
    dryRun?: boolean;
    nowIso?: string;
  } = {}
): Promise<DecreeCompilerSummary> {
  const settings = await getDecreeCompilerSettings(adminClient);

  if (!settings.enabled) {
    return {
      status: "paused_by_admin",
      eligiblePolls: 0,
      evaluatedPolls: 0,
      compiledDecrees: 0,
      results: [],
      message: "Decree compilation cron halted: decree.cron_enabled is false.",
    };
  }

  const nowIso = options.nowIso || new Date().toISOString();

  // 1. Query active polls eligible for compilation
  let pollsQuery = (adminClient as any)
    .schema("valerie")
    .from("polls")
    .select("id, question_text, is_active, created_at")
    .eq("is_active", true);

  if (options.targetPollId) {
    pollsQuery = pollsQuery.eq("id", options.targetPollId);
  }

  const { data: activePolls, error: pollsError } = await pollsQuery;

  if (pollsError) {
    return {
      status: "error",
      eligiblePolls: 0,
      evaluatedPolls: 0,
      compiledDecrees: 0,
      results: [],
      error: pollsError.message,
    };
  }

  if (!Array.isArray(activePolls) || activePolls.length === 0) {
    return {
      status: "success",
      eligiblePolls: 0,
      evaluatedPolls: 0,
      compiledDecrees: 0,
      results: [],
      message: "No active polls pending sovereign decree evaluation.",
    };
  }

  // 2. Filter out polls that already have a decree
  const pollIds = activePolls.map((p: any) => p.id);
  const { data: existingDecrees } = await (adminClient as any)
    .schema("valerie")
    .from("sovereign_decrees")
    .select("poll_id")
    .in("poll_id", pollIds);

  const sealedPollIdSet = new Set(
    Array.isArray(existingDecrees) ? existingDecrees.map((d: any) => d.poll_id) : []
  );

  const candidatePolls = activePolls.filter((p: any) => !sealedPollIdSet.has(p.id));

  if (candidatePolls.length === 0) {
    return {
      status: "success",
      eligiblePolls: 0,
      evaluatedPolls: 0,
      compiledDecrees: 0,
      results: [],
      message: "All active candidate polls already have registered decrees.",
    };
  }

  // 3. Evaluate each candidate poll for unlock status and constituent participation
  const results: DecreeCompilationResult[] = [];
  let compiledCount = 0;

  for (const poll of candidatePolls) {
    try {
      // Query votes for this poll
      const { data: responses, error: respError } = await (adminClient as any)
        .schema("valerie")
        .from("poll_responses")
        .select("locked_until")
        .eq("poll_id", poll.id);

      if (respError || !Array.isArray(responses)) {
        results.push({
          pollId: poll.id,
          questionText: poll.question_text,
          success: false,
          reason: `QUERY_ERROR: ${respError?.message || "Failed to load responses"}`,
        });
        continue;
      }

      const totalVotes = responses.length;
      if (totalVotes < settings.minConstituentCount) {
        results.push({
          pollId: poll.id,
          questionText: poll.question_text,
          success: false,
          totalVotes,
          reason: `INSUFFICIENT_VOTES: ${totalVotes} votes below threshold of ${settings.minConstituentCount}`,
        });
        continue;
      }

      const lockedCount = responses.filter(
        (r: any) => r.locked_until && r.locked_until > nowIso
      ).length;

      if (lockedCount > 0) {
        results.push({
          pollId: poll.id,
          questionText: poll.question_text,
          success: false,
          totalVotes,
          reason: `POLL_LOCKED: ${lockedCount} votes still within commit-lock cooldown`,
        });
        continue;
      }

      // If dry-run, report eligible without invoking mutating RPC
      if (options.dryRun) {
        results.push({
          pollId: poll.id,
          questionText: poll.question_text,
          success: true,
          totalVotes,
          reason: "DRY_RUN_ELIGIBLE: Poll is unlocked and meets participation threshold",
        });
        compiledCount++;
        continue;
      }

      // Invoke compile_sovereign_decree RPC
      const target =
        typeof (adminClient as any).schema === "function"
          ? (adminClient as any).schema("valerie")
          : adminClient;

      const { data: rpcRes, error: rpcError } = await target.rpc("compile_sovereign_decree", {
        p_poll_id: poll.id,
      });

      if (rpcError) {
        results.push({
          pollId: poll.id,
          questionText: poll.question_text,
          success: false,
          reason: `RPC_ERROR: ${rpcError.message}`,
        });
        continue;
      }

      const isSuccess = Boolean(rpcRes?.success);
      if (isSuccess) compiledCount++;

      results.push({
        pollId: poll.id,
        questionText: poll.question_text,
        success: isSuccess,
        decreeId: rpcRes?.decree_id,
        consensusShare: rpcRes?.consensus_share,
        totalVotes: rpcRes?.total_votes,
        merkleRootHash: rpcRes?.merkle_root_hash,
        reason: isSuccess ? undefined : rpcRes?.reason,
      });
    } catch (err: unknown) {
      results.push({
        pollId: poll.id,
        questionText: poll.question_text,
        success: false,
        reason: `UNEXPECTED_EXCEPTION: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    status: "success",
    eligiblePolls: candidatePolls.length,
    evaluatedPolls: candidatePolls.length,
    compiledDecrees: compiledCount,
    results,
  };
}
