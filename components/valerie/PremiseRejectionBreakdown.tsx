"use client"

import React from "react"
import { motion } from "framer-motion"
import { Flag, ShieldAlert, Sparkles, Scale } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface PremiseRejectionBreakdownProps {
  userFlagReason?: string
  totalFlags?: number
  totalVotes?: number
  breakdown?: Record<string, number>
  className?: string
}

const DEFAULT_FLAG_BREAKDOWN: Record<string, { label: string; count: number; color: string; badge: string }> = {
  FALSE_DICHOTOMY: {
    label: "False Dichotomy / Missing Axis",
    count: 22,
    color: "from-amber-500 to-amber-600",
    badge: "Missing Axis",
  },
  LOADED_FRAMING: {
    label: "Loaded / Manipulative Framing",
    count: 14,
    color: "from-rose-500 to-rose-600",
    badge: "Framing",
  },
  DISPUTED_PREMISE: {
    label: "Disputed Factual Premise",
    count: 12,
    color: "from-violet-500 to-violet-600",
    badge: "Factual Dispute",
  },
  LOCALE_MISMATCH: {
    label: "Geographic Scope Mismatch",
    count: 6,
    color: "from-cyan-500 to-cyan-600",
    badge: "Geography",
  },
}

export function PremiseRejectionBreakdown({
  userFlagReason,
  totalFlags,
  totalVotes = 401,
  breakdown,
  className,
}: PremiseRejectionBreakdownProps) {
  // Aggregate counts
  const items = Object.entries(DEFAULT_FLAG_BREAKDOWN).map(([reason, config]) => {
    const customCount = breakdown?.[reason]
    const count = customCount !== undefined ? customCount : config.count
    return {
      reason,
      label: config.label,
      badge: config.badge,
      color: config.color,
      count,
    }
  })

  const computedTotalFlags =
    totalFlags !== undefined
      ? totalFlags
      : items.reduce((acc, item) => acc + item.count, 0)

  const totalCivicActions = totalVotes + computedTotalFlags
  const rejectionRate = totalCivicActions > 0
    ? ((computedTotalFlags / totalCivicActions) * 100).toFixed(1)
    : "0.0"

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/30 bg-slate-900/60 p-5 space-y-4 shadow-[0_0_25px_rgba(245,158,11,0.06)]",
        className
      )}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-950/60 text-amber-400">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                Premise Rejection &amp; Framing Telemetry
              </h4>
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-950/40 text-[9px] font-semibold text-amber-300"
              >
                Diagnostic Rollup
              </Badge>
            </div>
            <p className="text-[11px] text-slate-400">
              {computedTotalFlags} participants challenged the premise framing ({rejectionRate}% of total engagement)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px]">
          <Scale className="h-3 w-3 text-amber-400" />
          <span className="text-slate-400">Bridging Consensus:</span>
          <span className="font-mono font-bold text-amber-300">Active</span>
        </div>
      </div>

      {/* Breakdown Bars */}
      <div className="space-y-3">
        {items.map((item) => {
          const pct = computedTotalFlags > 0
            ? Math.round((item.count / computedTotalFlags) * 100)
            : 0
          const isUserSelection = userFlagReason === item.reason

          return (
            <div key={item.reason} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200">{item.label}</span>
                  {isUserSelection && (
                    <span className="rounded bg-amber-400 px-1.5 py-0.2 font-mono text-[9px] font-extrabold text-slate-950 uppercase tracking-wider">
                      ★ YOUR CHALLENGE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                  <span>{item.count}</span>
                  <span className="text-amber-300 font-bold">({pct}%)</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className={cn("h-full rounded-full bg-gradient-to-r", item.color)}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer Info */}
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-1">
        <Sparkles className="h-3 w-3 shrink-0 text-amber-400" />
        <span>
          When diagnostic consensus indicates a false dichotomy, Valerie cluster engines synthesize a dynamic 4-axis compromise poll.
        </span>
      </p>
    </div>
  )
}
