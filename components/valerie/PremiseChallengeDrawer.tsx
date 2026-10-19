"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Flag, X, AlertTriangle, MessageSquare, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { type FlagReason, VALID_FLAG_REASONS } from "@/app/actions/valerieFlagActions"
import { cn } from "@/lib/utils"

export interface PremiseChallengeDrawerProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (reason: FlagReason, comment?: string) => Promise<void> | void
  isSubmitting?: boolean
  error?: string | null
  className?: string
}

export interface DiagnosticPillConfig {
  reason: FlagReason
  title: string
  description: string
  badge: string
  activeColor: string
  borderColor: string
}

export const DIAGNOSTIC_PILLS: DiagnosticPillConfig[] = [
  {
    reason: "LOADED_FRAMING",
    title: "Loaded Framing",
    description: "Loaded or emotionally manipulative wording",
    badge: "Framing",
    activeColor: "border-rose-500/60 bg-rose-950/40 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.15)]",
    borderColor: "hover:border-rose-500/40",
  },
  {
    reason: "FALSE_DICHOTOMY",
    title: "False Dichotomy",
    description: "Forces a binary choice / misses a key perspective",
    badge: "Missing Axis",
    activeColor: "border-amber-500/60 bg-amber-950/40 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.15)]",
    borderColor: "hover:border-amber-500/40",
  },
  {
    reason: "DISPUTED_PREMISE",
    title: "Disputed Premise",
    description: "Underlying factual premise is disputed",
    badge: "Factual Dispute",
    activeColor: "border-violet-500/60 bg-violet-950/40 text-violet-200 shadow-[0_0_15px_rgba(139,92,246,0.15)]",
    borderColor: "hover:border-violet-500/40",
  },
  {
    reason: "LOCALE_MISMATCH",
    title: "Locale Mismatch",
    description: "Not applicable to this geographic scope",
    badge: "Geography",
    activeColor: "border-cyan-500/60 bg-cyan-950/40 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.15)]",
    borderColor: "hover:border-cyan-500/40",
  },
]

export function PremiseChallengeDrawer({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
  className,
}: PremiseChallengeDrawerProps) {
  const [selectedReason, setSelectedReason] = useState<FlagReason | null>(null)
  const [missingAxisComment, setMissingAxisComment] = useState<string>("")
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setValidationError(null)
    if (!selectedReason) {
      setValidationError("Please select a diagnostic reason to challenge the premise.")
      return
    }

    if (selectedReason === "FALSE_DICHOTOMY" && !missingAxisComment.trim()) {
      setValidationError("Please provide a concise description of the missing perspective or axis.")
      return
    }

    await onSubmit(
      selectedReason,
      selectedReason === "FALSE_DICHOTOMY" ? missingAxisComment.trim() : undefined
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="premise-challenge-drawer"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className={cn("overflow-hidden", className)}
        >
          <div className="space-y-5 rounded-2xl border border-amber-500/30 bg-slate-950/90 p-6 shadow-[0_0_30px_rgba(245,158,11,0.08)] backdrop-blur-xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-950/60 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <Flag className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-100">
                      Challenge Premise / Flag Framing
                    </h3>
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-950/40 text-[10px] font-semibold text-amber-300">
                      Commit Gate
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Reject this poll&apos;s formulation without voting. Satisfies your 24h Commit-and-Reveal gate and powers cross-spectrum auto-rollback.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isSubmitting}
                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-100"
                aria-label="Close premise challenge drawer"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Diagnostic Pills Grid */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">
                Select Structured Diagnostic Reason
              </label>
              <div
                className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
                role="radiogroup"
                aria-label="Diagnostic reasons"
              >
                {DIAGNOSTIC_PILLS.map((pill) => {
                  const isSelected = selectedReason === pill.reason
                  return (
                    <button
                      key={pill.reason}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => {
                        setSelectedReason(pill.reason)
                        setValidationError(null)
                      }}
                      className={cn(
                        "group relative flex flex-col items-start rounded-xl border p-3.5 text-left transition-all duration-200 cursor-pointer",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
                        isSelected
                          ? pill.activeColor
                          : cn("border-slate-800 bg-slate-900/50 text-slate-300", pill.borderColor, "hover:bg-slate-900")
                      )}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-xs font-bold text-slate-100">
                          {pill.title}
                        </span>
                        <Badge
                          variant="outline"
                          className="border-slate-700 bg-slate-950/60 text-[9px] text-slate-400"
                        >
                          {pill.badge}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-slate-400 group-hover:text-slate-300">
                        {pill.description}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Missing Axis Input (Conditional for FALSE_DICHOTOMY) */}
            <AnimatePresence>
              {selectedReason === "FALSE_DICHOTOMY" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="missing-axis-input"
                      className="flex items-center gap-1.5 text-xs font-semibold text-amber-300"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>What perspective or axis is missing?</span>
                    </label>
                    <span className="font-mono text-[11px] text-slate-400">
                      {missingAxisComment.length}/240
                    </span>
                  </div>
                  <Textarea
                    id="missing-axis-input"
                    placeholder="Describe the unrepresented civic viewpoint, third alternative, or compromise axis..."
                    value={missingAxisComment}
                    onChange={(e) => {
                      setMissingAxisComment(e.target.value)
                      setValidationError(null)
                    }}
                    maxLength={240}
                    rows={2}
                    className="resize-none border-amber-500/30 bg-slate-900/80 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:ring-amber-400/20"
                  />
                  <p className="text-[10px] text-slate-400">
                    If 15+ verified citizens identify missing axes, Valerie&apos;s cluster engine spawns a follow-up 4-axis poll.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error Message */}
            {(validationError || error) && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/50 p-2.5 text-xs text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{validationError || error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-1 border-t border-slate-800/80">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isSubmitting}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSubmit}
                disabled={isSubmitting || !selectedReason}
                className={cn(
                  "cursor-pointer rounded-lg px-4 text-xs font-bold shadow-md transition-all",
                  "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:opacity-95 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                )}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                    Submitting Challenge...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Record Premise Challenge
                  </span>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
