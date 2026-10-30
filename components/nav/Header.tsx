import Link from "next/link"
import { Shield, ArrowLeft, Activity } from "lucide-react"
import { UserNav } from "@/components/valerie/UserNav"
import { VotaryEmblem } from "@/components/brand/VotaryEmblem"
import { siteConfig } from "@/config/site"
import type { UserContext } from "@/app/actions/auth"
import { cn } from "@/lib/utils"

export interface HeaderProps {
  userContext?: UserContext
  showBackButton?: boolean
  backButtonHref?: string
  backButtonLabel?: string
  activeNav?: string
  className?: string
}

export function Header({
  userContext,
  showBackButton = false,
  backButtonHref = "/",
  backButtonLabel = "Back to Deliberation",
  activeNav = "Deliberation",
  className,
}: HeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b border-cyan-500/20 bg-slate-950/85 backdrop-blur-xl transition-colors",
        className
      )}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-3 sm:px-6">
        {/* Left Side: Brand, Optional Back Button, Title, and Telemetry Pill */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {showBackButton && (
            <Link
              href={backButtonHref}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1 text-xs font-semibold text-slate-400 transition-colors hover:border-cyan-500/30 hover:text-cyan-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{backButtonLabel}</span>
              <span className="sm:hidden">Back</span>
            </Link>
          )}

          {showBackButton && <div className="hidden h-4 w-px bg-slate-800 sm:block" />}

          <Link
            href="/"
            className="group flex min-w-0 items-center gap-2.5 sm:gap-3 transition-opacity hover:opacity-90"
            aria-label={`${siteConfig.name} Home`}
          >
            <VotaryEmblem size={34} className="shrink-0" />
            <div className="flex flex-col min-w-0 leading-tight">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-base font-bold tracking-tight text-slate-100 group-hover:text-cyan-300 transition-colors truncate",
                    showBackButton ? "hidden sm:inline" : "inline"
                  )}
                >
                  {siteConfig.name}
                </span>
                <span className="hidden text-xs font-medium text-slate-400 sm:inline truncate">
                  · Civic Deliberation
                </span>
                <span
                  className={cn(
                    "rounded border border-cyan-500/30 bg-cyan-950/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-cyan-400 uppercase shrink-0",
                    showBackButton ? "hidden md:inline" : "hidden min-[480px]:inline"
                  )}
                >
                  {siteConfig.telemetry.system}
                </span>
              </div>
              <span className="hidden text-[11px] font-mono tracking-tight text-cyan-500/80 md:block truncate">
                {siteConfig.tagline}
              </span>
            </div>
          </Link>

          {/* Navigation Chips */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-1.5 ml-2 border-l border-slate-800/80 pl-4"
          >
            {siteConfig.navItems.map((item) => {
              const isActive = activeNav === item.title
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium transition-colors",
                    isActive
                      ? "border border-cyan-500/40 bg-cyan-950/70 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                      : "text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  )}
                >
                  {item.title}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Right Side: Subtle Status Indicators & Fixed Utility Controls */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3 text-xs">
          {/* Subtle Icon-Based Status Tooltips */}
          <div className="hidden sm:flex items-center gap-1.5">
            {/* Anti-Bandwagoning indicator */}
            <div
              title="Anti-Bandwagoning consensus protection active"
              className="group relative flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
              aria-label="Anti-Bandwagoning"
            >
              <Shield className="h-3.5 w-3.5 text-cyan-400" />
              <div className="pointer-events-none absolute -bottom-8 right-0 z-50 hidden whitespace-nowrap rounded border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-cyan-300 shadow-xl group-hover:block">
                Anti-Bandwagoning
              </div>
            </div>

            {/* SHA-256 AI Attestation indicator */}
            <div
              title="SHA-256 AI Active cryptographic attestation"
              className="group relative flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
              aria-label="SHA-256 AI Active"
            >
              <Activity className="h-3.5 w-3.5 text-cyan-400" />
              <div className="pointer-events-none absolute -bottom-8 right-0 z-50 hidden whitespace-nowrap rounded border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-cyan-300 shadow-xl group-hover:block">
                SHA-256 AI Active
              </div>
            </div>

            {/* Telemetry Kernel indicator */}
            <div
              title={`Internal Telemetry Kernel: ${siteConfig.telemetry.kernel}`}
              className="group relative hidden xl:flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
              aria-label={siteConfig.telemetry.kernel}
            >
              <span className="font-mono text-[10px] font-bold text-cyan-500/80">V</span>
              <div className="pointer-events-none absolute -bottom-8 right-0 z-50 hidden whitespace-nowrap rounded border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-300 shadow-xl group-hover:block">
                {siteConfig.telemetry.kernel}
              </div>
            </div>
          </div>

          {/* User Profile / Navigation (Sign In, Settings) */}
          <div className="flex shrink-0 items-center">
            <UserNav initialUserContext={userContext} />
          </div>
        </div>
      </div>
    </header>
  )
}
