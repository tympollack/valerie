/**
 * Project Valerie: Cross-Domain Hub Authentication Callback Utilities
 * File: lib/auth/callback.ts
 *
 * Implements token parsing from URL hash fragments and query strings,
 * Anti-Sybil human verification validation, and cross-domain cookie hydration
 * for votary.app.
 */

import {
  decodeJWT,
  extractAntiSybilProof,
  getCrossDomainCookieOptions,
  type SSOTokenPayload,
  type VerificationTier,
  type TrustState,
} from "@/lib/auth/ssoHandshake"

export interface ParsedCallbackTokens {
  accessToken: string | null
  refreshToken: string | null
  code: string | null
  returnTo: string
  error: string | null
  errorDescription: string | null
}

export interface AntiSybilVerification {
  isHumanVerified: boolean
  verificationTier: VerificationTier
  trustState: TrustState
  userId: string | null
}

export interface ProcessCallbackParams {
  hash: string
  search: string
  hostname: string
  exchangeCode?: (code: string) => Promise<{ access_token: string; refresh_token?: string } | null>
  setSession?: (session: { access_token: string; refresh_token?: string }) => Promise<void>
  persistServerSession?: (
    accessToken: string,
    refreshToken?: string | null
  ) => Promise<{ success: boolean; error?: string } | void>
}

export interface ProcessCallbackResult {
  success: boolean
  destination?: string
  error?: string
}

/**
 * Safely sanitizes the return_to target URL to prevent open redirect vulnerabilities.
 * Enforces local relative paths starting with / (excluding protocol-relative //)
 * or safe absolute URLs strictly matching votary.app / sunshade.icu apex domains.
 */
export function sanitizeReturnTo(target: string | null | undefined): string {
  if (!target || typeof target !== "string") {
    return "/deliberation"
  }

  // Reject immediately if target contains backslashes or protocol-relative slashes
  if (target.includes("\\") || target.trim().startsWith("//")) {
    return "/deliberation"
  }

  // Strip control characters and whitespace
  const cleaned = target.replace(/[\x00-\x1F\x7F\s]+/g, "").trim()
  if (cleaned.includes("\\") || cleaned.startsWith("//")) {
    return "/deliberation"
  }

  try {
    const parsed = new URL(cleaned, "https://votary.app")
    // Only allow origins belonging to votary.app, localhost, or .sunshade.icu
    const isAllowedHost =
      parsed.origin === "https://votary.app" ||
      parsed.hostname === "votary.app" ||
      parsed.hostname.endsWith(".votary.app") ||
      parsed.hostname === "localhost" ||
      parsed.hostname.endsWith(".sunshade.icu")

    if (!isAllowedHost) {
      return "/deliberation"
    }

    const safePath = parsed.pathname + parsed.search + parsed.hash
    if (!safePath.startsWith("/") || safePath.startsWith("//") || safePath.includes("\\")) {
      return "/deliberation"
    }
    return safePath
  } catch {
    return "/deliberation"
  }
}

/**
 * Parses authentication tokens, PKCE codes, and return destinations from
 * URL hash fragments, query strings, or full URL representations.
 * Tokens are strictly accepted from URL hash fragments only (#access_token=...)
 * to adhere to RFC 6749 and prevent credential retention in query strings/logs.
 */
export function parseCallbackTokens(
  hashOrUrl: string = "",
  searchParamsString: string = ""
): ParsedCallbackTokens {
  let hashStr = hashOrUrl || ""
  let searchStr = searchParamsString || ""

  // If a full URL is passed into hashOrUrl, parse both search and hash components
  if (hashStr.includes("?") || hashStr.includes("#") || hashStr.startsWith("http://") || hashStr.startsWith("https://")) {
    try {
      const parsedUrl = new URL(hashStr, "https://votary.app")
      if (!searchStr && parsedUrl.search) {
        searchStr = parsedUrl.search
      }
      if (parsedUrl.hash) {
        hashStr = parsedUrl.hash
      }
    } catch {
      // Fall through to regex extraction if URL constructor fails on raw strings
    }
  }

  // Strip leading '#' and '?' characters
  const cleanHash = hashStr.startsWith("#") ? hashStr.slice(1) : hashStr
  const cleanSearch = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr

  const hashParams = new URLSearchParams(cleanHash)
  const queryParams = new URLSearchParams(cleanSearch)

  // Security standard: Tokens are extracted exclusively from URL hash fragments (#access_token=...)
  // to prevent exposing credentials in server logs, HTTP referrers, and browser query history.
  // Query parameters are reserved for authorization code exchange (?code=...), errors, and return_to.
  const accessToken = hashParams.get("access_token") || null
  const refreshToken = hashParams.get("refresh_token") || null
  const code = queryParams.get("code") || hashParams.get("code") || null

  // Target redirect destination
  const rawReturnTo =
    hashParams.get("return_to") ||
    hashParams.get("redirect") ||
    hashParams.get("state") ||
    queryParams.get("return_to") ||
    queryParams.get("redirect") ||
    queryParams.get("state") ||
    "/deliberation"

  const returnTo = sanitizeReturnTo(rawReturnTo)

  // Error handling
  const error =
    hashParams.get("error") || queryParams.get("error") || null
  const errorDescription =
    hashParams.get("error_description") ||
    queryParams.get("error_description") ||
    null

  return {
    accessToken,
    refreshToken,
    code,
    returnTo,
    error,
    errorDescription,
  }
}

/**
 * Validates the Anti-Sybil claim 'is_human_verified' on the decoded JWT user metadata,
 * app_metadata, and verification tier rules.
 */
export function verifyAntiSybilClaim(
  tokenOrPayload: string | SSOTokenPayload | null | undefined
): AntiSybilVerification {
  if (!tokenOrPayload) {
    return {
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "quarantined",
      userId: null,
    }
  }

  const payload =
    typeof tokenOrPayload === "string"
      ? decodeJWT(tokenOrPayload)
      : tokenOrPayload

  if (!payload) {
    return {
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "quarantined",
      userId: null,
    }
  }

  const proof = extractAntiSybilProof(payload)
  // Hard gate: Slashed or quarantined trust states strictly negate human verification
  const isHumanVerified = Boolean(proof.isHuman && proof.trustState === "active")

  const userId = payload.sub || payload.id || payload.user_id || null

  return {
    isHumanVerified,
    verificationTier: proof.verificationTier,
    trustState: proof.trustState,
    userId,
  }
}

/**
 * Builds client-side cookie assignment strings for the votary.app apex domain.
 * Note: Sensitive bearer and refresh credentials are kept in HttpOnly server cookies.
 * Client cookies only carry non-sensitive session presence indicators.
 */
export function getClientCookieStrings(
  _accessToken?: string | null,
  _refreshToken?: string | null,
  hostname: string = "votary.app"
): string[] {
  const cookieOpts = getCrossDomainCookieOptions(hostname)
  const isHttps = typeof window !== "undefined" ? window.location.protocol === "https:" : true

  const domainPart = cookieOpts.domain ? `; domain=${cookieOpts.domain}` : ""
  const securePart = isHttps ? "; Secure" : ""
  const maxAgePart = "; max-age=604800" // 7 days
  const sameSitePart = "; SameSite=Lax; path=/"

  return [
    `votary_session_active=true${domainPart}${sameSitePart}${maxAgePart}${securePart}`,
  ]
}

/**
 * Orchestrates full cross-domain session hydration pipeline.
 */
export async function processCallbackAuthentication({
  hash,
  search,
  hostname,
  exchangeCode,
  setSession,
  persistServerSession,
}: ProcessCallbackParams): Promise<ProcessCallbackResult> {
  const tokens = parseCallbackTokens(hash, search)

  if (tokens.error) {
    return { success: false, error: tokens.errorDescription || tokens.error }
  }

  let activeAccessToken = tokens.accessToken
  let activeRefreshToken = tokens.refreshToken

  if (!activeAccessToken && tokens.code && exchangeCode) {
    try {
      const res = await exchangeCode(tokens.code)
      if (!res?.access_token) {
        return { success: false, error: "Failed to exchange authorization code for session" }
      }
      activeAccessToken = res.access_token
      activeRefreshToken = res.refresh_token || null
    } catch (err: any) {
      return { success: false, error: err?.message || "Code exchange failure" }
    }
  }

  if (!activeAccessToken) {
    return { success: false, error: "No authentication tokens found in callback parameters." }
  }

  verifyAntiSybilClaim(activeAccessToken)

  if (setSession) {
    try {
      await setSession({
        access_token: activeAccessToken,
        refresh_token: activeRefreshToken || undefined,
      })
    } catch {
      // Non-blocking client fallback
    }
  }

  try {
    const cookieStrings = getClientCookieStrings(activeAccessToken, activeRefreshToken, hostname)
    if (typeof document !== "undefined") {
      cookieStrings.forEach((c) => {
        document.cookie = c
      })
    }
  } catch {
    // Browser environment safety guard
  }

  if (persistServerSession) {
    try {
      const serverRes = await persistServerSession(activeAccessToken, activeRefreshToken)
      if (serverRes && typeof serverRes === "object" && !serverRes.success) {
        return {
          success: false,
          error: serverRes.error || "Server session hydration failed",
        }
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Failed to persist server session",
      }
    }
  }

  return { success: true, destination: tokens.returnTo || "/deliberation" }
}
