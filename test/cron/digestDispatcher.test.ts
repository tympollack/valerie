import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  POST,
  isUserEligibleForDigest,
  sendBatchWithRetry,
  processDigestDispatch,
} from "@/app/api/cron/digest/route";
import { GET as handleUnsubscribe } from "@/app/api/digest/unsubscribe/route";
import { verifyEmailActionToken } from "@/lib/auth/emailTokens";

describe("Scheduled Civic Digest Dispatcher (TASK-VAL-CRON-DISPATCH)", () => {
  const originalEnv = { ...process.env };
  const CRON_SECRET = "test-cron-secret-123";

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
    process.env.RESEND_API_KEY = "re_test_mock_resend_api_key";
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://valerie.sunshade.icu";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("Cron Route Security (401 Rejection)", () => {
    it("rejects calls with missing Authorization header", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/api/cron/digest", {
        method: "POST",
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });

    it("rejects calls with invalid Bearer secret", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/api/cron/digest", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-secret-456",
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects when CRON_SECRET is not configured on server", async () => {
      delete process.env.CRON_SECRET;
      const req = new NextRequest("https://valerie.sunshade.icu/api/cron/digest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  describe("Cadence Eligibility Evaluator (isUserEligibleForDigest)", () => {
    it("returns false for cadence 'off'", () => {
      expect(
        isUserEligibleForDigest({
          email_cadence: "off",
          digest_day_of_week: 0,
          last_digest_sent_at: null,
        })
      ).toBe(false);
    });

    it("allows daily cadence when never sent or sent > 20h ago", () => {
      const now = new Date("2026-10-25T12:00:00Z");

      // Never sent
      expect(
        isUserEligibleForDigest(
          { email_cadence: "daily", digest_day_of_week: 0, last_digest_sent_at: null },
          now
        )
      ).toBe(true);

      // Sent 22 hours ago
      const past22h = new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString();
      expect(
        isUserEligibleForDigest(
          { email_cadence: "daily", digest_day_of_week: 0, last_digest_sent_at: past22h },
          now
        )
      ).toBe(true);

      // Sent 3 hours ago -> false
      const past3h = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
      expect(
        isUserEligibleForDigest(
          { email_cadence: "daily", digest_day_of_week: 0, last_digest_sent_at: past3h },
          now
        )
      ).toBe(false);
    });

    it("allows weekly cadence only on configured day of week and interval >= 6 days", () => {
      // 2026-10-25 is a Sunday (UTC day 0)
      const sunday = new Date("2026-10-25T12:00:00Z");
      expect(sunday.getUTCDay()).toBe(0);

      // Eligible on Sunday if never sent
      expect(
        isUserEligibleForDigest(
          { email_cadence: "weekly", digest_day_of_week: 0, last_digest_sent_at: null },
          sunday
        )
      ).toBe(true);

      // Ineligible on Sunday if preferred day is Wednesday (3)
      expect(
        isUserEligibleForDigest(
          { email_cadence: "weekly", digest_day_of_week: 3, last_digest_sent_at: null },
          sunday
        )
      ).toBe(false);

      // Ineligible on Sunday if sent 2 days ago
      const twoDaysAgo = new Date(sunday.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        isUserEligibleForDigest(
          { email_cadence: "weekly", digest_day_of_week: 0, last_digest_sent_at: twoDaysAgo },
          sunday
        )
      ).toBe(false);

      // Eligible on Sunday if sent 7 days ago
      const sevenDaysAgo = new Date(sunday.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(
        isUserEligibleForDigest(
          { email_cadence: "weekly", digest_day_of_week: 0, last_digest_sent_at: sevenDaysAgo },
          sunday
        )
      ).toBe(true);
    });
  });

  describe("Resend Batch Sending with Exponential Backoff (sendBatchWithRetry)", () => {
    it("sends batch successfully on first attempt", async () => {
      const mockSend = vi.fn().mockResolvedValue({
        data: [{ id: "resend-batch-id-1" }],
        error: null,
      });
      const resend = { batch: { send: mockSend } } as any;

      const batch = [
        {
          from: "The Votary <digest@valerie.sunshade.icu>",
          to: "voter@example.com",
          subject: "The Civic Docket",
          html: "<p>Test</p>",
        },
      ];

      const res = await sendBatchWithRetry(resend, batch);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(res).toEqual([{ id: "resend-batch-id-1" }]);
    });

    it("retries with exponential backoff on 429 / rate_limit_exceeded error", async () => {
      let callCount = 0;
      const mockSend = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            data: null,
            error: {
              name: "rate_limit_exceeded",
              message: "Rate limit exceeded. Too many requests.",
              statusCode: 429,
            },
          };
        }
        return {
          data: [{ id: "resend-batch-id-retry-ok" }],
          error: null,
        };
      });

      const resend = { batch: { send: mockSend } } as any;
      const batch = [
        {
          from: "The Votary <digest@valerie.sunshade.icu>",
          to: "voter@example.com",
          subject: "The Civic Docket",
          html: "<p>Test</p>",
        },
      ];

      const res = await sendBatchWithRetry(resend, batch, 3, 5);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(res).toEqual([{ id: "resend-batch-id-retry-ok" }]);
    });

    it("fails after exceeding max retries on persistent rate limit", async () => {
      const mockSend = vi.fn().mockResolvedValue({
        data: null,
        error: {
          name: "rate_limit_exceeded",
          message: "Rate limit exceeded",
        },
      });
      const resend = { batch: { send: mockSend } } as any;

      await expect(
        sendBatchWithRetry(
          resend,
          [{ from: "a", to: "b", subject: "c", html: "d" }],
          2,
          5
        )
      ).rejects.toThrow(/rate limit exceeded/i);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("End-to-End Batch Pipeline (processDigestDispatch)", () => {
    it("assembles personalized digests, generates HMAC action deep links, dispatches via Resend, and updates timestamps", async () => {
      const userId = "user-batch-1";
      const userEmail = "voter-active@sunshade.icu";
      const pollId = "poll-uuid-999";

      // Mock user preferences row
      const mockPrefs = [
        {
          user_id: userId,
          email_cadence: "weekly",
          proximity_alerts_enabled: true,
          digest_day_of_week: 0, // Sunday
          last_digest_sent_at: null,
          unsubscribe_token: "unsub-token-1234",
        },
      ];

      // Mock raw digest payload from assemble_digest_payload RPC
      const mockRawDigest = [
        {
          poll_id: pollId,
          question_text: "Should autonomous zoning laws require 70% supermajority?",
          category: "PERSONA_MATCH",
          category_ratio: "60%",
          scope_tier: "STATE",
        },
      ];

      const mockUpdate = vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockAdminClient = {
        schema: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: mockPrefs, error: null }),
          }),
          update: mockUpdate,
        }),
        rpc: vi.fn().mockResolvedValue({ data: mockRawDigest, error: null }),
        auth: {
          admin: {
            getUserById: vi.fn().mockResolvedValue({
              data: { user: { id: userId, email: userEmail } },
              error: null,
            }),
          },
        },
      } as unknown as any;

      let capturedBatch: any[] = [];
      const mockResend = {
        batch: {
          send: vi.fn().mockImplementation(async (batch) => {
            capturedBatch = batch;
            return { data: [{ id: "sent-batch-1" }], error: null };
          }),
        },
      } as any;

      const sunday = new Date("2026-10-25T12:00:00Z");
      const summary = await processDigestDispatch(mockAdminClient, mockResend, {
        currentDate: sunday,
      });

      expect(summary.totalEligible).toBe(1);
      expect(summary.totalDispatched).toBe(1);
      expect(mockResend.batch.send).toHaveBeenCalledTimes(1);
      expect(capturedBatch.length).toBe(1);

      const dispatchedEmail = capturedBatch[0];
      expect(dispatchedEmail.to).toBe(userEmail);
      expect(dispatchedEmail.from).toBe("The Votary <digest@votary.app>");
      expect(dispatchedEmail.html).toContain("The Civic Docket");
      expect(dispatchedEmail.html).toContain("Should autonomous zoning laws require");

      // Verify HMAC action token was generated and embedded in deep link
      const tokenMatch = dispatchedEmail.html.match(/action_token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
      expect(tokenMatch).not.toBeNull();
      const extractedToken = tokenMatch[1];

      const verification = await verifyEmailActionToken(extractedToken);
      expect(verification.valid).toBe(true);
      expect(verification.payload?.sub).toBe(userId);
      expect(verification.payload?.pollId).toBe(pollId);
      expect(verification.payload?.action).toBe("vote");

      // Verify unsubscribe link contains token
      expect(dispatchedEmail.html).toContain("token=unsub-token-1234");

      // Verify last_digest_sent_at update was called
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe("Unsubscribe Endpoint (CAN-SPAM Compliance)", () => {
    it("updates email_cadence to 'off' when provided a valid token", async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: [{ user_id: "user-123" }],
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      const mockAdminClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            update: mockUpdate,
          }),
        }),
      } as any;

      const { handleUnsubscribeToken } = await import("@/app/api/digest/unsubscribe/route");
      const result = await handleUnsubscribeToken("valid-token-uuid", mockAdminClient);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({ email_cadence: "off" });
      expect(mockEq).toHaveBeenCalledWith("unsubscribe_token", "valid-token-uuid");
    });

    it("returns 404 when unsubscribe token is invalid or not found", async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      const mockAdminClient = {
        schema: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            update: mockUpdate,
          }),
        }),
      } as any;

      const { handleUnsubscribeToken } = await import("@/app/api/digest/unsubscribe/route");
      const result = await handleUnsubscribeToken("non-existent-token", mockAdminClient);

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.message).toMatch(/invalid or expired/i);
    });

    it("returns 400 when unsubscribe token is missing from request", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/api/digest/unsubscribe");
      const res = await handleUnsubscribe(req);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Missing unsubscribe token");
    });
  });
});
