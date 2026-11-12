"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/components/auth/AuthProvider"
import { createClient } from "@/lib/supabase/client"
import { extractVerificationProof } from "@/lib/auth/ssoHandshake"
import type { UserContext } from "@/app/actions/auth"

export function usePollAuth(userContextProp?: UserContext | null) {
  const authContext = useAuth()
  const [localUserContext, setLocalUserContext] = useState<UserContext | null>(
    userContextProp ?? authContext?.userContext ?? null
  )

  useEffect(() => {
    if (userContextProp !== undefined) {
      setLocalUserContext(userContextProp)
    } else if (authContext?.userContext) {
      setLocalUserContext(authContext.userContext)
    }
  }, [userContextProp, authContext?.userContext])

  useEffect(() => {
    if (userContextProp !== undefined || authContext?.userContext) return
    try {
      const supabase = createClient()
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          const proof = extractVerificationProof(session.user)
          setLocalUserContext({
            authenticated: true,
            userId: session.user.id,
            email: session.user.email || null,
            displayName: null,
            isHumanVerified: proof.isHuman && proof.trustState === "active",
            verificationTier: proof.verificationTier,
            trustState: proof.trustState,
          })
        }
      })
    } catch {}
  }, [userContextProp, authContext])

  return userContextProp ?? authContext?.userContext ?? localUserContext
}
