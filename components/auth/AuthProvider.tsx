"use client"

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  decodeJWT,
  extractAntiSybilProof,
  extractVerificationProof,
} from "@/lib/auth/ssoHandshake"
import { processCallbackAuthentication } from "@/lib/auth/callback"
import {
  type UserContext,
  hydrateSessionAction,
  revalidateUserContextAction,
} from "@/app/actions/auth"

export interface AuthContextValue {
  userContext: UserContext
  setUserContext: React.Dispatch<React.SetStateAction<UserContext>>
  refreshVerification: () => Promise<boolean>
  isRefreshing: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({
  initialUserContext,
  children,
}: {
  initialUserContext?: UserContext
  children: React.ReactNode
}) {
  const router = useRouter()
  const [userContext, setUserContext] = useState<UserContext>(
    initialUserContext || {
      authenticated: false,
      userId: null,
      email: null,
      displayName: null,
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "active",
    }
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const userContextRef = useRef(userContext)
  userContextRef.current = userContext
  const hashHydratedRef = useRef(false)

  useEffect(() => {
    if (initialUserContext) {
      setUserContext(initialUserContext)
    }
  }, [initialUserContext])

  // Hydrate cross-domain SSO fragment tokens (#access_token=...&refresh_token=...)
  // when redirected directly to any route (e.g. /, /deliberation, /settings) instead of /auth/callback.
  useEffect(() => {
    if (hashHydratedRef.current) return
    if (typeof window === "undefined") return
    if (window.location.pathname === "/auth/callback") return
    if (!window.location.hash || !window.location.hash.includes("access_token=")) return

    hashHydratedRef.current = true
    const rawHash = window.location.hash
    const rawSearch = window.location.search
    const hostname = window.location.hostname

    // Clean sensitive tokens from URL fragment immediately
    try {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      )
    } catch {
      // Non-blocking in restricted history contexts
    }

    async function hydrateFromFragment() {
      let hydratedAccessToken: string | null = null
      const result = await processCallbackAuthentication({
        hash: rawHash,
        search: rawSearch,
        hostname,
        setSession: async ({ access_token, refresh_token }) => {
          hydratedAccessToken = access_token
          const supabase = createClient()
          if (refresh_token) {
            const { data } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            })
            if (data?.session) {
              hydratedAccessToken = data.session.access_token
              return {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
              }
            }
          }
        },
        persistServerSession: async (accessToken, refreshToken) => {
          hydratedAccessToken = accessToken
          return await hydrateSessionAction(accessToken, refreshToken)
        },
      })

      if (!result.success) return

      let resolvedContext: UserContext | null = null
      try {
        const serverContext = await revalidateUserContextAction()
        if (serverContext?.authenticated) {
          resolvedContext = serverContext
        }
      } catch {
        // Fallback to decoded token claims below
      }

      if (!resolvedContext && hydratedAccessToken) {
        const payload = decodeJWT(hydratedAccessToken)
        const userId = payload?.sub || payload?.id || payload?.user_id || null
        if (userId) {
          const proof = extractAntiSybilProof(payload)
          const email = typeof payload?.email === "string" ? payload.email : null
          resolvedContext = {
            authenticated: true,
            userId,
            email,
            displayName: email ? email.split("@")[0] : null,
            isHumanVerified: Boolean(proof.isHuman && proof.trustState === "active"),
            verificationTier: proof.verificationTier,
            trustState: proof.trustState,
            nullifierHash: proof.nullifierHash,
            provider: proof.provider,
            score: proof.score,
          }
        }
      }

      if (resolvedContext) {
        setUserContext(resolvedContext)
        router.refresh()
      }
    }

    void hydrateFromFragment()
  }, [router])

  const refreshVerification = useCallback(async (): Promise<boolean> => {
    try {
      setIsRefreshing(true)
      const supabase = createClient()

      // 1. Refresh Supabase auth session
      try {
        await supabase.auth.refreshSession()
      } catch {
        // Non-blocking
      }

      // 2. Query authoritative user record / RPC
      let isVerified = false
      let freshTier = userContextRef.current.verificationTier
      let freshTrustState = userContextRef.current.trustState
      let email = userContextRef.current.email
      let displayName = userContextRef.current.displayName
      let currentUserId = userContextRef.current.userId

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          currentUserId = user.id
          email = user.email || email

          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc(
              "is_human_verified",
              { p_user_id: user.id }
            )
            if (!rpcErr && typeof rpcRes === "boolean") {
              isVerified = rpcRes
            }
          } catch {
            // RPC fallback
          }

          const freshProof = extractVerificationProof(user)
          if (freshProof.isHuman && freshProof.trustState === "active") {
            isVerified = true
          }
          freshTier = freshProof.verificationTier
          freshTrustState = freshProof.trustState
          displayName =
            (user.user_metadata?.full_name as string) ||
            (user.user_metadata?.name as string) ||
            (user.user_metadata?.display_name as string) ||
            (email ? email.split("@")[0] : displayName)
        }
      } catch {
        // getUser non-blocking
      }

      // 3. Query authoritative server action
      try {
        const serverContext = await revalidateUserContextAction()
        if (serverContext.isHumanVerified) {
          isVerified = true
          freshTier = serverContext.verificationTier
          freshTrustState = serverContext.trustState
          if (serverContext.displayName) displayName = serverContext.displayName
          if (serverContext.email) email = serverContext.email
          if (serverContext.userId) currentUserId = serverContext.userId
        }
      } catch {
        // Server action fallback
      }

      const wasVerified = userContextRef.current.isHumanVerified
      if (isVerified && !wasVerified) {
        setUserContext((prev) => ({
          ...prev,
          authenticated: true,
          userId: currentUserId || prev.userId,
          email,
          displayName,
          isHumanVerified: true,
          verificationTier: freshTier,
          trustState: freshTrustState,
        }))
        router.refresh()
        return true
      }

      return isVerified
    } catch (err) {
      console.warn("[AuthProvider] Failed to refresh verification:", err)
      return false
    } finally {
      setIsRefreshing(false)
    }
  }, [router])

  // Listen to visibilitychange and window focus events to sync verification state
  useEffect(() => {
    const handleSync = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (userContextRef.current.authenticated && !userContextRef.current.isHumanVerified) {
          refreshVerification()
        }
      }
    }

    const handleFocus = () => {
      if (userContextRef.current.authenticated && !userContextRef.current.isHumanVerified) {
        refreshVerification()
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus)
      document.addEventListener("visibilitychange", handleSync)
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus)
        document.removeEventListener("visibilitychange", handleSync)
      }
    }
  }, [refreshVerification])

  // Real-time auth state listener
  useEffect(() => {
    try {
      const supabase = createClient()
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_OUT") {
          setUserContext({
            authenticated: false,
            userId: null,
            email: null,
            displayName: null,
            isHumanVerified: false,
            verificationTier: "UNVERIFIED",
            trustState: "active",
          })
        } else if (session?.user) {
          const freshProof = extractVerificationProof(session.user)
          const isHumanVerified =
            freshProof.isHuman && freshProof.trustState === "active"
          const email = session.user.email || null
          const displayName =
            (session.user.user_metadata?.full_name as string) ||
            (session.user.user_metadata?.name as string) ||
            (session.user.user_metadata?.display_name as string) ||
            (email ? email.split("@")[0] : null)

          setUserContext({
            authenticated: true,
            userId: session.user.id,
            email,
            displayName,
            isHumanVerified,
            verificationTier: freshProof.verificationTier,
            trustState: freshProof.trustState,
            nullifierHash: freshProof.nullifierHash,
            provider: freshProof.provider,
            score: freshProof.score,
          })
        }
      })

      return () => {
        subscription.unsubscribe()
      }
    } catch {}
  }, [])

  return (
    <AuthContext.Provider
      value={{
        userContext,
        setUserContext,
        refreshVerification,
        isRefreshing,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
