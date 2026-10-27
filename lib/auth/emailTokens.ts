/**
 * Project Valerie: 1-Click Ephemeral Email Action Tokens & Auth Bridge
 * File: lib/auth/emailTokens.ts
 * Work Item: [TASK-VAL-AUTH-HMAC-BRIDGE] / [STORY-VAL-EMAIL-NOTIF-INFRA]
 *
 * Provides cryptographic HMAC-SHA256 JWT generation and verification for
 * 1-click email action deep-links into active polls and reveal heatmaps
 * across .sunshade.icu subdomains.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  getCrossDomainCookieOptions,
  extractSSOToken,
  validateSSOHandshake,
} from "@/lib/auth/ssoHandshake";

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface EmailActionTokenPayload {
  sub: string; // Unified user UUID
  pollId?: string | null;
  action?: string; // "vote" | "view" | "reveal" | "digest" | string
  exp: number; // Expiration epoch in seconds
  iat?: number;
  iss?: string;
  [key: string]: unknown;
}

export interface VerifyEmailActionTokenResult {
  valid: boolean;
  payload?: EmailActionTokenPayload;
  error?: string;
}

export interface VerifyActionTokenOptions {
  secret?: string;
  clockToleranceSec?: number;
}

// =============================================================================
// Cryptographic Helpers (Web Crypto API / Node.js compatible)
// =============================================================================

function base64UrlEncode(str: string): string {
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(str, "utf-8").toString("base64")
      : btoa(unescape(encodeURIComponent(str)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  return decodeURIComponent(escape(atob(base64)));
}

function base64UrlDecodeToUint8Array(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getActionTokenSecret(overrideSecret?: string): string {
  const secret =
    overrideSecret ||
    process.env.ACTION_TOKEN_SECRET ||
    process.env.SUPABASE_JWT_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Project Valerie] Missing ACTION_TOKEN_SECRET or SUPABASE_JWT_SECRET in production runtime."
      );
    }
    return "valerie-email-action-token-secret-default";
  }

  return secret;
}

function getSsoSecret(overrideSecret?: string): string {
  const secret =
    overrideSecret ||
    process.env.SUPABASE_JWT_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Project Valerie] Missing SUPABASE_JWT_SECRET in production runtime."
      );
    }
    return "valerie-sso-bridge-secret-default";
  }

  return secret;
}

// =============================================================================
// Token Generation & Verification
// =============================================================================

/**
 * Generates an ephemeral HMAC-SHA256 signed JWT for 1-click email action deep-links.
 *
 * @param userId - Unified user UUID
 * @param pollId - Optional poll ID targeted by this action
 * @param action - Action verb (e.g. "vote", "view", "reveal", "digest")
 * @param ttlMinutes - Time-to-live in minutes (default: 2880 = 48 hours)
 * @param secret - Optional signing secret override
 */
export async function generateEmailActionToken(
  userId: string,
  pollId?: string | null,
  action: string = "view",
  ttlMinutes: number = 2880,
  secret?: string
): Promise<string> {
  if (!userId) {
    throw new Error("userId is required to generate an email action token.");
  }

  const signingSecret = getActionTokenSecret(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.max(1, ttlMinutes) * 60;

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload: EmailActionTokenPayload = {
    sub: userId,
    pollId: pollId || null,
    action: action || "view",
    exp: expSec,
    iat: nowSec,
    iss: "valerie.sunshade.icu",
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(dataToSign)
  );
  const signatureB64 = base64UrlEncodeBytes(new Uint8Array(signatureBuffer));

  return `${dataToSign}.${signatureB64}`;
}

/**
 * Validates HMAC signature and expiration on an incoming email action token.
 * Rejects cleanly on tampered or expired tokens without throwing.
 */
export async function verifyEmailActionToken(
  token: string,
  options: VerifyActionTokenOptions = {}
): Promise<VerifyEmailActionTokenResult> {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Missing or invalid token string." };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Malformed JWT: expected 3 dot-separated parts." };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode payload
  let payload: EmailActionTokenPayload;
  try {
    const rawJson = base64UrlDecode(payloadB64);
    payload = JSON.parse(rawJson) as EmailActionTokenPayload;
  } catch {
    return { valid: false, error: "Failed to decode JWT payload JSON." };
  }

  if (!payload || !payload.sub) {
    return { valid: false, error: "Payload missing required sub (user ID) claim." };
  }

  // 2. Strict expiration check (never allow expiration-free action tokens)
  if (typeof payload.exp !== "number" || isNaN(payload.exp)) {
    return { valid: false, error: "Action token missing required exp expiration claim." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSec ?? 60;
  if (payload.exp + tolerance < nowSec) {
    return { valid: false, error: "Action token has expired." };
  }

  // 3. Cryptographic HMAC-SHA256 signature verification
  const signingSecret = getActionTokenSecret(options.secret);
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const dataToVerify = enc.encode(`${headerB64}.${payloadB64}`);
    const rawSignature = base64UrlDecodeToUint8Array(signatureB64);

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      rawSignature as unknown as BufferSource,
      dataToVerify as unknown as BufferSource
    );

    if (!isValid) {
      return { valid: false, error: "Invalid HMAC-SHA256 signature on action token." };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Signature verification exception: ${msg}` };
  }

  return { valid: true, payload };
}

/**
 * Creates a signed SSO JWT claim payload for seeding the .sunshade.icu session cookie.
 */
export async function generateBridgedSSOToken(
  userId: string,
  secret?: string
): Promise<string> {
  const signingSecret = getSsoSecret(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 7 * 24 * 3600; // 7 days

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    aud: "authenticated",
    iss: "https://hub.sunshade.icu",
    exp: expSec,
    iat: nowSec,
    app_metadata: {
      is_human: true,
      anti_sybil_verified: true,
      verification_tier: "COMMUNITY_VERIFIED",
      trust_state: "active",
      human_proof: {
        provider: "email_auth_bridge",
        verifiedAt: new Date().toISOString(),
      },
    },
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
  return `${dataToSign}.${base64UrlEncodeBytes(new Uint8Array(sig))}`;
}

// =============================================================================
// Middleware Interceptor & URL Stripping
// =============================================================================

/**
 * Checks if a pathname represents a poll or digest route subject to action token handling.
 */
export function isActionTokenRoute(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return (
    p.startsWith("/poll/") ||
    p.startsWith("/polls/") ||
    p === "/poll" ||
    p === "/polls" ||
    p.startsWith("/digest/") ||
    p === "/digest"
  );
}

/**
 * Intercepts ?action_token=... on /poll/* and /digest/* routes.
 *
 * If valid and user is unauthenticated:
 *   - Verifies route affinity (prevents poll token reuse on unrelated routes)
 *   - Seeds a signed session cookie across .sunshade.icu
 *   - Strips action_token from URL via HTTP redirect
 *
 * If invalid or expired:
 *   - Strips action_token cleanly without crashing session
 *
 * Returns NextResponse redirect if action_token is present; null otherwise.
 */
export async function handleEmailActionTokenMiddleware(
  request: NextRequest,
  options?: { secret?: string }
): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (!isActionTokenRoute(pathname)) {
    return null;
  }

  const actionToken = request.nextUrl.searchParams.get("action_token");
  if (!actionToken) {
    return null;
  }

  // Construct clean URL with action_token stripped to prevent history leakage
  const cleanUrl = new URL(request.url);
  cleanUrl.searchParams.delete("action_token");

  const verification = await verifyEmailActionToken(actionToken, {
    secret: options?.secret,
  });

  const response = NextResponse.redirect(cleanUrl);

  // If token is invalid or expired, reject cleanly by simply redirecting to clean URL
  if (!verification.valid || !verification.payload) {
    return response;
  }

  // Route affinity check: if token binds to a specific pollId and request is to /poll(s)/<id>,
  // ensure target pollId matches to prevent token reuse on unrelated polls.
  if (verification.payload.pollId) {
    const pollMatch = pathname.match(/^\/polls?\/([^/]+)/i);
    if (pollMatch && pollMatch[1] && pollMatch[1] !== verification.payload.pollId) {
      // Mismatched poll target; do not authenticate
      return response;
    }
  }

  // If valid, check if caller already has an active, valid session cookie
  const existingToken = extractSSOToken(request);
  let hasValidSession = false;
  if (existingToken) {
    const handshake = await validateSSOHandshake(existingToken, {
      secret: getSsoSecret(options?.secret),
    });
    hasValidSession = handshake.authenticated && Boolean(handshake.userId);
  }

  if (!hasValidSession) {
    // Seed cross-domain session cookie
    const ssoToken = await generateBridgedSSOToken(
      verification.payload.sub,
      options?.secret
    );
    const cookieOpts = getCrossDomainCookieOptions(request.nextUrl.hostname);

    response.cookies.set("sunshade_sso_token", ssoToken, {
      ...cookieOpts,
      maxAge: 7 * 24 * 3600,
    });
    response.cookies.set("sunshade_sso", ssoToken, {
      ...cookieOpts,
      maxAge: 7 * 24 * 3600,
    });
  }

  return response;
}
