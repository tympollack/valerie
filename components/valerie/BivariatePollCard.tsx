"use client"

import { useState, useCallback, useTransition, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Lock,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  MessageSquare,
  Compass,
  ExternalLink,
  Flag,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ValerieTooltip } from "@/components/valerie/ValerieTooltip"
import { RevealGate, type BivariateVote } from "@/components/valerie/RevealGate"
import type { LocaleGranularity, LocaleSentimentRecord } from "@/app/actions/valerieLocaleActions"
import { PremiseChallengeDrawer } from "@/components/valerie/PremiseChallengeDrawer"
import { castVote } from "@/app/actions/vote"
import { flagPollWithCommitGate, type FlagReason } from "@/app/actions/valerieFlagActions"
import type { UserContext } from "@/app/actions/auth"
import { usePollAuth } from "@/hooks/usePollAuth"
import {
  getStanceArchetype,
  getStanceArchetypeMeta,
  getRelativeWeightDescriptor,
  STANCE_BADGE_SPRING,
  LIKERT_STEPS,
  getConfidenceDescription,
} from "@/lib/valerie/stanceNomenclature"
import { parseQuestionWithTooltips } from "@/components/valerie/questionParser"
import { ChapterEndCard } from "@/components/valerie/ChapterEndCard"
import { PacketProgressBanner } from "@/components/valerie/PacketProgressBanner"
import { LikertScaleInput } from "@/components/valerie/LikertScaleInput"
import { BivariateCoordinatePreview } from "@/components/valerie/BivariateCoordinatePreview"
import { InlineVerificationGate } from "@/components/valerie/InlineVerificationGate"
import { cn } from "@/lib/utils"

// =============================================================================
// Constants & Definitions
// =============================================================================

export interface CompanionPollItem {
  id: string
  questionText?: string
  question_text?: string
  category?: string
  axis_category?: string
  [key: string]: any
}

export interface InitialVoteData {
  likertScore: number
  confidenceScore: number
  lockedUntil?: string | null
  comment?: string | null
}

export interface BivariatePollCardProps {
  pollId?: string
  questionText?: string
  category?: string
  companionPolls?: CompanionPollItem[]
  packetId?: string
  isSurge?: boolean
  initialVote?: InitialVoteData | null
  onPacketComplete?: () => void
  onVoteSuccess?: (vote: BivariateVote) => void
  onFlagSuccess?: (challenge: { flagReason: string; suggestedAxisComment?: string }) => void
  className?: string
  relatedEcosystemRefs?: Record<string, unknown> | null
  initialLocaleResults?: LocaleSentimentRecord[]
  initialGranularity?: LocaleGranularity
  detectedLocales?: string[]
  targetLocaleCode?: string
  historicalZScore?: number | null
  historicalBaseline?: { mean: number; stddev: number } | null
  userContext?: UserContext | null
}

// =============================================================================
// BivariatePollCard Component
// =============================================================================

export function BivariatePollCard({
  pollId = "",
  questionText = "",
  category = "Civic Deliberation",
  companionPolls,
  packetId,
  isSurge = false,
  initialVote,
  onPacketComplete,
  onVoteSuccess,
  onFlagSuccess,
  className,
  relatedEcosystemRefs,
  initialLocaleResults,
  initialGranularity,
  detectedLocales,
  targetLocaleCode,
  historicalZScore,
  historicalBaseline,
  userContext: userContextProp,
}: BivariatePollCardProps) {
  // --- Packet Sequence State
  const [activePacketIndex, setActivePacketIndex] = useState<number>(0)
  const [isPacketComplete, setIsPacketComplete] = useState<boolean>(false)

  const packetSequence = useMemo(() => {
    const list: CompanionPollItem[] = [
      {
        id: pollId,
        questionText,
        question_text: questionText,
        category,
        axis_category: category,
      },
    ]
    if (Array.isArray(companionPolls) && companionPolls.length > 0) {
      list.push(...companionPolls)
    }
    return list
  }, [pollId, questionText, category, companionPolls])

  const totalPacketPolls = packetSequence.length
  const hasCompanions = totalPacketPolls > 1
  const activePoll = packetSequence[activePacketIndex] || packetSequence[0]
  const currentPollId = activePoll?.id || pollId
  const currentQuestionText = activePoll?.questionText || activePoll?.question_text || questionText
  const currentCategory = activePoll?.category || activePoll?.axis_category || category

  const hasNextCompanion = hasCompanions && activePacketIndex < totalPacketPolls - 1
  const nextCompanion = hasNextCompanion ? packetSequence[activePacketIndex + 1] : null

  // --- Form state
  const [likertScore, setLikertScore] = useState<number>(initialVote?.likertScore ?? 0)
  const [confidenceScore, setConfidenceScore] = useState<number>(initialVote?.confidenceScore ?? 75)
  const [comment, setComment] = useState<string>(initialVote?.comment ?? "")
  const [hasInteractedLikert, setHasInteractedLikert] = useState<boolean>(Boolean(initialVote))

  // --- Submission & Commit-and-Reveal state
  const [isSubmitted, setIsSubmitted] = useState<boolean>(Boolean(initialVote))
  const [lockedUntil, setLockedUntil] = useState<string | undefined>(initialVote?.lockedUntil ?? undefined)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false)
  const [userChallenge, setUserChallenge] = useState<{
    flagReason: string
    suggestedAxisComment?: string
  } | null>(null)
  const [isFlagPending, startFlagTransition] = useTransition()
  const [returnUrl, setReturnUrl] = useState("")

  const handleAdvanceNextCompanion = useCallback(() => {
    if (activePacketIndex + 1 >= totalPacketPolls) {
      setIsPacketComplete(true)
      onPacketComplete?.()
      return
    }

    setActivePacketIndex((prev) => prev + 1)
    setIsSubmitted(false)
    setLikertScore(0)
    setConfidenceScore(75)
    setComment("")
    setHasInteractedLikert(false)
    setUserChallenge(null)
    setErrorMsg(null)
  }, [activePacketIndex, totalPacketPolls, onPacketComplete])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setReturnUrl(window.location.pathname + window.location.search + window.location.hash)
    }
  }, [])

  const effectiveUserContext = usePollAuth(userContextProp)
  const isUnverified = Boolean(
    (effectiveUserContext?.authenticated && !effectiveUserContext?.isHumanVerified) ||
      errorMsg?.toLowerCase().includes("verification")
  )
  const showInlineVerificationGate =
    !isSubmitted && isUnverified && (hasInteractedLikert || errorMsg !== null)

  const hubBaseUrl =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".sunshade.icu")
      ? "https://hub.sunshade.icu"
      : "https://hub.sunshade.icu"

  const currentHref =
    typeof window !== "undefined" ? window.location.href : returnUrl || "/"

  const callbackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback?return_to=${encodeURIComponent(returnUrl || "/")}`
      : "/auth/callback"

  const verifyUrl = `${hubBaseUrl}/login?redirect=${encodeURIComponent(callbackUrl)}&verify=true&redirectTo=${encodeURIComponent(currentHref)}`

  const activeLikert = useMemo(
    () => LIKERT_STEPS.find((s) => s.value === likertScore) || LIKERT_STEPS[2],
    [likertScore]
  )

  const confidenceTier = useMemo(
    () => getConfidenceDescription(confidenceScore),
    [confidenceScore]
  )

  const stanceArchetype = useMemo(
    () => getStanceArchetype(likertScore, confidenceScore),
    [likertScore, confidenceScore]
  )

  const stanceMeta = useMemo(
    () => getStanceArchetypeMeta(stanceArchetype),
    [stanceArchetype]
  )

  const dynamicZScore = useMemo(() => {
    if (historicalBaseline && historicalBaseline.stddev > 0) {
      return (confidenceScore - historicalBaseline.mean) / historicalBaseline.stddev
    }
    return historicalZScore ?? null
  }, [confidenceScore, historicalBaseline, historicalZScore])

  const relativeWeightSubtitle = useMemo(
    () => getRelativeWeightDescriptor(confidenceScore, dynamicZScore),
    [confidenceScore, dynamicZScore]
  )

  // Submit Handler
  const handleSubmit = useCallback(() => {
    setErrorMsg(null)

    startTransition(async () => {
      try {
        const result = await castVote({
          pollId: currentPollId,
          likertScore,
          confidenceScore,
          comment: comment.trim() || undefined,
        })

        if (result.success) {
          const unlockTime =
            result.lockedUntil ||
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          setLockedUntil(unlockTime)
          setIsSubmitted(true)
          onVoteSuccess?.({ likertScore, confidenceScore, comment })
          if ((hasCompanions || packetId) && activePacketIndex === totalPacketPolls - 1) {
            setIsPacketComplete(true)
            onPacketComplete?.()
          }
        } else {
          setErrorMsg(result.error || "Failed to commit vote.")
        }
      } catch (err) {
        let errorText =
          err instanceof Error
            ? err.message
            : "Failed to commit vote. Please try again."
        if (
          errorText.includes("Server Components render") ||
          errorText.includes("digest")
        ) {
          errorText =
            "An unexpected server error occurred while committing your vote. Please try again."
        }
        setErrorMsg(errorText)
      }
    })
  }, [
    currentPollId,
    likertScore,
    confidenceScore,
    comment,
    onVoteSuccess,
    hasCompanions,
    packetId,
    activePacketIndex,
    totalPacketPolls,
    onPacketComplete,
  ])

  // Premise Challenge Handler
  const handleChallengeSubmit = useCallback(
    (reason: FlagReason, missingAxisText?: string) => {
      setErrorMsg(null)

      startFlagTransition(async () => {
        try {
          const result = await flagPollWithCommitGate({
            pollId: currentPollId,
            flagReason: reason,
            suggestedAxisComment: missingAxisText,
          })

          if (result.success) {
            const unlockTime =
              result.lockedUntil ||
              new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            setLockedUntil(unlockTime)
            setUserChallenge({
              flagReason: reason,
              suggestedAxisComment: missingAxisText,
            })
            setIsSubmitted(true)
            setIsDrawerOpen(false)
            onFlagSuccess?.({
              flagReason: reason,
              suggestedAxisComment: missingAxisText,
            })
            if ((hasCompanions || packetId) && activePacketIndex === totalPacketPolls - 1) {
              setIsPacketComplete(true)
              onPacketComplete?.()
            }
          } else {
            setErrorMsg(result.error || "Failed to record premise challenge.")
          }
        } catch (err) {
          let errorText =
            err instanceof Error
              ? err.message
              : "Failed to record premise challenge. Please try again."
          if (
            errorText.includes("Server Components render") ||
            errorText.includes("digest")
          ) {
            errorText =
              "An unexpected server error occurred while recording your challenge. Please try again."
          }
          setErrorMsg(errorText)
        }
      })
    },
    [
      currentPollId,
      onFlagSuccess,
      hasCompanions,
      packetId,
      activePacketIndex,
      totalPacketPolls,
      onPacketComplete,
    ]
  )

  if (isPacketComplete) {
    return (
      <div className={cn("mx-auto w-full max-w-2xl", className)}>
        <ChapterEndCard
          message="You have weighed in on all active measures in this district today. Your voice is sealed."
          totalCompleted={totalPacketPolls}
          pollId={currentPollId || pollId}
        />
      </div>
    )
  }

  return (
    <div className={cn("mx-auto w-full max-w-2xl space-y-6", className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={`poll-card-${currentPollId}-${activePacketIndex}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="space-y-6"
        >
          {/* ── Question & Civic Context Card ───────────────────────────────── */}
          <div className="space-y-4 rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-6 shadow-[0_0_30px_rgba(6,182,212,0.1)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-cyan-500/40 bg-cyan-950/50 px-2.5 py-0.5 text-[11px] font-semibold tracking-wider text-cyan-300 uppercase"
                >
                  {currentCategory}
                </Badge>
                {hasCompanions && (
                  <Badge
                    data-testid="packet-step-badge"
                    variant="outline"
                    className="border-amber-500/40 bg-amber-950/50 px-2.5 py-0.5 text-[11px] font-semibold tracking-wider text-amber-300"
                  >
                    Step {activePacketIndex + 1} of {totalPacketPolls}
                  </Badge>
                )}
                {isSurge && (
                  <Badge
                    data-testid="packet-surge-badge"
                    variant="outline"
                    className="border-red-500/40 bg-red-950/50 px-2.5 py-0.5 text-[11px] font-semibold tracking-wider text-red-300 uppercase animate-pulse"
                  >
                    District Emergency Surge
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Lock className="h-3.5 w-3.5 text-cyan-400" />
                <span>24h Blind Lock</span>
              </div>
            </div>

            {/* Interactive Parsed Question Header */}
            <h2 className="text-xl leading-snug font-bold text-slate-100 sm:text-2xl">
              {parseQuestionWithTooltips(currentQuestionText)}
            </h2>

            <p className="flex items-center gap-1.5 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <span>
                Hover or tap highlighted terms with dotted underlines to inspect
                instant AI-simplified definitions.
              </span>
            </p>
          </div>

          {/* ── Bivariate Controls or Reveal Gate ───────────────────────────── */}
          {!isSubmitted ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="space-y-6"
            >
              {/* 1. Blind Voting Banner */}
              <RevealGate isSubmitted={false} />

              {/* Dynamic Civic Stance Archetype Pill */}
              <div className="flex h-14 items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/80 px-5 py-3 backdrop-blur-xl">
                <div className="flex items-center gap-2">
                  <Compass className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-300">
                    Civic Stance Archetype
                  </span>
                </div>

                <motion.div
                  layout
                  transition={STANCE_BADGE_SPRING}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-bold transition-all duration-200",
                    stanceMeta.badgeClassName
                  )}
                >
                  <motion.span
                    key={stanceArchetype}
                    initial={{ opacity: 0, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 2 }}
                    transition={{ duration: 0.15 }}
                    data-testid="stance-archetype-pill"
                  >
                    {stanceArchetype}
                  </motion.span>
                </motion.div>
              </div>

              {/* 2. Likert Scale Slider (-2 to +2) */}
              <LikertScaleInput
                likertScore={likertScore}
                activeLikert={activeLikert}
                onSelectLikert={(score) => {
                  setLikertScore(score)
                  setHasInteractedLikert(true)
                  setErrorMsg(null)
                }}
              />

              {/* 3. Confidence Gauge Slider (0% to 100%) */}
              <div className="space-y-5 rounded-2xl border border-cyan-500/25 bg-slate-950/80 p-6 shadow-[0_0_25px_rgba(6,182,212,0.08)] backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      <span>2. Certainty &amp; Importance (Confidence Axis)</span>
                      <ValerieTooltip word="bivariate scoring">
                        <HelpCircle className="h-3.5 w-3.5 text-cyan-400" />
                      </ValerieTooltip>
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      How certain are you, or how heavily does this issue weigh?
                    </p>
                  </div>

                  {/* Numeric Percentage Readout Badge */}
                  <div className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/70 px-3 py-1 font-mono text-sm font-bold text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                    <span>{confidenceScore}%</span>
                    <span className="font-sans text-[10px] text-cyan-400/70">
                      Certainty
                    </span>
                  </div>
                </div>

                {/* Gauge Description Pill */}
                <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-3.5 py-2 text-xs">
                  <span className={cn("font-semibold", confidenceTier.color)}>
                    {confidenceTier.label}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {confidenceTier.tone}
                  </span>
                </div>

                {/* Custom Glowing Slider Track */}
                <div className="space-y-2">
                  <div className="relative flex items-center">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={confidenceScore}
                      onChange={(e) =>
                        setConfidenceScore(parseInt(e.target.value, 10))
                      }
                      className="h-2.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-cyan-400 focus:outline-none"
                      aria-label="Confidence gauge slider"
                    />
                  </div>

                  <div className="flex justify-between font-mono text-[11px] text-slate-400">
                    <span>0% (Guess / Intuition)</span>
                    <span>50%</span>
                    <span>100% (Absolute Conviction)</span>
                  </div>
                </div>
              </div>

              {/* 4. Live Bivariate 2D Coordinate Preview */}
              <BivariateCoordinatePreview
                likertScore={likertScore}
                confidenceScore={confidenceScore}
              />

              {/* 5. Optional Nuanced Comment Box */}
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="vote-comment"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Add Nuanced Rationale (Optional)</span>
                  </label>
                  <span className="font-mono text-[11px] text-slate-400">
                    {comment.length}/500
                  </span>
                </div>

                <Textarea
                  id="vote-comment"
                  placeholder="Explain your reasoning or specific conditions for your vote..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="resize-none border-slate-800 bg-slate-900/60 text-xs text-slate-100 focus:border-cyan-500 focus:ring-cyan-500/20"
                />
              </div>

              {/* Error Alert */}
              {errorMsg && (
                <Alert
                  variant="destructive"
                  className="border-rose-500/40 bg-rose-950/50 text-rose-200"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <AlertDescription className="text-xs leading-relaxed">
                      {errorMsg}
                    </AlertDescription>
                    {errorMsg.toLowerCase().includes("verification") && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <a
                          href={verifyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950 shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-amber-300 focus:outline-none"
                        >
                          <span>Confirm Identity on Hub</span>
                          <ExternalLink className="h-3 w-3 text-slate-950" />
                        </a>
                        <Link
                          href="/settings"
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-900/30 px-2.5 py-1 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-900/50"
                        >
                          Account Status &amp; Settings
                        </Link>
                      </div>
                    )}
                    {errorMsg.toLowerCase().includes("signed in") && (
                      <div className="flex items-center gap-2 pt-1">
                        <a
                          href={`https://hub.sunshade.icu/login?redirect=${encodeURIComponent(callbackUrl)}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-cyan-500 px-2.5 py-1 text-xs font-bold text-slate-950 shadow-sm transition-colors hover:bg-cyan-400"
                        >
                          <span>Sign In with SunShade Hub</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </div>
                </Alert>
              )}

              {/* Premise Challenge Drawer */}
              <PremiseChallengeDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                onSubmit={handleChallengeSubmit}
                isSubmitting={isFlagPending}
                error={errorMsg}
              />

              {/* Inline Verification Action Gate for Unverified Users */}
              {showInlineVerificationGate && (
                <InlineVerificationGate verifyUrl={verifyUrl} />
              )}

              {/* 6. Primary Action Buttons: Vote Commit CTA & Premise Challenge Button */}
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <Button
                  type="button"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={isPending || isFlagPending}
                  className={cn(
                    "h-13 w-full sm:flex-1 cursor-pointer rounded-xl text-sm font-bold tracking-wide shadow-lg transition-all duration-200",
                    "bg-gradient-to-r from-cyan-500 via-teal-400 to-cyan-500 text-slate-950 hover:opacity-95 hover:shadow-[0_0_25px_rgba(6,182,212,0.4)]"
                  )}
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                      Sealing Cryptographic Vote...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      Commit &amp; Seal Bivariate Vote
                    </span>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    setIsDrawerOpen((prev) => !prev)
                    setErrorMsg(null)
                  }}
                  disabled={isPending || isFlagPending}
                  className={cn(
                    "h-13 w-full sm:w-auto cursor-pointer rounded-xl border border-slate-800 bg-slate-900/60 px-4 text-xs font-semibold text-slate-300 transition-all duration-200 hover:border-amber-500/40 hover:bg-slate-900 hover:text-amber-300",
                    isDrawerOpen && "border-amber-500/50 bg-amber-950/30 text-amber-300"
                  )}
                >
                  <Flag className="h-4 w-4 text-amber-400" />
                  <span>Challenge Premise / Framing</span>
                </Button>
              </div>

              {/* Contextual Subtitle Indicating Relative Weight */}
              <p className="text-center text-xs font-medium text-slate-400">
                Conviction Profile:{" "}
                <span
                  className={cn(
                    "font-semibold",
                    relativeWeightSubtitle === "Primary Personal Anchor"
                      ? "text-cyan-300"
                      : "text-slate-300"
                  )}
                  data-testid="stance-relative-weight"
                >
                  {relativeWeightSubtitle}
                </span>
              </p>

              <p className="text-center text-[11px] text-slate-400">
                Immutable cryptographic commit. Zero pre-vote herd bias. Community
                bivariate charts unlock after 24h.
              </p>
            </motion.div>
          ) : (
            // Post-Submission Commit-and-Reveal Gate with Sequential Progress Banner
            <div className="space-y-6">
              {hasNextCompanion && nextCompanion && (
                <PacketProgressBanner
                  currentStep={activePacketIndex + 1}
                  totalSteps={totalPacketPolls}
                  nextPollTitle={nextCompanion.questionText || nextCompanion.question_text || "Next District Measure"}
                  onAdvance={handleAdvanceNextCompanion}
                  isSurge={isSurge}
                />
              )}
              <RevealGate
                isSubmitted={true}
                lockedUntil={lockedUntil}
                userVote={userChallenge ? undefined : { likertScore, confidenceScore, comment }}
                userChallenge={userChallenge ?? undefined}
                isPremiseChallenge={Boolean(userChallenge)}
                flagReason={userChallenge?.flagReason}
                suggestedAxisComment={userChallenge?.suggestedAxisComment}
                pollQuestion={currentQuestionText}
                pollId={currentPollId}
                relatedEcosystemRefs={relatedEcosystemRefs}
                initialLocaleResults={initialLocaleResults}
                initialGranularity={initialGranularity}
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
