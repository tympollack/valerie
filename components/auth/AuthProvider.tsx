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
import { extractVerificationProof } from "@/lib/auth/ssoHandshake"
import {
  type UserContext,
  getCurrentUserContext,
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

  useEffect(() => {
    if (initialUserContext) {
      setUserContext(initialUserContext)
    }
  }, [initialUserContext])

  // Strip sensitive access/refresh tokens from the browser address bar immediately
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const hash = window.location.hash
      if (
        hash.includes("access_token=") ||
        hash.includes("refresh_token=") ||
        hash.includes("token_type=")
      ) {
        const cleanUrl =
          window.location.pathname + (window.location.search || "")
        try {
          window.history.replaceState(null, "", cleanUrl)
        } catch {
          window.location.hash = ""
        }
      }
    }
  }, [])

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

          const freshProof = extractVerificationProof(user)
          freshTier = freshProof.verificationTier
          freshTrustState = freshProof.trustState

          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc(
              "is_human_verified",
              { p_user_id: user.id }
            )
            if (!rpcErr && typeof rpcRes === "boolean") {
              isVerified = rpcRes && freshProof.trustState === "active"
            }
          } catch {
            // RPC fallback
          }

          if (freshProof.isHuman && freshProof.trustState === "active") {
            isVerified = true
          }
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
        if (!userContextRef.current.isHumanVerified) {
          refreshVerification()
        }
      }
    }

    const handleFocus = () => {
      if (!userContextRef.current.isHumanVerified) {
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
