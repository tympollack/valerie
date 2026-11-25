"use server"

import { createClient } from "@/lib/supabase/server"
import {
  decodeJWT,
  extractAntiSybilProof,
  extractSSOToken,
  SUNSHADE_COOKIE_NAMES,
  getCrossDomainCookieOptions,
  type VerificationTier,
  type TrustState,
} from "@/lib/auth/ssoHandshake"
import { cookies, headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { cache } from "react"

export interface UserContext {
  authenticated: boolean
  userId: string | null
  email: string | null
  displayName: string | null
  isHumanVerified: boolean
  verificationTier: VerificationTier
  trustState: TrustState
  nullifierHash?: string
  provider?: string
  score?: number
}

/**
 * Per-request memoized user session and Anti-Sybil verification resolver.
 * Deduplicates calls shared between RootLayout and page Server Components within one render pass.
 */
const resolveCurrentUserContext = cache(async (): Promise<UserContext> => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const cookieStore = await cookies()
      const ssoToken = extractSSOToken(cookieStore)
      let supabase = await createClient()
      let resolvedUser = null

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser()

      if (!userErr && user) {
        resolvedUser = user
      } else if (ssoToken) {
        const ssoClient = await createClient(ssoToken)
        const {
          data: ssoData,
          error: ssoErr,
        } = await ssoClient.auth.getUser(ssoToken)
        if (!ssoErr && ssoData?.user) {
          resolvedUser = ssoData.user
          supabase = ssoClient
        }
      }

      if (resolvedUser) {
        const proof = extractAntiSybilProof(resolvedUser)
        let isHumanVerified = proof.isHuman && proof.trustState === "active"

        // Authoritative Hub profile verification RPC check
        try {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc(
            "is_human_verified",
            { p_user_id: resolvedUser.id }
          )
          if (!rpcErr && typeof rpcRes === "boolean") {
            isHumanVerified = rpcRes && proof.trustState === "active"
          }
        } catch {
          // Non-blocking fallback to extracted proof
        }

        const email = resolvedUser.email || null
        const displayName =
          (resolvedUser.user_metadata?.full_name as string) ||
          (resolvedUser.user_metadata?.name as string) ||
          (resolvedUser.user_metadata?.display_name as string) ||
          (email ? email.split("@")[0] : null)

        return {
          authenticated: true,
          userId: resolvedUser.id,
          email,
          displayName,
          isHumanVerified,
          verificationTier: proof.verificationTier,
          trustState: proof.trustState,
          nullifierHash: proof.nullifierHash,
          provider: proof.provider,
          score: proof.score,
        }
      }
    } catch {
      // Fallback to headers or unauthenticated context
    }
  }

  // Fallback: check headers injected by middleware
  try {
    const headerList = await headers()
    const userId = headerList.get("x-user-id")

    if (userId) {
      const isHumanVerified = headerList.get("x-is-human-verified") === "true"
      const verificationTier =
        (headerList.get("x-verification-tier") as VerificationTier) ||
        "UNVERIFIED"
      const trustState =
        (headerList.get("x-trust-state") as TrustState) || "active"

      return {
        authenticated: true,
        userId,
        email: null,
        displayName: null,
        isHumanVerified,
        verificationTier,
        trustState,
      }
    }
  } catch {
    // Non-request context
  }

  return {
    authenticated: false,
    userId: null,
    email: null,
    displayName: null,
    isHumanVerified: false,
    verificationTier: "UNVERIFIED",
    trustState: "active",
  }
})

/**
 * Resolves current user session and Anti-Sybil verification status from Supabase and headers.
 */
export async function getCurrentUserContext(): Promise<UserContext> {
  return resolveCurrentUserContext()
}

/**
 * Signs out of Supabase and clears cross-domain SSO cookies across .sunshade.icu.
 */
export async function signOutAction(): Promise<{ success: boolean }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = await createClient()
      await supabase.auth.signOut()
    } catch {
      // Non-blocking if offline or unconfigured
    }
  }

  const cookieStore = await cookies()
  const headerList = await headers()
  const host = headerList.get("host") || ""
  const cookieDomainOpts = getCrossDomainCookieOptions(host)

  // Clear standard SunShade SSO cookies
  for (const name of SUNSHADE_COOKIE_NAMES) {
    try {
      cookieStore.delete(name)
      cookieStore.set(name, "", {
        ...cookieDomainOpts,
        maxAge: 0,
        expires: new Date(0),
      })
    } catch {
      // Ignore deletion errors
    }
  }

  // Clear Supabase auth cookies
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      const isSbAuth = cookie.name.includes("-auth-token")
      try {
        cookieStore.delete(cookie.name)
        cookieStore.set(cookie.name, "", {
          ...cookieDomainOpts,
          ...(isSbAuth ? { httpOnly: false } : {}),
          maxAge: 0,
          expires: new Date(0),
        })
      } catch {
        // Ignore deletion errors
      }
    }
  }

  revalidatePath("/", "layout")
  return { success: true }
}

export interface HydrateSessionResult {
  success: boolean
  userId: string | null
  isHumanVerified: boolean
  accessToken?: string
  refreshToken?: string | null
  error?: string
}

/**
 * Hydrates Supabase session and persists authentication cookies across .votary.app or .sunshade.icu.
 */
export async function hydrateSessionAction(
  accessToken: string,
  refreshToken?: string | null
): Promise<HydrateSessionResult> {
  if (!accessToken) {
    return {
      success: false,
      userId: null,
      isHumanVerified: false,
      error: "Missing access token",
    }
  }

  const payload = decodeJWT(accessToken)
  if (!payload) {
    return {
      success: false,
      userId: null,
      isHumanVerified: false,
      error: "Invalid JWT format",
    }
  }

  let effectiveAccessToken = accessToken
  let effectiveRefreshToken = refreshToken ?? null

  // Verify token expiry (attempt server refresh if expired and refreshToken is present)
  const nowSec = Math.floor(Date.now() / 1000)
  const isExpired = typeof payload.exp === "number" && payload.exp < nowSec

  let verifiedUser: { id: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null = null

  // Cryptographically verify token with Supabase Auth when configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (isExpired) {
    if (supabaseUrl && supabaseKey && effectiveRefreshToken) {
      try {
        const supabase = await createClient()
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession({
          refresh_token: effectiveRefreshToken,
        })
        if (!refreshErr && refreshed?.session?.access_token && refreshed.user) {
          effectiveAccessToken = refreshed.session.access_token
          effectiveRefreshToken = refreshed.session.refresh_token ?? effectiveRefreshToken
          verifiedUser = refreshed.user
        } else {
          return {
            success: false,
            userId: null,
            isHumanVerified: false,
            error: "Access token has expired",
          }
        }
      } catch {
        return {
          success: false,
          userId: null,
          isHumanVerified: false,
          error: "Access token has expired",
        }
      }
    } else {
      return {
        success: false,
        userId: null,
        isHumanVerified: false,
        error: "Access token has expired",
      }
    }
  } else if (supabaseUrl && supabaseKey) {
    try {
      const supabase = await createClient(effectiveAccessToken)
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser(effectiveAccessToken)

      if (userErr || !user) {
        return {
          success: false,
          userId: null,
          isHumanVerified: false,
          error: userErr?.message || "Invalid or unverified access token",
        }
      }
      verifiedUser = user
    } catch {
      if (process.env.NODE_ENV !== "test") {
        return {
          success: false,
          userId: null,
          isHumanVerified: false,
          error: "Authentication service unavailable or verification failed",
        }
      }
    }
  }

  const effectivePayload = decodeJWT(effectiveAccessToken) || payload
  // Derive verification claims from cryptographically verified user or decoded payload
  const proof = extractAntiSybilProof(verifiedUser || effectivePayload)
  // Hard Gate: trust state MUST be active for human verification
  const isHumanVerified = Boolean(proof.isHuman && proof.trustState === "active")
  const userId = verifiedUser
    ? verifiedUser.id
    : effectivePayload.sub || effectivePayload.id || effectivePayload.user_id || null

  const cookieStore = await cookies()
  const headerList = await headers()
  const host = headerList.get("host") || "votary.app"
  const cookieDomainOpts = getCrossDomainCookieOptions(host)

  const cookieMaxAge = 60 * 60 * 24 * 7 // 7 days

  try {
    // Clear any prior mismatched native Supabase sessions so previous accounts never leak
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith("sb-") && c.name.includes("-auth-token")) {
        try {
          cookieStore.delete(c.name)
          cookieStore.set(c.name, "", {
            ...cookieDomainOpts,
            httpOnly: false,
            maxAge: 0,
            expires: new Date(0),
          })
        } catch {
          // Ignore deletion error
        }
      }
    }

    cookieStore.set("sunshade_sso", effectiveAccessToken, {
      ...cookieDomainOpts,
      maxAge: cookieMaxAge,
    })
    cookieStore.set("sunshade_sso_token", effectiveAccessToken, {
      ...cookieDomainOpts,
      maxAge: cookieMaxAge,
    })
    cookieStore.set("sb-access-token", effectiveAccessToken, {
      ...cookieDomainOpts,
      maxAge: cookieMaxAge,
    })

    if (effectiveRefreshToken) {
      cookieStore.set("sb-refresh-token", effectiveRefreshToken, {
        ...cookieDomainOpts,
        maxAge: cookieMaxAge,
      })
    }

    // Also hydrate native Supabase SSR client session
    if (supabaseUrl && supabaseKey) {
      const supabase = await createClient(effectiveAccessToken)
      if (effectiveRefreshToken) {
        await supabase.auth.setSession({
          access_token: effectiveAccessToken,
          refresh_token: effectiveRefreshToken,
        })
      }
    }
  } catch {
    // Non-blocking if in read-only cookie context
  }

  revalidatePath("/", "layout")
  return {
    success: true,
    userId,
    isHumanVerified,
    accessToken: effectiveAccessToken,
    refreshToken: effectiveRefreshToken,
  }
}

/**
 * Revalidates the user session directly against Supabase and returns the authoritative user context.
 */
export async function revalidateUserContextAction(): Promise<UserContext> {
  return await getCurrentUserContext()
}
