"use client"

import { useState, useTransition, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  User,
  ShieldCheck,
  ShieldAlert,
  LogIn,
  LogOut,
  Settings,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { type UserContext, signOutAction, revalidateUserContextAction } from "@/app/actions/auth"
import { createClient } from "@/lib/supabase/client"
import { extractVerificationProof } from "@/lib/auth/ssoHandshake"
import { cn } from "@/lib/utils"

interface UserNavProps {
  initialUserContext?: UserContext
  className?: string
}

export function UserNav({ initialUserContext, className }: UserNavProps) {
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
  const [isOpen, setIsOpen] = useState(false)
  const [isSigningOut, startSignOut] = useTransition()

  const [returnToUrl, setReturnToUrl] = useState("")

  const prevUserIdRef = useRef<string | null>(initialUserContext?.userId || null)

  // Sync state if server-provided initialUserContext changes (e.g. after router.refresh)
  useEffect(() => {
    if (initialUserContext) {
      setUserContext(initialUserContext)
      prevUserIdRef.current = initialUserContext.userId
    }
  }, [initialUserContext])

  // Safely set the return URL on client mount to prevent empty return_to during SSR
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasAuthHash =
        window.location.hash.includes("access_token=") ||
        window.location.hash.includes("refresh_token=") ||
        window.location.hash.includes("token_type=")
      const safeHash = hasAuthHash ? "" : window.location.hash
      setReturnToUrl(window.location.pathname + window.location.search + safeHash)

      if (hasAuthHash) {
        const cleanUrl = window.location.pathname + window.location.search
        try {
          window.history.replaceState(null, "", cleanUrl)
        } catch {
          window.location.hash = ""
        }
      }
    }
  }, [])

  // Sync verification status on tab focus or visibilitychange when returning from SunShade Hub
  useEffect(() => {
    const handleSync = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      if (!userContext.authenticated || userContext.isHumanVerified) return

      try {
        const supabase = createClient()
        await supabase.auth.refreshSession()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        let isVerified = false
        if (user) {
          const freshProof = extractVerificationProof(user)

          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc(
              "is_human_verified",
              { p_user_id: user.id }
            )
            if (!rpcErr && typeof rpcRes === "boolean") {
              isVerified = rpcRes && freshProof.trustState === "active"
            }
          } catch {}

          if (freshProof.isHuman && freshProof.trustState === "active") {
            isVerified = true
          }
        }

        try {
          const serverContext = await revalidateUserContextAction()
          if (serverContext.isHumanVerified) {
            isVerified = true
          }
        } catch {}

        if (isVerified) {
          setUserContext((prev) => ({
            ...prev,
            isHumanVerified: true,
          }))
          router.refresh()
        }
      } catch (err) {
        console.warn("Failed to sync verification state:", err)
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleSync)
      document.addEventListener("visibilitychange", handleSync)
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleSync)
        document.removeEventListener("visibilitychange", handleSync)
      }
    }
  }, [userContext.authenticated, userContext.isHumanVerified, router])

  // Listen to client-side auth state changes for real-time reactivity
  useEffect(() => {
    try {
      const supabase = createClient()
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        // Only clear user context on explicit SIGNED_OUT event.
        // For SSO-only visitors, the client-side Supabase instance initially receives
        // a null browser session (INITIAL_SESSION) while server-side context is already
        // verified via wildcard .sunshade.icu SSO cookies. Overwriting context on
        // initial null session falsely signs SSO users out.
        if (event === "SIGNED_OUT") {
          prevUserIdRef.current = null
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
          const isHumanVerified = freshProof.isHuman && freshProof.trustState === "active"
          const email = session.user.email || null
          const displayName =
            (session.user.user_metadata?.full_name as string) ||
            (session.user.user_metadata?.name as string) ||
            (session.user.user_metadata?.display_name as string) ||
            (email ? email.split("@")[0] : null)

          const isDifferentUser =
            Boolean(prevUserIdRef.current) && prevUserIdRef.current !== session.user.id
          prevUserIdRef.current = session.user.id

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

          if (isDifferentUser) {
            router.refresh()
          }
        }
      })

      return () => {
        subscription.unsubscribe()
      }
    } catch {
      // Ignore if offline / local mock
    }
  }, [])

  const handleSignOut = () => {
    startSignOut(async () => {
      try {
        const supabase = createClient()
        await supabase.auth.signOut()
      } catch {
        // Non-blocking
      }
      setUserContext({
        authenticated: false,
        userId: null,
        email: null,
        displayName: null,
        isHumanVerified: false,
        verificationTier: "UNVERIFIED",
        trustState: "active",
      })
      await signOutAction()
      setIsOpen(false)
      router.refresh()
    })
  }

  const hubBaseUrl =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".sunshade.icu")
      ? "https://hub.sunshade.icu"
      : "https://hub.sunshade.icu"

  const callbackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback?return_to=${encodeURIComponent(returnToUrl || "/")}`
      : "/auth/callback"

  const currentUrl = (() => {
    if (typeof window === "undefined") return returnToUrl || "/"
    try {
      const parsed = new URL(window.location.href)
      if (
        parsed.hash.includes("access_token=") ||
        parsed.hash.includes("refresh_token=") ||
        parsed.hash.includes("token_type=")
      ) {
        parsed.hash = ""
      }
      return parsed.toString()
    } catch {
      return returnToUrl || "/"
    }
  })()

  const loginUrl = `${hubBaseUrl}/login?redirect=${encodeURIComponent(callbackUrl)}`
  const verifyUrl = `${hubBaseUrl}/login?redirect=${encodeURIComponent(callbackUrl)}&verify=true&redirectTo=${encodeURIComponent(currentUrl)}`

  // 1. Unauthenticated State
  if (!userContext.authenticated) {
    return (
      <div className={cn("flex shrink-0 items-center gap-2", className)}>
        <Link
          href="/settings"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
          title="Settings & Verification Status"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Link>

        <a
          href={loginUrl}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)] transition-all duration-150 hover:bg-cyan-900/50 hover:text-cyan-200"
        >
          <LogIn className="h-3.5 w-3.5" />
          <span>Sign In</span>
        </a>
      </div>
    )
  }

  // 2. Authenticated State
  const initialLetter = (
    userContext.displayName?.[0] ||
    userContext.email?.[0] ||
    "U"
  ).toUpperCase()

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger
          className="group relative flex cursor-pointer items-center gap-2 rounded-xl border border-cyan-500/30 bg-slate-950/80 px-2 py-1 transition-all duration-200 hover:border-cyan-400/60 hover:bg-cyan-950/30 focus:ring-2 focus:ring-cyan-400 focus:outline-none"
          aria-label="User Account Menu"
        >
          {/* Avatar Icon */}
          <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 text-xs font-bold text-slate-950 shadow-sm">
            {initialLetter}

            {/* Status indicator dot */}
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950",
                userContext.isHumanVerified ? "bg-emerald-400" : "bg-amber-400"
              )}
              title={
                userContext.isHumanVerified
                  ? "Identity Confirmed"
                  : "Setup Needed"
              }
            />
          </div>

          {/* User Name / ID Preview */}
          <div className="hidden flex-col text-left sm:flex">
            <span className="max-w-[120px] truncate text-xs leading-tight font-medium text-slate-200">
              {userContext.displayName ||
                userContext.email?.split("@")[0] ||
                "Citizen"}
            </span>
            <span
              className={cn(
                "font-mono text-[10px] leading-tight",
                userContext.isHumanVerified
                  ? "text-emerald-400"
                  : "text-amber-400"
              )}
            >
              {userContext.isHumanVerified ? "Verified Human" : "Setup Needed"}
            </span>
          </div>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="w-80 overflow-hidden rounded-xl border border-cyan-500/30 bg-slate-950/95 p-0 text-slate-100 shadow-[0_0_35px_rgba(6,182,212,0.2)] backdrop-blur-xl"
        >
          {/* Popover Header */}
          <div className="space-y-3 border-b border-slate-800 bg-cyan-950/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 text-sm font-bold text-slate-950">
                  {initialLetter}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {userContext.displayName || "SunShade Citizen"}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {userContext.email || "Hub Authenticated User"}
                  </p>
                </div>
              </div>
            </div>

            {/* Verification Badge */}
            <div className="flex items-center justify-between pt-1">
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 px-2.5 py-1 font-mono text-[11px] font-semibold",
                  userContext.isHumanVerified
                    ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                    : "border-amber-500/40 bg-amber-950/40 text-amber-300"
                )}
              >
                {userContext.isHumanVerified ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Identity Confirmed</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                    <span>Voter Status: Unconfirmed</span>
                  </>
                )}
              </Badge>
            </div>
          </div>

          {/* Verification Notice Card */}
          <div className="space-y-3 p-4 text-xs">
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3",
                userContext.isHumanVerified
                  ? "border-emerald-500/20 bg-emerald-950/20 text-slate-100"
                  : "border-amber-500/40 bg-amber-950/20 text-slate-100"
              )}
            >
              {userContext.isHumanVerified ? (
                <>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <div className="text-[11px] leading-relaxed text-slate-100">
                    <span className="font-semibold text-emerald-300">
                      Voting Rights Active:
                    </span>{" "}
                    Your account is confirmed. You are eligible to submit
                    community ballots.
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div className="text-[11px] leading-relaxed text-slate-100">
                    <span className="font-semibold text-amber-300">
                      Confirm Your Account to Vote:
                    </span>{" "}
                    To ensure one person equals one vote and keep bots out,
                    please confirm your identity on your SunShade Hub profile.
                  </div>
                </>
              )}
            </div>

            {/* Quick Action: If unverified, show verify CTA */}
            {!userContext.isHumanVerified && (
              <a
                href={verifyUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950 shadow-md transition-colors focus-visible:ring-2 focus-visible:ring-amber-300 focus:outline-none"
              >
                <span>Confirm Identity on Hub</span>
                <ExternalLink className="h-3.5 w-3.5 text-slate-950" />
              </a>
            )}

            {/* Menu Links */}
            <div className="space-y-1 border-t border-slate-800/80 pt-1">
              <Link
                href="/settings"
                onClick={() => setIsOpen(false)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-slate-300 transition-colors hover:bg-slate-900 hover:text-slate-100"
              >
                <div className="flex items-center gap-2">
                  <Settings className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Account &amp; Settings</span>
                </div>
                <span className="text-[10px] text-slate-500">Valerie</span>
              </Link>

              <a
                href={`${hubBaseUrl}/dashboard`}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-slate-300 transition-colors hover:bg-slate-900 hover:text-slate-100"
              >
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-cyan-400" />
                  <span>SunShade Hub Profile</span>
                </div>
                <ExternalLink className="h-3 w-3 text-slate-500" />
              </a>
            </div>

            {/* Sign Out Button */}
            <div className="border-t border-slate-800 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="w-full justify-center gap-2 border border-rose-500/20 text-xs font-semibold text-rose-400 hover:bg-rose-950/40 hover:text-rose-300"
              >
                {isSigningOut ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Signing Out...</span>
                  </>
                ) : (
                  <>
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Sign Out</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export { UserNav as UserMenu }
