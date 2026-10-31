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
 * Resolves current user session and Anti-Sybil verification status from Supabase and headers.
 */
export async function getCurrentUserContext(): Promise<UserContext> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const cookieStore = await cookies()
      const ssoToken = extractSSOToken(cookieStore)
      const supabase = await createClient(ssoToken)
      let resolvedUser = null

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser()

      if (!userErr && user) {
        resolvedUser = user
      } else if (ssoToken) {
        const {
          data: ssoData,
          error: ssoErr,
        } = await supabase.auth.getUser(ssoToken)
        if (!ssoErr && ssoData?.user) {
          resolvedUser = ssoData.user
        }
      }

      if (resolvedUser) {
        const proof = extractAntiSybilProof(resolvedUser)
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
          isHumanVerified: proof.isHuman && proof.trustState === "active",
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
      try {
        cookieStore.delete(cookie.name)
        cookieStore.set(cookie.name, "", {
          ...cookieDomainOpts,
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

  // Verify token expiry
  const nowSec = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === "number" && payload.exp < nowSec) {
    return {
      success: false,
      userId: null,
      isHumanVerified: false,
      error: "Access token has expired",
    }
  }

  let verifiedUser: { id: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null = null

  // Cryptographically verify token with Supabase Auth when configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = await createClient(accessToken)
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser(accessToken)

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

  // Derive verification claims from cryptographically verified user or decoded payload
  const proof = extractAntiSybilProof(verifiedUser || payload)
  // Hard Gate: trust state MUST be active for human verification
  const isHumanVerified = Boolean(proof.isHuman && proof.trustState === "active")
  const userId = verifiedUser ? verifiedUser.id : (payload.sub || payload.id || payload.user_id || null)

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
            maxAge: 0,
            expires: new Date(0),
          })
        } catch {
          // Ignore deletion error
        }
      }
    }

    cookieStore.set("sunshade_sso", accessToken, {
      ...cookieDomainOpts,
      maxAge: cookieMaxAge,
    })
    cookieStore.set("sunshade_sso_token", accessToken, {
      ...cookieDomainOpts,
      maxAge: cookieMaxAge,
    })
    cookieStore.set("sb-access-token", accessToken, {
      ...cookieDomainOpts,
      maxAge: cookieMaxAge,
    })

    if (refreshToken) {
      cookieStore.set("sb-refresh-token", refreshToken, {
        ...cookieDomainOpts,
        maxAge: cookieMaxAge,
      })
    }

    // Also hydrate native Supabase SSR client session
    if (supabaseUrl && supabaseKey) {
      const supabase = await createClient(accessToken)
      if (refreshToken) {
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
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
  }
}
