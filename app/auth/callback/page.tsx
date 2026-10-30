"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { VotaryEmblem } from "@/components/brand/VotaryEmblem"
import { createClient } from "@/lib/supabase/client"
import { hydrateSessionAction } from "@/app/actions/auth"
import { processCallbackAuthentication } from "@/lib/auth/callback"

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<"hydrating" | "verified" | "error">("hydrating")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function handleAuth() {
      if (typeof window === "undefined") return

      const result = await processCallbackAuthentication({
        hash: window.location.hash,
        search: window.location.search,
        hostname: window.location.hostname,
        exchangeCode: async (code) => {
          const supabase = createClient()
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          if (error || !data.session) return null
          return {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          }
        },
        setSession: async ({ access_token, refresh_token }) => {
          const supabase = createClient()
          if (refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token })
          }
        },
        persistServerSession: async (accessToken, refreshToken) => {
          await hydrateSessionAction(accessToken, refreshToken)
        },
      })

      if (!isMounted) return

      if (result.success && result.destination) {
        setStatus("verified")
        window.location.replace(result.destination)
      } else {
        setStatus("error")
        setErrorMessage(result.error || "Unable to complete session hydration.")
      }
    }

    handleAuth()

    return () => {
      isMounted = false
    }
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 h-[350px] w-[500px] -translate-x-1/2 bg-gradient-to-b from-cyan-500/10 via-cyan-950/20 to-transparent opacity-70 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-8 text-center shadow-[0_0_40px_rgba(6,182,212,0.15)] backdrop-blur-xl">
        <div className="mx-auto flex justify-center pb-4">
          <VotaryEmblem size={52} />
        </div>

        {status === "hydrating" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-950/50 text-cyan-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-100">Hydrating Civic Session</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Verifying citizen credentials and establishing secure cross-domain authentication for The Votary...
              </p>
            </div>
          </div>
        )}

        {status === "verified" && (
          <div className="space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-950/50 text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-100">Credentials Verified</h2>
              <p className="text-xs text-slate-400">Redirecting to active civic deliberation...</p>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-950/50 text-rose-400">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-slate-100">Authentication Incomplete</h2>
              <p className="text-xs text-rose-300/90 leading-relaxed">{errorMessage}</p>
            </div>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex w-full items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/50 px-4 py-2.5 text-xs font-semibold text-cyan-300 shadow transition-colors hover:bg-cyan-900/60 hover:text-cyan-200"
              >
                Return to Deliberation
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
