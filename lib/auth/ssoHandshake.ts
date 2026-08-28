/**
 * Project Valerie: Cross-Domain SSO & Anti-Sybil Human Verification Handshake
 * File: lib/auth/ssoHandshake.ts
 *
 * Provides cryptographic SSO token validation, unified user_id extraction,
 * and Anti-Sybil single-human verification proof parsing across .sunshade.icu
 * staging and production domains.
 */

// =============================================================================
// Types & Interfaces
// =============================================================================

export type VerificationTier =
  | "UNVERIFIED"
  | "COMMUNITY_VERIFIED"
  | "ANCHOR"
  | "BIOMETRIC"
  | "GOVERNMENT_ID"
  | "VERIFIED"
  | string;

export type TrustState = "active" | "quarantined" | "slashed";

export interface HumanProofDetails {
  nullifierHash?: string;
  provider?: string;
  verifiedAt?: string;
  score?: number;
  verificationLevel?: string;
  [key: string]: unknown;
}

export interface AntiSybilProof {
  isHuman: boolean;
  antiSybilVerified: boolean;
  verificationTier: VerificationTier;
  trustState: TrustState;
  nullifierHash?: string;
  provider?: string;
  verifiedAt?: string;
  score?: number;
  rawProof?: Record<string, unknown>;
}

export interface SSOTokenPayload {
  sub?: string;
  id?: string;
  user_id?: string;
  email?: string;
  role?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  app_metadata?: {
    is_human?: boolean;
    anti_sybil_verified?: boolean;
    verification_tier?: VerificationTier;
    trust_state?: TrustState;
    human_proof?: HumanProofDetails;
    [key: string]: unknown;
  };
  user_metadata?: {
    is_human?: boolean;
    anti_sybil_verified?: boolean;
    [key: string]: unknown;
  };
  is_human?: boolean;
  anti_sybil_verified?: boolean;
  verification_tier?: VerificationTier;
  trust_state?: TrustState;
  human_proof?: HumanProofDetails;
  [key: string]: unknown;
}

export interface SSOVerificationResult {
  valid: boolean;
  payload?: SSOTokenPayload;
  error?: string;
}

export interface SSOHandshakeResult {
  authenticated: boolean;
  userId: string | null;
  proof: AntiSybilProof | null;
  isHumanVerified: boolean;
  token: string | null;
  error?: string;
}

export interface CrossDomainCookieOptions {
  domain?: string;
  path: string;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  httpOnly: boolean;
  maxAge?: number;
}

// =============================================================================
// Cookie & Domain Utilities
// =============================================================================

export const SUNSHADE_COOKIE_NAMES = [
  "sunshade_sso",
  "sunshade_sso_token",
  "sb-access-token",
  "sunshade_auth_proof",
  "sunshade_session",
] as const;

/**
 * Derives cookie options for cross-subdomain authentication across .sunshade.icu.
 */
export function getCrossDomainCookieOptions(hostname?: string): CrossDomainCookieOptions {
  const host = (hostname || "").toLowerCase().trim().split(":")[0];
  const isSunShadeDomain = host === "sunshade.icu" || host.endsWith(".sunshade.icu");

  return {
    path: "/",
    sameSite: "lax",
    secure: true,
    httpOnly: true,
    ...(isSunShadeDomain ? { domain: ".sunshade.icu" } : {}),
  };
}

/**
 * Extracts raw SSO token or Supabase auth token from headers, cookies, or request objects.
 */
export function extractSSOToken(input: unknown): string | null {
  if (!input) return null;

  // 1. Direct string token or cookie string
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("Bearer ")) {
      return trimmed.slice(7).trim();
    }
    // Parse cookie string (e.g. "theme=dark; sunshade_sso=xyz; other=123")
    if (trimmed.includes("=") || trimmed.includes(";")) {
      const match = trimmed.match(/(?:sunshade_sso|sunshade_sso_token|sb-access-token)=([^;]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1].trim());
      }
    }
    // Pure JWT check (header.payload.signature format without spaces or semicolons)
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
      return trimmed;
    }
  }

  const record = input as Record<string, unknown>;

  // 2. Request / Headers object with Authorization header
  if (record.headers && typeof record.headers === "object") {
    const headers = record.headers as {
      get?: (name: string) => string | null;
      authorization?: string;
      Authorization?: string;
    };
    const authHeader =
      typeof headers.get === "function"
        ? headers.get("authorization") || headers.get("Authorization")
        : headers.authorization || headers.Authorization;

    if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }
  }

  // 3. Cookies map / Cookies store / NextRequest cookies
  if (record.cookies && typeof record.cookies === "object") {
    const cookies = record.cookies as {
      get?: (name: string) => { value?: string } | undefined;
      getAll?: () => Array<{ name: string; value: string }>;
    };
    if (typeof cookies.get === "function") {
      for (const name of SUNSHADE_COOKIE_NAMES) {
        const c = cookies.get(name);
        if (c && c.value) return c.value;
      }
    }

    if (typeof cookies.getAll === "function") {
      const all = cookies.getAll();
      for (const c of all) {
        if (c.name.startsWith("sb-") && c.name.endsWith("-auth-token")) {
          try {
            const parsed = JSON.parse(c.value);
            if (Array.isArray(parsed) && parsed[0]) return parsed[0];
            if (parsed.access_token) return parsed.access_token;
          } catch {
            return c.value;
          }
        }
      }
    }
  }

  return null;
}

// =============================================================================
// Base64Url & JWT Helper Functions
// =============================================================================

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  if (typeof atob === "function") {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(base64), (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}

export function decodeJWT(token: string): SSOTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payloadJson = base64UrlDecode(parts[1]);
    return JSON.parse(payloadJson) as SSOTokenPayload;
  } catch {
    return null;
  }
}

// =============================================================================
// Anti-Sybil Proof Extraction
// =============================================================================

const TRUSTED_VERIFIED_TIERS = new Set<string>([
  "COMMUNITY_VERIFIED",
  "ANCHOR",
  "BIOMETRIC",
  "GOVERNMENT_ID",
  "VERIFIED",
]);

/**
 * Extracts unified Anti-Sybil human verification proof flags from a user record or JWT payload.
 * Enforces security constraints: slashed or quarantined trust states strictly negate human status.
 */
export function extractAntiSybilProof(userOrPayload: unknown): AntiSybilProof {
  if (!userOrPayload || typeof userOrPayload !== "object") {
    return {
      isHuman: false,
      antiSybilVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "quarantined",
    };
  }

  const record = userOrPayload as Record<string, unknown>;
  const appMeta = (record.app_metadata as Record<string, unknown>) || {};
  const userMeta = (record.user_metadata as Record<string, unknown>) || {};

  // Extract trust state
  const rawTrustState = String(
    appMeta.trust_state ||
    record.trust_state ||
    userMeta.trust_state ||
    "active"
  ).toLowerCase() as TrustState;

  const trustState: TrustState = ["active", "quarantined", "slashed"].includes(rawTrustState)
    ? rawTrustState
    : "active";

  // Extract verification tier
  const verificationTier: VerificationTier = (
    appMeta.verification_tier ||
    record.verification_tier ||
    userMeta.verification_tier ||
    "UNVERIFIED"
  ) as VerificationTier;

  // Extract explicit human flags
  const isHumanFlag = Boolean(
    appMeta.is_human === true ||
      record.is_human === true ||
      userMeta.is_human === true ||
      TRUSTED_VERIFIED_TIERS.has(String(verificationTier).toUpperCase())
  );

  const isAntiSybilFlag = Boolean(
    appMeta.anti_sybil_verified === true ||
      record.anti_sybil_verified === true ||
      userMeta.anti_sybil_verified === true ||
      TRUSTED_VERIFIED_TIERS.has(String(verificationTier).toUpperCase())
  );

  // Extract human proof metadata (nullifier hash, provider, timestamp, score)
  const humanProof = (
    appMeta.human_proof ||
    record.human_proof ||
    userMeta.human_proof ||
    undefined
  ) as HumanProofDetails | undefined;

  const nullifierHash: string | undefined =
    (typeof humanProof?.nullifierHash === "string" ? humanProof.nullifierHash : undefined) ??
    (typeof humanProof?.nullifier_hash === "string" ? humanProof.nullifier_hash : undefined) ??
    (typeof appMeta.nullifier_hash === "string" ? appMeta.nullifier_hash : undefined) ??
    (typeof record.nullifier_hash === "string" ? record.nullifier_hash : undefined);

  const provider: string | undefined =
    (typeof humanProof?.provider === "string" ? humanProof.provider : undefined) ??
    (typeof appMeta.proof_provider === "string" ? appMeta.proof_provider : undefined) ??
    (typeof record.proof_provider === "string" ? record.proof_provider : undefined);

  const verifiedAt: string | undefined =
    (typeof humanProof?.verifiedAt === "string" ? humanProof.verifiedAt : undefined) ??
    (typeof humanProof?.verified_at === "string" ? humanProof.verified_at : undefined) ??
    (typeof appMeta.verified_at === "string" ? appMeta.verified_at : undefined);

  const score: number | undefined =
    typeof humanProof?.score === "number"
      ? humanProof.score
      : typeof appMeta.trust_score === "number"
      ? (appMeta.trust_score as number)
      : undefined;

  // HARD GATE: If trust state is slashed or quarantined, anti-sybil verification is rejected
  if (trustState === "slashed" || trustState === "quarantined") {
    return {
      isHuman: false,
      antiSybilVerified: false,
      verificationTier,
      trustState,
      nullifierHash,
      provider,
      verifiedAt,
      score,
      rawProof: humanProof as Record<string, unknown>,
    };
  }

  const isVerified = isHumanFlag || isAntiSybilFlag;

  return {
    isHuman: isVerified,
    antiSybilVerified: isVerified,
    verificationTier,
    trustState,
    nullifierHash,
    provider,
    verifiedAt,
    score,
    rawProof: humanProof as Record<string, unknown>,
  };
}

// =============================================================================
// Cryptographic SSO Token Verification
// =============================================================================

export interface VerifySSOTokenOptions {
  secret?: string;
  expectedIssuer?: string;
  expectedAudience?: string;
  clockToleranceSec?: number;
}

/**
 * Validates token signature (when secret is provided), expiry, and issuance.
 */
export async function verifySSOToken(
  token: string,
  options: VerifySSOTokenOptions = {}
): Promise<SSOVerificationResult> {
  if (!token) {
    return { valid: false, error: "Missing SSO token." };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Malformed JWT: expected 3 parts." };
  }

  const payload = decodeJWT(token);
  if (!payload) {
    return { valid: false, error: "Failed to decode JWT payload." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSec ?? 60;

  // 1. Expiration check
  if (typeof payload.exp === "number") {
    if (payload.exp + tolerance < nowSec) {
      return { valid: false, error: "SSO token has expired." };
    }
  }

  // 2. Not before check
  if (typeof payload.nbf === "number") {
    if (payload.nbf - tolerance > nowSec) {
      return { valid: false, error: "SSO token is not yet active." };
    }
  }

  // 3. Issuer check if specified
  if (options.expectedIssuer && payload.iss) {
    const validIss =
      payload.iss === options.expectedIssuer ||
      payload.iss.includes("sunshade.icu") ||
      payload.iss === "supabase";

    if (!validIss) {
      return { valid: false, error: `Invalid issuer: expected ${options.expectedIssuer}` };
    }
  }

  // 4. Audience check if specified
  if (options.expectedAudience && payload.aud) {
    if (payload.aud !== options.expectedAudience && payload.aud !== "authenticated") {
      return { valid: false, error: `Invalid audience: expected ${options.expectedAudience}` };
    }
  }

  // 5. Signature validation via Web Crypto API (if secret provided)
  const secret = options.secret || process.env.SUPABASE_JWT_SECRET;
  if (secret && typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );

      const dataToVerify = enc.encode(`${parts[0]}.${parts[1]}`);
      const rawSignature = base64UrlDecodeToUint8Array(parts[2]);

      const isValidSignature = await crypto.subtle.verify(
        "HMAC",
        key,
        rawSignature as unknown as BufferSource,
        dataToVerify as unknown as BufferSource
      );

      if (!isValidSignature) {
        return { valid: false, error: "Invalid cryptographic signature on SSO token." };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { valid: false, error: `Signature verification failed: ${msg}` };
    }
  }

  return { valid: true, payload };
}

function base64UrlDecodeToUint8Array(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// =============================================================================
// Main Handshake Verification Entry Point
// =============================================================================

export interface ValidateSSOHandshakeOptions {
  requireAntiSybil?: boolean;
  secret?: string;
  expectedIssuer?: string;
}

/**
 * Validates incoming SSO handshake from request, cookies, or token string.
 * Resolves unified user_id and anti-sybil human proof status.
 */
export async function validateSSOHandshake(
  input: unknown,
  options: ValidateSSOHandshakeOptions = {}
): Promise<SSOHandshakeResult> {
  const token = extractSSOToken(input);

  if (!token) {
    return {
      authenticated: false,
      userId: null,
      proof: null,
      isHumanVerified: false,
      token: null,
      error: "No SSO token or session cookie present.",
    };
  }

  const verification = await verifySSOToken(token, {
    secret: options.secret,
    expectedIssuer: options.expectedIssuer,
  });

  if (!verification.valid || !verification.payload) {
    return {
      authenticated: false,
      userId: null,
      proof: null,
      isHumanVerified: false,
      token,
      error: verification.error || "Token verification failed.",
    };
  }

  const payload = verification.payload;
  const userId = payload.sub || payload.id || payload.user_id || null;

  if (!userId) {
    return {
      authenticated: false,
      userId: null,
      proof: null,
      isHumanVerified: false,
      token,
      error: "Token missing unified user_id subject claim.",
    };
  }

  const proof = extractAntiSybilProof(payload);
  const isHumanVerified = proof.isHuman && proof.trustState === "active";

  if (options.requireAntiSybil && !isHumanVerified) {
    return {
      authenticated: true,
      userId,
      proof,
      isHumanVerified: false,
      token,
      error: "User has not verified single-human identity (verification required).",
    };
  }

  return {
    authenticated: true,
    userId,
    proof,
    isHumanVerified,
    token,
  };
}
