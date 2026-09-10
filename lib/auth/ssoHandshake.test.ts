import { describe, it, expect } from "vitest";
import {
  extractSSOToken,
  getCrossDomainCookieOptions,
  extractAntiSybilProof,
  verifySSOToken,
  validateSSOHandshake,
} from "./ssoHandshake";

describe("Cross-Domain SSO & Cookie Parsing (lib/auth/ssoHandshake.ts)", () => {
  // Helper to generate a dummy unsigned or mock signed JWT for testing
  function createTestJWT(
    payload: Record<string, unknown>,
    header = { alg: "HS256", typ: "JWT" }
  ): string {
    const encHeader = Buffer.from(JSON.stringify(header))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const encPayload = Buffer.from(JSON.stringify(payload))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const dummySignature = "mock_valid_signature_string";
    return `${encHeader}.${encPayload}.${dummySignature}`;
  }

  describe("getCrossDomainCookieOptions", () => {
    it("configures wildcard domain for .sunshade.icu domains", () => {
      expect(getCrossDomainCookieOptions("sunshade.icu")).toEqual({
        domain: ".sunshade.icu",
        path: "/",
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      });

      expect(getCrossDomainCookieOptions("valerie.sunshade.icu")).toEqual({
        domain: ".sunshade.icu",
        path: "/",
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      });

      expect(getCrossDomainCookieOptions("valerie-stag.sunshade.icu")).toEqual({
        domain: ".sunshade.icu",
        path: "/",
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      });
    });

    it("omits domain for localhost and IP addresses to prevent browser rejection", () => {
      const localOpts = getCrossDomainCookieOptions("localhost:3000");
      expect(localOpts.domain).toBeUndefined();
      expect(localOpts.path).toBe("/");
      expect(localOpts.secure).toBe(true);

      const ipOpts = getCrossDomainCookieOptions("127.0.0.1");
      expect(ipOpts.domain).toBeUndefined();
    });
  });

  describe("extractSSOToken", () => {
    it("extracts token from Bearer header string", () => {
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xyz";
      expect(extractSSOToken(`Bearer ${token}`)).toBe(token);
    });

    it("extracts token from cookie header string", () => {
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xyz";
      const cookieStr = `theme=dark; sunshade_sso=${token}; other=123`;
      expect(extractSSOToken(cookieStr)).toBe(token);
    });

    it("extracts token from request headers object", () => {
      const token = "jwt.sample.token";
      const headers = new Headers({
        authorization: `Bearer ${token}`,
      });
      expect(extractSSOToken({ headers })).toBe(token);
    });

    it("extracts token from cookies store with sunshade_sso cookie", () => {
      const token = "jwt.cookie.token";
      const cookies = {
        get: (name: string) => (name === "sunshade_sso" ? { value: token } : undefined),
      };
      expect(extractSSOToken({ cookies })).toBe(token);
    });

    it("extracts token from Supabase auth chunked cookie store", () => {
      const token = "jwt.supabase.token";
      const cookies = {
        get: () => undefined,
        getAll: () => [
          {
            name: "sb-sunshade-auth-token",
            value: JSON.stringify({ access_token: token }),
          },
        ],
      };
      expect(extractSSOToken({ cookies })).toBe(token);
    });
  });

  describe("extractAntiSybilProof", () => {
    it("extracts verified proof for active human users with explicit is_human flag", () => {
      const payload = {
        sub: "a3b8e910-1234-4567-89ab-cdef01234567",
        app_metadata: {
          is_human: true,
          anti_sybil_verified: true,
          verification_tier: "COMMUNITY_VERIFIED",
          trust_state: "active",
          human_proof: {
            nullifier_hash: "0xdeadbeef12345678",
            provider: "sunshade_zk_passport",
            score: 0.98,
          },
        },
      };

      const proof = extractAntiSybilProof(payload);
      expect(proof.isHuman).toBe(true);
      expect(proof.antiSybilVerified).toBe(true);
      expect(proof.verificationTier).toBe("COMMUNITY_VERIFIED");
      expect(proof.trustState).toBe("active");
      expect(proof.nullifierHash).toBe("0xdeadbeef12345678");
      expect(proof.score).toBe(0.98);
    });

    it("extracts verified proof for ANCHOR verification tier", () => {
      const payload = {
        sub: "user-uuid-1",
        app_metadata: {
          verification_tier: "ANCHOR",
          trust_state: "active",
        },
      };

      const proof = extractAntiSybilProof(payload);
      expect(proof.isHuman).toBe(true);
      expect(proof.antiSybilVerified).toBe(true);
      expect(proof.verificationTier).toBe("ANCHOR");
    });

    it("strictly revokes human verification if trust_state is slashed", () => {
      const payload = {
        sub: "malicious-sybil-user",
        app_metadata: {
          is_human: true,
          anti_sybil_verified: true,
          verification_tier: "ANCHOR",
          trust_state: "slashed",
        },
      };

      const proof = extractAntiSybilProof(payload);
      expect(proof.isHuman).toBe(false);
      expect(proof.antiSybilVerified).toBe(false);
      expect(proof.trustState).toBe("slashed");
    });

    it("strictly revokes human verification if trust_state is quarantined", () => {
      const payload = {
        sub: "quarantined-bot",
        app_metadata: {
          is_human: true,
          trust_state: "quarantined",
        },
      };

      const proof = extractAntiSybilProof(payload);
      expect(proof.isHuman).toBe(false);
      expect(proof.antiSybilVerified).toBe(false);
      expect(proof.trustState).toBe("quarantined");
    });

    it("returns unverified proof for unverified accounts", () => {
      const payload = {
        sub: "regular-user",
        app_metadata: {
          verification_tier: "UNVERIFIED",
          trust_state: "active",
        },
      };

      const proof = extractAntiSybilProof(payload);
      expect(proof.isHuman).toBe(false);
      expect(proof.antiSybilVerified).toBe(false);
      expect(proof.verificationTier).toBe("UNVERIFIED");
    });
  });

  describe("verifySSOToken & validateSSOHandshake", () => {
    it("validates valid SSO token with unified user_id", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = createTestJWT({
        sub: "e0373e7c-86f3-4d4d-a9a3-5c8e3cf3b123",
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

      const res = await validateSSOHandshake(token, { requireAntiSybil: true });
      expect(res.authenticated).toBe(true);
      expect(res.userId).toBe("e0373e7c-86f3-4d4d-a9a3-5c8e3cf3b123");
      expect(res.isHumanVerified).toBe(true);
      expect(res.proof?.isHuman).toBe(true);
    });

    it("rejects expired SSO tokens", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const expiredToken = createTestJWT({
        sub: "user-expired",
        exp: nowSec - 500,
      });

      const res = await verifySSOToken(expiredToken, { clockToleranceSec: 0 });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/expired/i);
    });

    it("rejects tokens not yet active (nbf in future)", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const futureToken = createTestJWT({
        sub: "user-future",
        exp: nowSec + 3600,
        nbf: nowSec + 1000,
      });

      const res = await verifySSOToken(futureToken, { clockToleranceSec: 0 });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/not yet active/i);
    });

    it("rejects handshake when Anti-Sybil verification is required but absent", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = createTestJWT({
        sub: "unverified-bot-account",
        exp: nowSec + 3600,
        app_metadata: {
          verification_tier: "UNVERIFIED",
          trust_state: "active",
        },
      });

      const res = await validateSSOHandshake(token, { requireAntiSybil: true });
      expect(res.authenticated).toBe(true);
      expect(res.isHumanVerified).toBe(false);
      expect(res.error).toMatch(/verification required/i);
    });
  });
});
