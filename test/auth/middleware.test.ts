import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  getUserContextFromHeaders,
  isVotingRoute,
  buildSSOLoginRedirect,
  buildSSOVerifyRedirect,
} from "@/lib/auth/ssoHandshake";

describe("Middleware SSO Handshake & Anti-Sybil Route Protection", () => {
  function createMockJWT(payload: Record<string, unknown>): string {
    const encHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const encPayload = Buffer.from(JSON.stringify(payload))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    return `${encHeader}.${encPayload}.mock_sig`;
  }

  const nowSec = Math.floor(Date.now() / 1000);

  const verifiedHumanJWT = createMockJWT({
    sub: "user-human-verified-1234",
    exp: nowSec + 3600,
    nbf: nowSec - 60,
    iss: "https://hub.sunshade.icu",
    app_metadata: {
      is_human: true,
      anti_sybil_verified: true,
      verification_tier: "ANCHOR",
      trust_state: "active",
    },
  });

  const unverifiedBotJWT = createMockJWT({
    sub: "user-bot-unverified-5678",
    exp: nowSec + 3600,
    nbf: nowSec - 60,
    iss: "https://hub.sunshade.icu",
    app_metadata: {
      is_human: false,
      anti_sybil_verified: false,
      verification_tier: "UNVERIFIED",
      trust_state: "active",
    },
  });

  const slashedUserJWT = createMockJWT({
    sub: "user-slashed-9999",
    exp: nowSec + 3600,
    nbf: nowSec - 60,
    iss: "https://hub.sunshade.icu",
    app_metadata: {
      is_human: true,
      anti_sybil_verified: true,
      verification_tier: "ANCHOR",
      trust_state: "slashed",
    },
  });

  describe("isVotingRoute detection", () => {
    it("identifies voting paths correctly", () => {
      expect(isVotingRoute("/vote")).toBe(true);
      expect(isVotingRoute("/voting")).toBe(true);
      expect(isVotingRoute("/polls/123/vote")).toBe(true);
      expect(isVotingRoute("/api/vote")).toBe(true);
    });

    it("identifies server actions targeting polls", () => {
      const headers = new Headers({ "next-action": "action_id_123" });
      expect(isVotingRoute("/polls/123", "POST", headers)).toBe(true);
    });

    it("allows non-voting paths", () => {
      expect(isVotingRoute("/")).toBe(false);
      expect(isVotingRoute("/about")).toBe(false);
      expect(isVotingRoute("/polls/123")).toBe(false);
      expect(isVotingRoute("/api/health")).toBe(false);
    });
  });

  describe("updateSession with Wildcard SSO Cookie", () => {
    it("populates authenticated session and injects verified user context into headers", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/polls/123", {
        headers: {
          cookie: `sunshade_sso=${verifiedHumanJWT}`,
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(200);

      // Verify injected headers (NextResponse carries request headers passed to downstream)
      // Read user context helper from header simulation
      const userContext = getUserContextFromHeaders({
        get: (name: string) => req.headers.get(name),
      });

      // Since updateSession modifies headers in the internal request clone, test directly on req:
      expect(req.headers.get("x-user-id")).toBe("user-human-verified-1234");
      expect(req.headers.get("x-is-human-verified")).toBe("true");
      expect(req.headers.get("x-verification-tier")).toBe("ANCHOR");
      expect(req.headers.get("x-trust-state")).toBe("active");
    });

    it("rejects unauthenticated voting requests with 401 for API / Action requests", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/vote", {
        method: "POST",
        headers: {
          "next-action": "action_submit_vote",
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/authentication required/i);
    });

    it("redirects unauthenticated browser navigation on voting routes to auth.sunshade.icu/login", async () => {
      const targetUrl = "https://valerie.sunshade.icu/vote";
      const req = new NextRequest(targetUrl, {
        method: "GET",
      });

      const res = await updateSession(req);
      expect(res.status).toBe(307); // NextResponse.redirect default
      const location = res.headers.get("location");
      expect(location).toContain("auth.sunshade.icu/login");
      expect(location).toContain(encodeURIComponent(targetUrl));
    });

    it("rejects unverified bot accounts attempting to vote with 403 for API / Action requests", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/vote", {
        method: "POST",
        headers: {
          cookie: `sunshade_sso=${unverifiedBotJWT}`,
          "next-action": "action_submit_vote",
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/single-human anti-sybil verification required/i);
    });

    it("redirects unverified accounts on browser navigation to auth.sunshade.icu/verify", async () => {
      const targetUrl = "https://valerie.sunshade.icu/vote";
      const req = new NextRequest(targetUrl, {
        method: "GET",
        headers: {
          cookie: `sunshade_sso=${unverifiedBotJWT}`,
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("auth.sunshade.icu/verify");
      expect(location).toContain(encodeURIComponent(targetUrl));
    });

    it("rejects slashed accounts even if tier is anchor", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/vote", {
        method: "POST",
        headers: {
          cookie: `sunshade_sso=${slashedUserJWT}`,
          "next-action": "action_submit_vote",
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(403);
    });

    it("allows public routes without authentication", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/", {
        method: "GET",
      });

      const res = await updateSession(req);
      expect(res.status).toBe(200);
    });
  });
});
