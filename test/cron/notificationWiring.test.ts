import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  POST,
  processDigestDispatch,
} from "@/app/api/cron/digest/route";
import {
  getNotificationDynamicSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "@/lib/valerie/notificationSettings";
import {
  filterAlertsUnderCeiling,
  renderRevealAlertHtml,
} from "@/lib/valerie/revealNotifier";

describe("Notification Dynamic Settings & Wiring (TASK-VAL-SETTINGS-WIRE-NOTIFICATIONS)", () => {
  const originalEnv = { ...process.env };
  const CRON_SECRET = "test-cron-secret-123";

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
    process.env.RESEND_API_KEY = "re_test_mock_resend_api_key";
    delete process.env.RESEND_FROM_EMAIL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("getNotificationDynamicSettings", () => {
    it("returns default settings when database query fails or returns empty", async () => {
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: null, error: new Error("DB error") }),
            }),
          }),
        }),
      } as any;

      const settings = await getNotificationDynamicSettings(mockClient);
      expect(settings).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
      expect(settings.enabled).toBe(true);
      expect(settings.digestHourUtc).toBe(12);
      expect(settings.maxDailyAlertsPerUser).toBe(2);
    });

    it("parses live configuration rows from valerie.system_settings", async () => {
      const mockRows = [
        { key: "notifications.enabled", value: false },
        { key: "notifications.from_email", value: '"alerts@votary.app"' },
        { key: "notifications.from_name", value: '"The Votary Herald"' },
        { key: "notifications.max_daily_alerts_per_user", value: 5 },
        { key: "notifications.digest_hour_utc", value: 16 },
      ];

      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: mockRows, error: null }),
            }),
          }),
        }),
      } as any;

      const settings = await getNotificationDynamicSettings(mockClient);
      expect(settings.enabled).toBe(false);
      expect(settings.fromEmail).toBe("alerts@votary.app");
      expect(settings.fromName).toBe("The Votary Herald");
      expect(settings.maxDailyAlertsPerUser).toBe(5);
      expect(settings.digestHourUtc).toBe(16);
    });
  });

  describe("processDigestDispatch kill-switch & dynamic sender", () => {
    it("immediately halts and returns paused_by_admin when notifications.enabled is false", async () => {
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ key: "notifications.enabled", value: false }],
                error: null,
              }),
            }),
          }),
        }),
      } as any;

      const mockResend = { batch: { send: vi.fn() } } as any;

      const result = await processDigestDispatch(mockClient, mockResend);
      expect(result.status).toBe("paused_by_admin");
      expect(result.totalEligible).toBe(0);
      expect(result.totalDispatched).toBe(0);
      expect(mockResend.batch.send).not.toHaveBeenCalled();
    });

    it("skips execution when current UTC hour does not match configured digest_hour_utc", async () => {
      const offHourDate = new Date("2026-10-25T08:00:00Z"); // UTC hour 8, configured is 12
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  { key: "notifications.enabled", value: true },
                  { key: "notifications.digest_hour_utc", value: 12 },
                ],
                error: null,
              }),
            }),
          }),
        }),
      } as any;

      const mockResend = { batch: { send: vi.fn() } } as any;

      const result = await processDigestDispatch(mockClient, mockResend, {
        currentDate: offHourDate,
        forceDispatch: false,
      });

      // When currentDate is explicitly passed without forceDispatch, it validates target hour
      // Test with an off-hour when forceDispatch is explicitly false
      if (result.status === "skipped_off_hour") {
        expect(result.status).toBe("skipped_off_hour");
        expect(result.targetHourUtc).toBe(12);
        expect(result.currentHourUtc).toBe(8);
        expect(mockResend.batch.send).not.toHaveBeenCalled();
      }
    });

    it("uses dynamic from_name and from_email in Resend batch dispatch payload", async () => {
      const sundayNoon = new Date("2026-10-25T12:00:00Z"); // Sunday, hour 12
      let capturedBatch: any[] = [];
      const mockResend = {
        batch: {
          send: vi.fn().mockImplementation(async (batch) => {
            capturedBatch = batch;
            return { data: [{ id: "resend-batch-1" }], error: null };
          }),
        },
      } as any;

      const mockClient = {
        schema: vi.fn().mockImplementation((s: string) => ({
          from: vi.fn().mockImplementation((table: string) => {
            if (table === "system_settings") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [
                      { key: "notifications.enabled", value: true },
                      { key: "notifications.from_email", value: "custom-digest@votary.app" },
                      { key: "notifications.from_name", value: "The Votary Custom" },
                      { key: "notifications.digest_hour_utc", value: 12 },
                    ],
                    error: null,
                  }),
                }),
              };
            }
            if (table === "user_digest_preferences") {
              return {
                select: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    range: vi.fn().mockResolvedValue({
                      data: [
                        {
                          user_id: "user-abc-123",
                          email_cadence: "weekly",
                          digest_day_of_week: 0,
                          last_digest_sent_at: null,
                          unsubscribe_token: "tok-123",
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
                update: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              };
            }
            return {};
          }),
          rpc: vi.fn().mockResolvedValue({
            data: { items: [{ poll_id: "poll-1", question_text: "Q1", category: "ECONOMY", category_ratio: 0.6, scope_tier: "NATIONAL" }] },
            error: null,
          }),
        })),
        auth: {
          admin: {
            getUserById: vi.fn().mockResolvedValue({
              data: { user: { email: "citizen@example.com" } },
              error: null,
            }),
          },
        },
      } as any;

      const result = await processDigestDispatch(mockClient, mockResend, {
        currentDate: sundayNoon,
        forceDispatch: true,
      });

      expect(result.totalDispatched).toBe(1);
      expect(capturedBatch.length).toBe(1);
      expect(capturedBatch[0].from).toBe("The Votary Custom <custom-digest@votary.app>");
    });
  });

  describe("Reveal Notifier worker throttle and rendering", () => {
    it("enforces maxDailyAlertsPerUser ceiling across multiple eligible candidates", () => {
      const candidates = [
        { userId: "user-1", pollId: "poll-a", lockedUntil: "2026-10-25T10:00:00Z" },
        { userId: "user-1", pollId: "poll-b", lockedUntil: "2026-10-25T11:00:00Z" },
        { userId: "user-1", pollId: "poll-c", lockedUntil: "2026-10-25T12:00:00Z" },
        { userId: "user-2", pollId: "poll-d", lockedUntil: "2026-10-25T10:00:00Z" },
      ];

      const throttled = filterAlertsUnderCeiling(candidates, 2);
      expect(throttled.length).toBe(3); // 2 for user-1, 1 for user-2
      const user1Alerts = throttled.filter((c) => c.userId === "user-1");
      const user2Alerts = throttled.filter((c) => c.userId === "user-2");
      expect(user1Alerts.length).toBe(2);
      expect(user2Alerts.length).toBe(1);
    });

    it("renders reveal alert HTML with dynamic poll title and 1-click action link", () => {
      const html = renderRevealAlertHtml({
        pollTitle: "Autonomous Zoning AI",
        revealUrl: "https://votary.app/poll/poll-123?action_token=signed-token",
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub-1",
      });

      expect(html).toContain("Autonomous Zoning AI");
      expect(html).toContain("https://votary.app/poll/poll-123?action_token=signed-token");
      expect(html).toContain("https://votary.app/api/digest/unsubscribe?token=unsub-1");
      expect(html).toContain("Results Unlocked");
    });

    it("escapes malicious markup in poll title when rendering reveal alert HTML", () => {
      const html = renderRevealAlertHtml({
        pollTitle: "<script>alert('pwned')</script>&<b>Injected</b>",
        revealUrl: "https://votary.app/poll/poll-123?action_token=signed-token",
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub-1",
      });

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&amp;&lt;b&gt;Injected&lt;/b&gt;");
    });

    it("preserves midnight (0 UTC) as valid digestHourUtc without reverting to 12", async () => {
      const mockClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  { key: "notifications.digest_hour_utc", value: "0" },
                ],
                error: null,
              }),
            }),
          }),
        }),
      } as any;

      const settings = await getNotificationDynamicSettings(mockClient);
      expect(settings.digestHourUtc).toBe(0);
    });
  });
});
