/**
 * Project Valerie: Reveal Notifier Trigger & Event Listener Unit Tests
 * File: test/cron/revealNotifierTrigger.test.ts
 * Work Item: [TASK-VAL-REVEAL-NOTIF-TRIGGER]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyCallerStance,
  computeCommunityTrajectory,
  filterAlertsUnderCeiling,
  renderRevealAlertHtml,
  processRevealNotifier,
} from "../../lib/valerie/revealNotifier";

describe("Reveal Alert Notifier Trigger (TASK-VAL-REVEAL-NOTIF-TRIGGER)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("classifyCallerStance", () => {
    it("correctly identifies all 9 psychometric stance archetypes", () => {
      // High confidence (>=75)
      expect(classifyCallerStance(1, 85)).toBe("Bedrock Conviction");
      expect(classifyCallerStance(-1, 80)).toBe("Principled Dissent");
      expect(classifyCallerStance(0, 90)).toBe("Deliberate Equilibrium");

      // Mid confidence (40..74)
      expect(classifyCallerStance(1, 60)).toBe("Grounded Support");
      expect(classifyCallerStance(-1, 50)).toBe("Grounded Skepticism");
      expect(classifyCallerStance(0, 45)).toBe("Balanced Inquiry");

      // Low confidence (<40)
      expect(classifyCallerStance(1, 20)).toBe("Provisional Curiosity");
      expect(classifyCallerStance(-1, 15)).toBe("Provisional Concern");
      expect(classifyCallerStance(0, 10)).toBe("Agnostic Observer");
    });
  });

  describe("computeCommunityTrajectory", () => {
    it("handles empty poll responses cleanly", () => {
      const result = computeCommunityTrajectory([]);
      expect(result.totalVotes).toBe(0);
      expect(result.trajectory).toContain("Results Unlocked");
    });

    it("identifies Resolute Affirmation when community skews strongly positive", () => {
      const responses = [
        { likert_score: 1, confidence_score: 80 },
        { likert_score: 2, confidence_score: 90 },
        { likert_score: 1, confidence_score: 75 },
        { likert_score: 2, confidence_score: 85 },
      ];
      const result = computeCommunityTrajectory(responses);
      expect(result.totalVotes).toBe(4);
      expect(result.consensusPct).toBe(100);
      expect(result.trajectory).toContain("Resolute Affirmation");
    });

    it("identifies Principled Rejection when community skews strongly negative", () => {
      const responses = [
        { likert_score: -2, confidence_score: 80 },
        { likert_score: -1, confidence_score: 70 },
        { likert_score: -2, confidence_score: 90 },
      ];
      const result = computeCommunityTrajectory(responses);
      expect(result.totalVotes).toBe(3);
      expect(result.trajectory).toContain("Principled Rejection");
    });

    it("detects Polarized Bivariate Distribution under high variance", () => {
      const responses = [
        { likert_score: -2, confidence_score: 90 },
        { likert_score: -2, confidence_score: 85 },
        { likert_score: 2, confidence_score: 95 },
        { likert_score: 2, confidence_score: 90 },
      ];
      const result = computeCommunityTrajectory(responses);
      expect(result.totalVotes).toBe(4);
      expect(result.controversyScore).toBeGreaterThan(60);
      expect(result.trajectory).toContain("Polarized Bivariate Distribution");
    });

    it("does not report 100% oppose for all-neutral ballots (Deliberative Equilibrium)", () => {
      const responses = [
        { likert_score: 0, confidence_score: 50 },
        { likert_score: 0, confidence_score: 60 },
        { likert_score: 0, confidence_score: 40 },
      ];
      const result = computeCommunityTrajectory(responses);
      expect(result.totalVotes).toBe(3);
      expect(result.trajectory).toContain("Deliberative Equilibrium");
      expect(result.trajectory).not.toContain("Principled Rejection");
    });
  });

  describe("filterAlertsUnderCeiling & Rate Limiting", () => {
    it("caps alerts at maxDailyAlertsPerUser (max 2 per user per day)", () => {
      const candidates = [
        { userId: "usr-1", pollId: "p-1", lockedUntil: "2026-10-31T12:00:00Z" },
        { userId: "usr-1", pollId: "p-2", lockedUntil: "2026-10-31T13:00:00Z" },
        { userId: "usr-1", pollId: "p-3", lockedUntil: "2026-10-31T14:00:00Z" }, // should be dropped
        { userId: "usr-2", pollId: "p-1", lockedUntil: "2026-10-31T12:00:00Z" },
      ];

      const allowed = filterAlertsUnderCeiling(candidates, 2);
      expect(allowed.length).toBe(3);
      expect(allowed.filter((c) => c.userId === "usr-1").length).toBe(2);
      expect(allowed.filter((c) => c.userId === "usr-2").length).toBe(1);
    });
  });

  describe("processRevealNotifier Database Duplicate Prevention & Dispatch Logic", () => {
    it("queries reveal_notified = false and marks reveal_notified = true after dispatch", async () => {
      const mockResponses = [
        {
          user_id: "u-101",
          poll_id: "poll-202",
          locked_until: "2026-10-31T12:00:00Z",
          likert_score: 2,
          confidence_score: 85,
          reveal_notified: false,
        },
      ];

      const mockPrefs = [
        {
          user_id: "u-101",
          proximity_alerts_enabled: true,
          email_cadence: "daily",
          unsubscribe_token: "unsub-tok-1",
        },
      ];

      const mockPolls = [{ id: "poll-202", title: "Autonomous Transit Network" }];

      const updatedRecords: Array<{ poll_id: string; user_id: string; reveal_notified: boolean }> = [];

      // Construct fluent Supabase client mock
      const mockClient = {
        schema: vi.fn().mockImplementation((schemaName: string) => ({
          from: vi.fn().mockImplementation((tableName: string) => {
            if (tableName === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [{ key: "notifications.enabled", value: true }],
                    error: null,
                  }),
                }),
              };
            }
            if (tableName === "poll_responses") {
              const chain: any = {
                lte: vi.fn().mockImplementation(() => chain),
                eq: vi.fn().mockImplementation(() => chain),
                limit: vi.fn().mockResolvedValue({ data: mockResponses, error: null }),
                in: vi.fn().mockResolvedValue({ data: mockResponses, error: null }),
                gte: vi.fn().mockResolvedValue({ data: [], error: null }),
                range: vi.fn().mockResolvedValue({ data: mockResponses, error: null }),
                then(resolve: any) { return Promise.resolve({ data: mockResponses, error: null }).then(resolve); },
              };
              return {
                select: vi.fn().mockReturnValue(chain),
                update: vi.fn().mockImplementation((patch: any) => ({
                  eq: vi.fn().mockImplementation((f1: string, v1: string) => ({
                    eq: vi.fn().mockImplementation((f2: string, v2: string) => {
                      updatedRecords.push({
                        poll_id: f1 === "poll_id" ? v1 : v2,
                        user_id: f1 === "user_id" ? v1 : v2,
                        reveal_notified: patch.reveal_notified,
                      });
                      return Promise.resolve({ data: null, error: null });
                    }),
                  })),
                })),
              };
            }
            if (tableName === "user_digest_preferences") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      neq: vi.fn().mockResolvedValue({ data: mockPrefs, error: null }),
                    }),
                  }),
                }),
              };
            }
            if (tableName === "polls") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: mockPolls, error: null }),
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
        auth: {
          admin: {
            getUserById: vi.fn().mockResolvedValue({
              data: { user: { email: "citizen@votary.app" } },
              error: null,
            }),
          },
        },
      } as any;

      const mockResendApiKey = "re_test_key_123";
      const fetchCalls: any[] = [];
      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        fetchCalls.push({ url, opts });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: "resend-msg-1" }] }),
        });
      });



      const result = await processRevealNotifier(mockClient, mockResendApiKey, {
        appBaseUrl: "https://votary.app",
        tokenSecret: "secret-key",
      });

      expect(result.status).toBe("success");
      expect(result.totalEligible).toBe(1);
      expect(result.totalDispatched).toBe(1);

      // Verify batch email was dispatched with Resend
      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe("https://api.resend.com/emails/batch");
      const sentPayload = JSON.parse(fetchCalls[0].opts.body);
      expect(sentPayload[0].to).toBe("citizen@votary.app");
      expect(sentPayload[0].subject).toContain("Results Unlocked");
      expect(sentPayload[0].html).toContain("Autonomous Transit Network");
      expect(sentPayload[0].html).toContain("Bedrock Conviction");

      // Verify reveal_notified = true was updated to prevent duplicate dispatches
      expect(updatedRecords.length).toBe(1);
      expect(updatedRecords[0].poll_id).toBe("poll-202");
      expect(updatedRecords[0].user_id).toBe("u-101");
      expect(updatedRecords[0].reveal_notified).toBe(true);
    });

    it("does NOT mark reveal_notified when RESEND_API_KEY is missing without mock flag", async () => {
      const mockResponses = [
        {
          user_id: "u-202",
          poll_id: "poll-303",
          locked_until: "2026-10-31T12:00:00Z",
          likert_score: 1,
          confidence_score: 50,
          reveal_notified: false,
        },
      ];
      const mockPrefs = [
        {
          user_id: "u-202",
          proximity_alerts_enabled: true,
          email_cadence: "daily",
          unsubscribe_token: "tok-2",
        },
      ];
      const updatedRecords: any[] = [];
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockImplementation((table: string) => {
            const chain: any = {
              lte: vi.fn().mockImplementation(() => chain),
              eq: vi.fn().mockImplementation(() => chain),
              neq: vi.fn().mockResolvedValue({ data: mockPrefs, error: null }),
              limit: vi.fn().mockResolvedValue({ data: mockResponses, error: null }),
              in: vi.fn().mockImplementation(() => chain),
              gte: vi.fn().mockResolvedValue({ data: [], error: null }),
              range: vi.fn().mockResolvedValue({ data: mockResponses, error: null }),
              then(resolve: any) { return Promise.resolve({ data: mockResponses, error: null }).then(resolve); },
            };
            return {
              select: vi.fn().mockReturnValue(chain),
              update: vi.fn().mockImplementation((patch: any) => ({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockImplementation(() => {
                    updatedRecords.push(patch);
                    return Promise.resolve({ data: null, error: null });
                  }),
                }),
              })),
            };
          }),
        }),
        auth: {
          admin: {
            getUserById: vi.fn().mockResolvedValue({
              data: { user: { email: "test@votary.app" } },
              error: null,
            }),
          },
        },
      } as any;

      const result = await processRevealNotifier(mockClient, "", {
        tokenSecret: "secret",
      });

      expect(result.status).toBe("skipped_missing_api_key");
      expect(result.totalDispatched).toBe(0);
      expect(updatedRecords.length).toBe(0); // Not marked as notified!
    });

    it("marks permanently ineligible responses as reveal_notified to avoid queue blocking", async () => {
      const mockResponses = [
        {
          user_id: "u-ineligible",
          poll_id: "poll-999",
          locked_until: "2026-10-31T12:00:00Z",
          likert_score: 0,
          confidence_score: 50,
          reveal_notified: false,
        },
      ];
      // User is not in user_digest_preferences or has opted out
      const updatedRecords: any[] = [];
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [{ key: "notifications.enabled", value: true }],
                    error: null,
                  }),
                }),
              };
            }
            if (table === "poll_responses") {
              const chain: any = {
                lte: vi.fn().mockImplementation(() => chain),
                eq: vi.fn().mockImplementation(() => chain),
                limit: vi.fn().mockResolvedValue({ data: mockResponses, error: null }),
                in: vi.fn().mockImplementation(() => chain),
                gte: vi.fn().mockResolvedValue({ data: [], error: null }),
              };
              return {
                select: vi.fn().mockReturnValue(chain),
                update: vi.fn().mockImplementation((patch: any) => ({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockImplementation(() => {
                      updatedRecords.push(patch);
                      return Promise.resolve({ data: null, error: null });
                    }),
                  }),
                })),
              };
            }
            if (table === "user_digest_preferences") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      neq: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                }),
              };
            }
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            };
          }),
        }),
      } as any;

      const result = await processRevealNotifier(mockClient, "re_test_key", {
        tokenSecret: "secret",
      });

      expect(result.status).toBe("success");
      expect(result.totalEligible).toBe(0);
      expect(result.totalDispatched).toBe(0);
      expect(updatedRecords.length).toBe(1);
      expect(updatedRecords[0].reveal_notified).toBe(true);
      expect(updatedRecords[0].reveal_notified_at).toBeNull();
    });

    it("halts with error on preferences failure to prevent discarding pending alerts", async () => {
      const mockResponses = [
        {
          user_id: "u-outage",
          poll_id: "poll-outage",
          locked_until: "2026-10-31T12:00:00Z",
          likert_score: 0,
          confidence_score: 50,
          reveal_notified: false,
        },
      ];
      const updatedRecords: any[] = [];
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [{ key: "notifications.enabled", value: true }],
                    error: null,
                  }),
                }),
              };
            }
            if (table === "poll_responses") {
              const chain: any = {
                lte: vi.fn().mockImplementation(() => chain),
                eq: vi.fn().mockImplementation(() => chain),
                limit: vi.fn().mockResolvedValue({ data: mockResponses, error: null }),
                in: vi.fn().mockImplementation(() => chain),
                gte: vi.fn().mockResolvedValue({ data: [], error: null }),
              };
              return {
                select: vi.fn().mockReturnValue(chain),
                update: vi.fn().mockImplementation((patch: any) => ({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockImplementation(() => {
                      updatedRecords.push(patch);
                      return Promise.resolve({ data: null, error: null });
                    }),
                  }),
                })),
              };
            }
            if (table === "user_digest_preferences") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      neq: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: "Database connection timed out" },
                      }),
                    }),
                  }),
                }),
              };
            }
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            };
          }),
        }),
      } as any;

      const result = await processRevealNotifier(mockClient, "re_test_key", {
        tokenSecret: "secret",
      });

      expect(result.status).toBe("error");
      expect(result.error).toContain("Preferences query failed");
      // Critical: No records must be marked notified during an outage!
      expect(updatedRecords.length).toBe(0);
    });
  });
});
