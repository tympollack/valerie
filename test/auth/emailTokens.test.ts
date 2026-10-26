import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  generateEmailActionToken,
  verifyEmailActionToken,
  handleEmailActionTokenMiddleware,
  isActionTokenRoute,
  generateBridgedSSOToken,
} from "@/lib/auth/emailTokens";
import { validateSSOHandshake } from "@/lib/auth/ssoHandshake";

describe("Email Action Tokens & Auth Bridge (TASK-VAL-AUTH-HMAC-BRIDGE)", () => {
  const originalEnv = { ...process.env };
  const TEST_SECRET = "super-secret-jwt-key-for-valerie-testing-123";

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isActionTokenRoute", () => {
    it("recognizes poll and digest routes", () => {
      expect(isActionTokenRoute("/poll/123")).toBe(true);
      expect(isActionTokenRoute("/polls/abc-xyz")).toBe(true);
      expect(isActionTokenRoute("/poll")).toBe(true);
      expect(isActionTokenRoute("/digest/weekly")).toBe(true);
      expect(isActionTokenRoute("/digest")).toBe(true);
    });

    it("rejects non-action routes", () => {
      expect(isActionTokenRoute("/")).toBe(false);
      expect(isActionTokenRoute("/about")).toBe(false);
      expect(isActionTokenRoute("/api/health")).toBe(false);
      expect(isActionTokenRoute("/settings")).toBe(false);
    });
  });

  describe("generateEmailActionToken", () => {
    it("generates a valid 3-part JWT with 48h expiration by default", async () => {
      const userId = "user-uuid-1234";
      const pollId = "poll-uuid-5678";
      const token = await generateEmailActionToken(userId, pollId, "vote");

      expect(token).toBeDefined();
      const parts = token.split(".");
      expect(parts.length).toBe(3);

      const verification = await verifyEmailActionToken(token);
      expect(verification.valid).toBe(true);
      expect(verification.payload?.sub).toBe(userId);
      expect(verification.payload?.pollId).toBe(pollId);
      expect(verification.payload?.action).toBe("vote");
      expect(verification.payload?.iss).toBe("valerie.sunshade.icu");

      // Verify expiration is ~48 hours (2880 mins = 172800 secs)
      const nowSec = Math.floor(Date.now() / 1000);
      expect(verification.payload?.exp).toBeGreaterThanOrEqual(nowSec + 172700);
      expect(verification.payload?.exp).toBeLessThanOrEqual(nowSec + 172900);
    });

    it("accepts custom TTL and action", async () => {
      const token = await generateEmailActionToken("user-1", "poll-1", "reveal", 60);
      const verification = await verifyEmailActionToken(token);
      expect(verification.valid).toBe(true);
      expect(verification.payload?.action).toBe("reveal");

      const nowSec = Math.floor(Date.now() / 1000);
      expect(verification.payload?.exp).toBeGreaterThanOrEqual(nowSec + 3500);
      expect(verification.payload?.exp).toBeLessThanOrEqual(nowSec + 3700);
    });

    it("throws when userId is missing", async () => {
      await expect(generateEmailActionToken("")).rejects.toThrow("userId is required");
    });
  });

  describe("verifyEmailActionToken", () => {
    it("rejects tampered tokens cleanly", async () => {
      const token = await generateEmailActionToken("user-1", "poll-1", "vote");
      const parts = token.split(".");
      // Tamper payload
      const tampered = `${parts[0]}.${parts[1]}xyz.${parts[2]}`;
      const result = await verifyEmailActionToken(tampered);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects tokens signed with a different secret", async () => {
      const token = await generateEmailActionToken(
        "user-1",
        "poll-1",
        "vote",
        2880,
        "different-secret-key-456"
      );
      const result = await verifyEmailActionToken(token, { secret: TEST_SECRET });

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid.*signature/i);
    });

    it("rejects expired tokens cleanly without throwing", async () => {
      // 0 TTL or negative TTL
      const expiredPayload = {
        sub: "user-expired",
        exp: Math.floor(Date.now() / 1000) - 100,
        iat: Math.floor(Date.now() / 1000) - 200,
      };

      const encHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
        .toString("base64url");
      const encPayload = Buffer.from(JSON.stringify(expiredPayload))
        .toString("base64url");
      const dataToSign = `${encHeader}.${encPayload}`;

      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(TEST_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
      const sigB64 = Buffer.from(new Uint8Array(sig)).toString("base64url");
      const expiredToken = `${dataToSign}.${sigB64}`;

      const result = await verifyEmailActionToken(expiredToken);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/expired/i);
    });

    it("handles malformed input cleanly", async () => {
      expect((await verifyEmailActionToken("not.a.token.really")).valid).toBe(false);
      expect((await verifyEmailActionToken("")).valid).toBe(false);
      expect((await verifyEmailActionToken("random-garbage")).valid).toBe(false);
    });
  });

  describe("handleEmailActionTokenMiddleware", () => {
    it("ignores requests on non-action routes", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/about?action_token=xyz");
      const res = await handleEmailActionTokenMiddleware(req);
      expect(res).toBeNull();
    });

    it("ignores requests without action_token parameter", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/poll/123");
      const res = await handleEmailActionTokenMiddleware(req);
      expect(res).toBeNull();
    });

    it("intercepts valid action_token on /poll/*, strips token from URL, and seeds session cookie", async () => {
      const userId = "voter-uuid-777";
      const pollId = "poll-uuid-888";
      const token = await generateEmailActionToken(userId, pollId, "vote");

      const req = new NextRequest(
        `https://valerie.sunshade.icu/poll/${pollId}?action_token=${token}`
      );
      const res = await handleEmailActionTokenMiddleware(req);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(307);

      // Verify redirect target strips action_token
      const location = res!.headers.get("location");
      expect(location).toBe(`https://valerie.sunshade.icu/poll/${pollId}`);
      expect(location).not.toContain("action_token");

      // Verify seeded cross-domain session cookies
      const ssoCookie = res!.cookies.get("sunshade_sso");
      const ssoTokenCookie = res!.cookies.get("sunshade_sso_token");
      expect(ssoCookie).toBeDefined();
      expect(ssoTokenCookie).toBeDefined();

      // Verify seeded token validates with validateSSOHandshake
      const handshake = await validateSSOHandshake(
        `sunshade_sso=${ssoCookie!.value}`,
        { secret: TEST_SECRET }
      );
      expect(handshake.authenticated).toBe(true);
      expect(handshake.userId).toBe(userId);
      expect(handshake.isHumanVerified).toBe(true);
      expect(handshake.proof?.verificationTier).toBe("COMMUNITY_VERIFIED");
    });

    it("rejects tampered action_token cleanly by stripping from URL without seeding cookies", async () => {
      const req = new NextRequest(
        "https://valerie.sunshade.icu/poll/123?action_token=bad.tampered.token"
      );
      const res = await handleEmailActionTokenMiddleware(req);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(307);
      expect(res!.headers.get("location")).toBe("https://valerie.sunshade.icu/poll/123");
      expect(res!.cookies.get("sunshade_sso")).toBeUndefined();
    });

    it("does not overwrite existing session cookie if user is already logged in", async () => {
      const existingUser = "existing-authenticated-user";
      const existingToken = await generateBridgedSSOToken(existingUser);

      const userId = "voter-from-email";
      const token = await generateEmailActionToken(userId, "poll-123", "vote");

      const req = new NextRequest(
        `https://valerie.sunshade.icu/poll/123?action_token=${token}`,
        {
          headers: {
            cookie: `sunshade_sso=${existingToken}`,
          },
        }
      );
      const res = await handleEmailActionTokenMiddleware(req);

      expect(res).not.toBeNull();
      expect(res!.headers.get("location")).toBe("https://valerie.sunshade.icu/poll/123");
      // Existing cookie preserved (no overwrite set on response)
      expect(res!.cookies.get("sunshade_sso")).toBeUndefined();
    });
  });
});
