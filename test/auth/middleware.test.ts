import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockCreateServerClientOverride } = vi.hoisted(() => ({
  mockCreateServerClientOverride: { fn: null as null | ((...args: any[]) => any) },
}));

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: (...args: any[]) =>
      mockCreateServerClientOverride.fn
        ? mockCreateServerClientOverride.fn(...args)
        : actual.createServerClient(...(args as [string, string, any])),
  };
});

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
    aud: "authenticated",
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
    aud: "authenticated",
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
    aud: "authenticated",
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

    it("redirects unauthenticated browser navigation on voting routes to hub.sunshade.icu/login", async () => {
      const targetUrl = "https://valerie.sunshade.icu/vote";
      const req = new NextRequest(targetUrl, {
        method: "GET",
      });

      const res = await updateSession(req);
      expect(res.status).toBe(307); // NextResponse.redirect default
      const location = res.headers.get("location");
      expect(location).toContain("hub.sunshade.icu/login");
      expect(location).toContain(`redirect=${encodeURIComponent(targetUrl)}`);
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

    it("redirects unverified accounts on browser navigation to hub.sunshade.icu/login?redirect=...&verify=true", async () => {
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
      expect(location).toContain("hub.sunshade.icu/login");
      expect(location).toContain(`redirect=${encodeURIComponent(targetUrl)}`);
      expect(location).toContain("verify=true");
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

    it("strips client-supplied spoofed headers on unauthenticated requests", async () => {
      const req = new NextRequest("https://valerie.sunshade.icu/", {
        headers: {
          "x-user-id": "attacker-spoofed-id",
          "x-is-human-verified": "true",
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(200);
      expect(req.headers.get("x-user-id")).toBeNull();
      expect(req.headers.get("x-is-human-verified")).toBeNull();
    });

    it("rejects tokens with untrusted issuer during SSO fallback", async () => {
      const untrustedIssuerJWT = createMockJWT({
        sub: "user-attacker-123",
        exp: nowSec + 3600,
        nbf: nowSec - 60,
        iss: "https://evil-phishing.com",
        aud: "authenticated",
        app_metadata: {
          is_human: true,
          anti_sybil_verified: true,
          verification_tier: "ANCHOR",
          trust_state: "active",
        },
      });

      const req = new NextRequest("https://valerie.sunshade.icu/vote", {
        method: "POST",
        headers: {
          cookie: `sunshade_sso=${untrustedIssuerJWT}`,
          "next-action": "action_submit_vote",
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(401);
    });

    it("rejects tokens with untrusted audience during SSO fallback", async () => {
      const untrustedAudienceJWT = createMockJWT({
        sub: "user-attacker-456",
        exp: nowSec + 3600,
        nbf: nowSec - 60,
        iss: "https://hub.sunshade.icu",
        aud: "malicious-third-party-app",
        app_metadata: {
          is_human: true,
          anti_sybil_verified: true,
          verification_tier: "ANCHOR",
          trust_state: "active",
        },
      });

      const req = new NextRequest("https://valerie.sunshade.icu/vote", {
        method: "POST",
        headers: {
          cookie: `sunshade_sso=${untrustedAudienceJWT}`,
          "next-action": "action_submit_vote",
        },
      });

      const res = await updateSession(req);
      expect(res.status).toBe(401);
    });

    it("permits Server Action POST to /polls/[id] when RPC verifies an unverified-claim session", async () => {
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const rpcSpy = vi.fn(async () => ({ data: true, error: null }));
      mockCreateServerClientOverride.fn = () => ({
        auth: {
          getUser: vi.fn(async () => ({
            data: {
              user: {
                id: "user-rpc-verified-1",
                app_metadata: { is_human: false, verification_tier: "UNVERIFIED", trust_state: "active" },
                user_metadata: {},
              },
            },
            error: null,
          })),
        },
        schema: vi.fn(() => ({ rpc: rpcSpy })),
      });

      try {
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

        const req = new NextRequest("https://valerie.sunshade.icu/polls/poll-123", {
          method: "POST",
          headers: {
            cookie: `sunshade_sso=${unverifiedBotJWT}`,
            "next-action": "action_submit_vote",
          },
        });

        const res = await updateSession(req);
        expect(res.status).toBe(200);
        expect(rpcSpy).toHaveBeenCalledWith("is_human_verified", {
          p_user_id: "user-rpc-verified-1",
        });
        expect(req.headers.get("x-is-human-verified")).toBe("true");
      } finally {
        mockCreateServerClientOverride.fn = null;
        process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
      }
    });
  });
});
