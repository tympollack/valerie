"use server"

import { createClient } from "@/lib/supabase/server"
import {
  extractAntiSybilProof,
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
      const supabase = await createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const proof = extractAntiSybilProof(user)
        const email = user.email || null
        const displayName =
          (user.user_metadata?.full_name as string) ||
          (user.user_metadata?.name as string) ||
          (user.user_metadata?.display_name as string) ||
          (email ? email.split("@")[0] : null)

        return {
          authenticated: true,
          userId: user.id,
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
