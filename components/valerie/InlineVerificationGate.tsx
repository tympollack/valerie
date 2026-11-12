"use client"

import React from "react"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

export interface InlineVerificationGateProps {
  verifyUrl: string
  className?: string
}

export function InlineVerificationGate({
  verifyUrl,
  className,
}: InlineVerificationGateProps) {
  return (
    <div
      data-testid="inline-verification-gate"
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 text-xs shadow-md backdrop-blur-md",
        className
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="space-y-0.5">
          <h4 className="font-semibold text-amber-300">
            Confirm Your Account to Vote
          </h4>
          <p className="text-slate-100 text-[11px] leading-relaxed">
            To ensure one person equals one vote and keep bots out, please confirm
            your identity on your SunShade Hub profile.
          </p>
        </div>
      </div>

      <a
        href={verifyUrl}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-md transition-colors focus-visible:ring-2 focus-visible:ring-amber-300 focus:outline-none"
      >
        <span>Confirm Identity on Hub</span>
        <ExternalLink className="h-3.5 w-3.5 text-slate-950" />
      </a>
    </div>
  )
}
