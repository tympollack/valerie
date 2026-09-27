"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  ShieldCheck,
  ShieldAlert,
  User,
  Key,
  LogOut,
  LogIn,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Loader2,
  Globe,
  Fingerprint,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { type UserContext, signOutAction } from "@/app/actions/auth"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

interface SettingsViewProps {
  userContext: UserContext
}

export function SettingsView({ userContext }: SettingsViewProps) {
  const router = useRouter()
  const [copiedId, setCopiedId] = useState(false)
  const [isSigningOut, startSignOut] = useTransition()

  const handleCopyId = () => {
    if (userContext.userId) {
      navigator.clipboard.writeText(userContext.userId)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    }
  }

  const handleSignOut = () => {
    startSignOut(async () => {
      try {
        const supabase = createClient()
        await supabase.auth.signOut()
      } catch {
        // Non-blocking
      }
      await signOutAction()
      router.refresh()
    })
  }

  const [returnToUrl, setReturnToUrl] = useState("")

  useEffect(() => {
    if (typeof window !== "undefined") {
      setReturnToUrl(window.location.href)
    }
  }, [])

  const hubBaseUrl =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".sunshade.icu")
      ? "https://hub.sunshade.icu"
      : "https://hub.sunshade.icu"
  const authBaseUrl =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".sunshade.icu")
      ? "https://auth.sunshade.icu"
      : "https://auth.sunshade.icu"

  const loginUrl = returnToUrl
    ? `${authBaseUrl}/login?return_to=${encodeURIComponent(returnToUrl)}`
    : `${authBaseUrl}/login`
  const verifyUrl = returnToUrl
    ? `${authBaseUrl}/verify?return_to=${encodeURIComponent(returnToUrl)}`
    : `${authBaseUrl}/verify`

  return (
    <div className="space-y-6">
      {/* ── 1. Authentication Status Card ─────────────────────────────── */}
      <div className="space-y-5 rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-6 shadow-[0_0_30px_rgba(6,182,212,0.1)] backdrop-blur-xl">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 font-black text-slate-950 shadow-md">
              <User className="h-6 w-6" />
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
                <span>Citizen Identity &amp; Auth</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "px-2 py-0.5 font-mono text-[10px]",
                    userContext.authenticated
                      ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                      : "border-slate-700 bg-slate-900 text-slate-400"
                  )}
                >
                  {userContext.authenticated
                    ? "SSO Connected"
                    : "Unauthenticated"}
                </Badge>
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Unified cross-domain authentication across the SunShade
                ecosystem.
              </p>
            </div>
          </div>

          {userContext.authenticated ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="shrink-0 gap-1.5 border-rose-500/30 bg-rose-950/30 text-xs text-rose-300 hover:bg-rose-900/40 hover:text-rose-200"
            >
              {isSigningOut ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Signing Out...</span>
                </>
              ) : (
                <>
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Log Out of Valerie</span>
                </>
              )}
            </Button>
          ) : (
            <a
              href={loginUrl}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/60 px-4 py-2 text-xs font-semibold text-cyan-300 shadow-sm transition-colors hover:bg-cyan-900/60"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Log In via SunShade Hub</span>
            </a>
          )}
        </div>

        {/* Identity Details Grid */}
        {userContext.authenticated ? (
          <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
            <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
              <span className="block text-[11px] text-slate-400">
                Email / Username
              </span>
              <p className="font-mono font-medium text-slate-100">
                {userContext.email ||
                  userContext.displayName ||
                  "Anonymous Citizen"}
              </p>
            </div>

            <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
              <div className="flex items-center justify-between">
                <span className="block text-[11px] text-slate-400">
                  Unified User ID (sub)
                </span>
                {userContext.userId && (
                  <button
                    onClick={handleCopyId}
                    className="flex cursor-pointer items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300"
                    title="Copy User ID"
                  >
                    {copiedId ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              <p className="truncate font-mono text-cyan-300">
                {userContext.userId || "Not set"}
              </p>
            </div>
          </div>
        ) : (
          <Alert className="border-slate-800 bg-slate-900/50 text-slate-300">
            <Key className="h-4 w-4 text-cyan-400" />
            <AlertDescription className="text-xs">
              You are currently viewing Valerie as an unauthenticated guest. You
              can explore polls and inspect AI definitions, but signing in via
              the SunShade Hub is required to commit bivariate votes.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* ── 2. Single-Human Anti-Sybil Verification Card ───────────────── */}
      <div className="space-y-5 rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-6 shadow-[0_0_30px_rgba(6,182,212,0.1)] backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl font-black shadow-md",
              userContext.isHumanVerified
                ? "bg-gradient-to-br from-emerald-400 to-teal-500 text-slate-950"
                : "bg-gradient-to-br from-amber-500 to-rose-600 text-slate-950"
            )}
          >
            {userContext.isHumanVerified ? (
              <ShieldCheck className="h-6 w-6" />
            ) : (
              <ShieldAlert className="h-6 w-6" />
            )}
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
              <span>Anti-Sybil Single-Human Verification</span>
              <Badge
                variant="outline"
                className={cn(
                  "px-2 py-0.5 font-mono text-[10px]",
                  userContext.isHumanVerified
                    ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                    : "border-amber-500/40 bg-amber-950/40 text-amber-300"
                )}
              >
                {userContext.isHumanVerified
                  ? "VERIFIED HUMAN"
                  : "VERIFICATION REQUIRED"}
              </Badge>
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Protects civic deliberation from duplicate voting, bot farms, and
              brigading.
            </p>
          </div>
        </div>

        {/* Verification Status Details */}
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
            <span className="block text-[11px] text-slate-400">
              Voting Eligibility
            </span>
            <div className="flex items-center gap-1.5 font-semibold">
              {userContext.isHumanVerified ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-emerald-300">
                    Eligible (1 Human, 1 Vote)
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <span className="text-amber-300">
                    Locked (Requires Proof)
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
            <span className="block text-[11px] text-slate-400">
              Verification Tier
            </span>
            <span className="font-mono font-semibold text-cyan-300 uppercase">
              {userContext.verificationTier}
            </span>
          </div>

          <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
            <span className="block text-[11px] text-slate-400">
              Trust State
            </span>
            <span
              className={cn(
                "font-mono font-semibold uppercase",
                userContext.trustState === "active"
                  ? "text-emerald-400"
                  : "text-rose-400"
              )}
            >
              {userContext.trustState}
            </span>
          </div>
        </div>

        {/* Explainer Box */}
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs leading-relaxed text-slate-300">
          <p className="flex items-center gap-1.5 font-semibold text-slate-100">
            <Fingerprint className="h-4 w-4 text-cyan-400" />
            <span>Why Single-Human Verification is Enforced</span>
          </p>
          <p className="text-slate-400">
            Project Valerie utilizes a bivariate commit-and-reveal consensus
            mechanism where every vote carries both categorical sentiment
            direction and a continuous conviction weight (0%–100%). To maintain
            statistical validity and prevent Sybil dilution, votes are
            cryptographically sealed and only accepted from accounts with
            verified human nullifiers issued by the SunShade Hub.
          </p>
        </div>

        {/* Action Button if unverified */}
        {!userContext.isHumanVerified && (
          <div className="pt-2">
            <a
              href={verifyUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 py-3 text-xs font-bold text-slate-950 shadow-lg transition-all duration-150 hover:opacity-95"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Complete Single-Human Verification on SunShade Hub</span>
              <ExternalLink className="ml-1 h-4 w-4" />
            </a>
          </div>
        )}
      </div>

      {/* ── 3. SunShade Ecosystem Integration Links ────────────────────── */}
      <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Globe className="h-4 w-4 text-cyan-400" />
          <span>Connected SunShade Services</span>
        </h3>

        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <a
            href={`${hubBaseUrl}/dashboard`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200"
          >
            <div>
              <p className="font-semibold text-slate-100">
                SunShade Hub Dashboard
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Manage token balances, badges, and unlocks
              </p>
            </div>
            <ExternalLink className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
          </a>

          <a
            href={verifyUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200"
          >
            <div>
              <p className="font-semibold text-slate-100">
                Identity Verification Portal
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Single-human proof and verification tiers
              </p>
            </div>
            <ExternalLink className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
          </a>

          <a
            href={`${hubBaseUrl}/dashboard#profile`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200"
          >
            <div>
              <p className="font-semibold text-slate-100">
                Citizen Profile &amp; Settings
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Update avatar, password, and security
              </p>
            </div>
            <ExternalLink className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
          </a>
        </div>
      </div>
    </div>
  )
}
