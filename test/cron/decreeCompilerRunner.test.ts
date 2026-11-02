/**
 * Project Valerie: Sovereign Decree Compiler Runner Unit Tests
 * File: test/cron/decreeCompilerRunner.test.ts
 * Work Item: [TASK-VAL-DECREE-COMPILER-RUNNER] / [STORY-VAL-DECREE-INACTION]
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDecreeCompilerSettings,
  processDecreeCompiler,
  DEFAULT_DECREE_SETTINGS,
} from "../../lib/valerie/decreeCompilerRunner";

function mockPollResponsesQuery(totalCount: number, lockedCount: number, queryError: any = null) {
  return {
    eq: vi.fn().mockReturnValue({
      gt: vi.fn().mockResolvedValue({
        count: lockedCount,
        error: queryError,
      }),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ count: totalCount, error: queryError }).then(resolve, reject),
    }),
  };
}

describe("Sovereign Decree Compiler Runner (TASK-VAL-DECREE-COMPILER-RUNNER)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getDecreeCompilerSettings", () => {
    it("returns default fallback settings when system_settings has no entries", async () => {
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      } as any;

      const settings = await getDecreeCompilerSettings(mockClient);
      expect(settings.enabled).toBe(true);
      expect(settings.minConstituentCount).toBe(250);
      expect(settings.supermajorityThreshold).toBe(0.70);
    });

    it("parses dynamic setting overrides from valerie.system_settings", async () => {
      const mockSettings = [
        { key: "decree.cron_enabled", value: false },
        { key: "decree_min_constituent_count", value: 100 },
        { key: "decree_supermajority_threshold", value: 0.65 },
      ];

      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: mockSettings, error: null }),
            }),
          }),
        }),
      } as any;

      const settings = await getDecreeCompilerSettings(mockClient);
      expect(settings.enabled).toBe(false);
      expect(settings.minConstituentCount).toBe(100);
      expect(settings.supermajorityThreshold).toBe(0.65);
    });

    it("fails closed (enabled: false) when system_settings query returns an error", async () => {
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "connection to system_settings failed" },
              }),
            }),
          }),
        }),
      } as any;

      const settings = await getDecreeCompilerSettings(mockClient);
      expect(settings.enabled).toBe(false);
    });

    it("fails closed (enabled: false) when system_settings query throws an exception", async () => {
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockRejectedValue(new Error("Database crash")),
            }),
          }),
        }),
      } as any;

      const settings = await getDecreeCompilerSettings(mockClient);
      expect(settings.enabled).toBe(false);
    });
  });

  describe("processDecreeCompiler", () => {
    const fixedNowIso = "2026-10-31T12:00:00.000Z";

    it("halts immediately with paused_by_admin when decree.cron_enabled is false", async () => {
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ key: "decree.cron_enabled", value: false }],
                error: null,
              }),
            }),
          }),
        }),
      } as any;

      const result = await processDecreeCompiler(mockClient);
      expect(result.status).toBe("paused_by_admin");
      expect(result.compiledDecrees).toBe(0);
      expect(result.message).toContain("halted");
    });

    it("handles zero active polls gracefully", async () => {
      const mockClient = {
        schema: vi.fn().mockImplementation((schema: string) => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "polls") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            };
          }),
        })),
      } as any;

      const result = await processDecreeCompiler(mockClient);
      expect(result.status).toBe("success");
      expect(result.eligiblePolls).toBe(0);
      expect(result.compiledDecrees).toBe(0);
    });

    it("skips polls that already have a sealed decree in valerie.sovereign_decrees", async () => {
      const mockPolls = [
        { id: "poll-sealed-1", question_text: "Transit Supermajority", is_active: true },
      ];
      const mockExistingDecrees = [{ poll_id: "poll-sealed-1" }];

      const mockClient = {
        schema: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "polls") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: mockPolls, error: null }),
                }),
              };
            }
            if (table === "sovereign_decrees") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: mockExistingDecrees, error: null }),
                }),
              };
            }
            return {};
          }),
        })),
      } as any;

      const result = await processDecreeCompiler(mockClient);
      expect(result.status).toBe("success");
      expect(result.eligiblePolls).toBe(0);
      expect(result.compiledDecrees).toBe(0);
      expect(result.message).toContain("already have registered decrees");
    });

    it("skips polls with insufficient constituent votes (< 250)", async () => {
      const mockPolls = [
        { id: "poll-low-participation", question_text: "Low Participation Poll", is_active: true },
      ];

      const mockClient = {
        schema: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "polls") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: mockPolls, error: null }),
                }),
              };
            }
            if (table === "sovereign_decrees") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "poll_responses") {
              return {
                select: vi.fn().mockReturnValue(mockPollResponsesQuery(50, 0)),
              };
            }
            return {};
          }),
        })),
      } as any;

      const result = await processDecreeCompiler(mockClient, { nowIso: fixedNowIso });
      expect(result.status).toBe("success");
      expect(result.eligiblePolls).toBe(1);
      expect(result.compiledDecrees).toBe(0);
      expect(result.results[0].reason).toContain("INSUFFICIENT_VOTES");
    });

    it("skips polls that still have active commit-lock cooldowns (locked_until > now)", async () => {
      const mockPolls = [
        { id: "poll-locked-window", question_text: "Locked Window Poll", is_active: true },
      ];

      const mockClient = {
        schema: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "polls") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: mockPolls, error: null }),
                }),
              };
            }
            if (table === "sovereign_decrees") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "poll_responses") {
              return {
                select: vi.fn().mockReturnValue(mockPollResponsesQuery(260, 10)),
              };
            }
            return {};
          }),
        })),
      } as any;

      const result = await processDecreeCompiler(mockClient, { nowIso: fixedNowIso });
      expect(result.status).toBe("success");
      expect(result.eligiblePolls).toBe(1);
      expect(result.compiledDecrees).toBe(0);
      expect(result.results[0].reason).toContain("POLL_LOCKED");
    });

    it("successfully compiles decree via RPC when unlocked with >= 250 votes", async () => {
      const mockPolls = [
        { id: "poll-supermajority", question_text: "Clean Energy Transition Mandate", is_active: true },
      ];

      const mockRpcResponse = {
        success: true,
        decree_id: "decree-uuid-777",
        consensus_share: 0.84,
        total_votes: 300,
        merkle_root_hash: "a1b2c3d4e5f67890123456789abcdef0",
      };

      const mockRpc = vi.fn().mockResolvedValue({ data: mockRpcResponse, error: null });

      const mockClient = {
        schema: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "polls") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: mockPolls, error: null }),
                }),
              };
            }
            if (table === "sovereign_decrees") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "poll_responses") {
              return {
                select: vi.fn().mockReturnValue(mockPollResponsesQuery(300, 0)),
              };
            }
            return {};
          }),
          rpc: mockRpc,
        })),
      } as any;

      const result = await processDecreeCompiler(mockClient, { nowIso: fixedNowIso });

      expect(result.status).toBe("success");
      expect(result.eligiblePolls).toBe(1);
      expect(result.compiledDecrees).toBe(1);
      expect(mockRpc).toHaveBeenCalledWith("compile_sovereign_decree", {
        p_poll_id: "poll-supermajority",
      });

      const decreeResult = result.results[0];
      expect(decreeResult.success).toBe(true);
      expect(decreeResult.decreeId).toBe("decree-uuid-777");
      expect(decreeResult.consensusShare).toBe(0.84);
      expect(decreeResult.totalVotes).toBe(300);
      expect(decreeResult.merkleRootHash).toBe("a1b2c3d4e5f67890123456789abcdef0");
    });

    it("handles dry-run mode without invoking mutating RPC and keeps compiledDecrees 0", async () => {
      const mockPolls = [
        { id: "poll-dry-run", question_text: "Dry Run Mandate", is_active: true },
      ];
      const mockRpc = vi.fn();

      const mockClient = {
        schema: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "polls") {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: mockPolls, error: null }),
                }),
              };
            }
            if (table === "sovereign_decrees") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              };
            }
            if (table === "poll_responses") {
              return {
                select: vi.fn().mockReturnValue(mockPollResponsesQuery(300, 0)),
              };
            }
            return {};
          }),
          rpc: mockRpc,
        })),
      } as any;

      const result = await processDecreeCompiler(mockClient, {
        nowIso: fixedNowIso,
        dryRun: true,
      });

      expect(result.status).toBe("success");
      expect(result.compiledDecrees).toBe(0); // Dry-run does not write decrees
      expect(mockRpc).not.toHaveBeenCalled();
      expect(result.results[0].reason).toContain("DRY_RUN_ELIGIBLE");
    });
  });
});
