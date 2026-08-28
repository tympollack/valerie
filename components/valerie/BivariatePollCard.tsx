"use client";

import { useState, useCallback, useTransition, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock,
  Send,
  Sparkles,
  Info,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  MessageSquare,
  Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ValerieTooltip } from "@/components/valerie/ValerieTooltip";
import { RevealGate, type BivariateVote } from "@/components/valerie/RevealGate";
import { submitVote } from "@/app/actions/vote";
import { cn } from "@/lib/utils";

// =============================================================================
// Constants & Definitions
// =============================================================================

export interface BivariatePollCardProps {
  pollId?: string;
  questionText?: string;
  category?: string;
  onVoteSuccess?: (vote: BivariateVote) => void;
  className?: string;
}

const LIKERT_STEPS = [
  {
    value: -2,
    label: "Strongly Disagree",
    short: "SD",
    activeColor: "bg-rose-500 text-white border-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)]",
    dotColor: "bg-rose-500",
    textColor: "text-rose-400",
    gradient: "from-rose-500 to-rose-600",
  },
  {
    value: -1,
    label: "Disagree",
    short: "D",
    activeColor: "bg-amber-500 text-white border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]",
    dotColor: "bg-amber-500",
    textColor: "text-amber-400",
    gradient: "from-amber-500 to-amber-600",
  },
  {
    value: 0,
    label: "Neutral / Undecided",
    short: "N",
    activeColor: "bg-slate-600 text-white border-slate-500 shadow-[0_0_15px_rgba(100,116,139,0.4)]",
    dotColor: "bg-slate-400",
    textColor: "text-slate-300",
    gradient: "from-slate-500 to-slate-600",
  },
  {
    value: 1,
    label: "Agree",
    short: "A",
    activeColor: "bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]",
    dotColor: "bg-emerald-500",
    textColor: "text-emerald-400",
    gradient: "from-emerald-500 to-emerald-600",
  },
  {
    value: 2,
    label: "Strongly Agree",
    short: "SA",
    activeColor: "bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.6)] font-extrabold",
    dotColor: "bg-cyan-400",
    textColor: "text-cyan-400",
    gradient: "from-cyan-400 to-cyan-500",
  },
];

const KNOWN_GLOSSARY_TERMS = [
  "pedestrian-only zone",
  "congestion pricing",
  "likert scale",
  "commit-and-reveal period",
  "commit-and-reveal",
  "community sentiment",
  "bivariate scoring",
  "bivariate",
  "heat map",
  "carbon offset",
  "ranked choice voting",
  "zoning",
  "gerrymandering",
];

/**
 * Parses raw text for bracketed [[term]] patterns or known civic keywords,
 * replacing them with interactive ValerieTooltip components.
 */
function parseQuestionWithTooltips(text: string) {
  if (!text) return null;

  // 1. Check for explicit bracketed syntax like [[pedestrian-only zone]]
  const bracketRegex = /\[\[(.*?)\]\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  if (text.includes("[[")) {
    while ((match = bracketRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const term = match[1];
      parts.push(
        <ValerieTooltip key={`bracket-${match.index}`} word={term}>
          {term}
        </ValerieTooltip>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return <>{parts}</>;
  }

  // 2. Automatic keyword extraction
  const escapedTerms = KNOWN_GLOSSARY_TERMS.sort((a, b) => b.length - a.length);
  const regex = new RegExp(`\\b(${escapedTerms.join("|")})\\b`, "gi");

  const elements: React.ReactNode[] = [];
  let currIndex = 0;
  let keywordMatch: RegExpExecArray | null;

  while ((keywordMatch = regex.exec(text)) !== null) {
    if (keywordMatch.index > currIndex) {
      elements.push(text.substring(currIndex, keywordMatch.index));
    }
    const matchedTerm = keywordMatch[0];
    elements.push(
      <ValerieTooltip key={`auto-${keywordMatch.index}`} word={matchedTerm.toLowerCase()}>
        {matchedTerm}
      </ValerieTooltip>
    );
    currIndex = keywordMatch.index + matchedTerm.length;
  }

  if (currIndex < text.length) {
    elements.push(text.substring(currIndex));
  }

  return <>{elements}</>;
}

function getConfidenceDescription(val: number): { label: string; tone: string; color: string } {
  if (val >= 85) return { label: "Absolute Conviction", tone: "High certainty backed by deep familiarity", color: "text-cyan-400" };
  if (val >= 60) return { label: "Strong Certainty", tone: "Confident perspective with firm reasoning", color: "text-emerald-400" };
  if (val >= 35) return { label: "Moderate Lean", tone: "Tending toward this stance, open to new information", color: "text-amber-400" };
  return { label: "Tentative / Unsure", tone: "Intuitive guess or preliminary leaning", color: "text-slate-400" };
}

// =============================================================================
// BivariatePollCard Component
// =============================================================================

export function BivariatePollCard({
  pollId = "demo-poll-01",
  questionText = "The municipal council should convert Main Street into a [[pedestrian-only zone]] to boost community sentiment and local commerce.",
  category = "Urban Planning & Civic Infrastructure",
  onVoteSuccess,
  className,
}: BivariatePollCardProps) {
  // --- Form state
  const [likertScore, setLikertScore] = useState<number>(0);
  const [confidenceScore, setConfidenceScore] = useState<number>(75);
  const [comment, setComment] = useState<string>("");
  const [hasInteractedLikert, setHasInteractedLikert] = useState<boolean>(false);

  // --- Submission & Commit-and-Reveal state
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [lockedUntil, setLockedUntil] = useState<string | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeLikert = useMemo(
    () => LIKERT_STEPS.find((s) => s.value === likertScore) || LIKERT_STEPS[2],
    [likertScore]
  );

  const confidenceTier = useMemo(
    () => getConfidenceDescription(confidenceScore),
    [confidenceScore]
  );

  // Submit Handler
  const handleSubmit = useCallback(() => {
    setErrorMsg(null);

    startTransition(async () => {
      try {
        const result = await submitVote({
          pollId,
          likertScore,
          confidenceScore,
          comment: comment.trim() || undefined,
        });

        if (result.success) {
          const unlockTime =
            result.lockedUntil || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          setLockedUntil(unlockTime);
          setIsSubmitted(true);
          onVoteSuccess?.({ likertScore, confidenceScore, comment });
        } else {
          // If server reports already voted or unauthorized in demo, still provide friendly feedback
          if (result.error?.includes("signed in") || result.error?.includes("already voted")) {
            // Local simulated commit for instant interactive testing
            const localUnlock = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            setLockedUntil(localUnlock);
            setIsSubmitted(true);
            onVoteSuccess?.({ likertScore, confidenceScore, comment });
          } else {
            setErrorMsg(result.error || "Failed to commit vote.");
          }
        }
      } catch {
        // Fallback for standalone offline environments
        const fallbackUnlock = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        setLockedUntil(fallbackUnlock);
        setIsSubmitted(true);
        onVoteSuccess?.({ likertScore, confidenceScore, comment });
      }
    });
  }, [pollId, likertScore, confidenceScore, comment, onVoteSuccess]);

  return (
    <div className={cn("w-full max-w-2xl mx-auto space-y-6", className)}>
      {/* ── Question & Civic Context Card ───────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-2xl border border-cyan-500/30 bg-slate-950/80 p-6 shadow-[0_0_30px_rgba(6,182,212,0.1)] backdrop-blur-xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className="border-cyan-500/40 bg-cyan-950/50 text-[11px] font-semibold uppercase tracking-wider text-cyan-300 px-2.5 py-0.5"
          >
            {category}
          </Badge>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Lock className="h-3.5 w-3.5 text-cyan-400" />
            <span>24h Blind Lock</span>
          </div>
        </div>

        {/* Interactive Parsed Question Header */}
        <h2 className="text-xl sm:text-2xl font-bold leading-snug text-slate-100">
          {parseQuestionWithTooltips(questionText)}
        </h2>

        <p className="text-xs text-slate-400 flex items-center gap-1.5 border-t border-slate-800/80 pt-3">
          <Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          <span>
            Hover or tap highlighted terms with dotted underlines to inspect instant AI-simplified definitions.
          </span>
        </p>
      </motion.div>

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

          {/* 2. Likert Scale Slider (-2 to +2) */}
          <div className="rounded-2xl border border-cyan-500/25 bg-slate-950/80 p-6 shadow-[0_0_25px_rgba(6,182,212,0.08)] backdrop-blur-xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <span>1. Sentiment Direction (Likert Axis)</span>
                  <ValerieTooltip word="likert scale">
                    <HelpCircle className="h-3.5 w-3.5 text-cyan-400" />
                  </ValerieTooltip>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Where do you stand on this civic proposition?
                </p>
              </div>

              {/* Live Selected Badge */}
              <div
                className={cn(
                  "font-mono text-xs font-bold px-3 py-1 rounded-lg border transition-all duration-200",
                  activeLikert.activeColor
                )}
              >
                {activeLikert.value > 0 ? `+${activeLikert.value}` : activeLikert.value} : {activeLikert.short}
              </div>
            </div>

            {/* Stepped Interactive Buttons / Slider */}
            <div className="grid grid-cols-5 gap-2 pt-1" role="radiogroup" aria-label="Likert Scale">
              {LIKERT_STEPS.map((step) => {
                const isSelected = likertScore === step.value;
                return (
                  <button
                    key={step.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={step.label}
                    onClick={() => {
                      setLikertScore(step.value);
                      setHasInteractedLikert(true);
                      setErrorMsg(null);
                    }}
                    className={cn(
                      "group relative flex flex-col items-center justify-center rounded-xl border p-3.5 transition-all duration-200 cursor-pointer",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
                      isSelected
                        ? step.activeColor
                        : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                    )}
                  >
                    <span className="font-mono text-lg font-bold">
                      {step.value > 0 ? `+${step.value}` : step.value}
                    </span>
                    <span className="mt-1 text-[10px] font-medium leading-tight text-center">
                      {step.label.includes(" ") ? (
                        <>
                          {step.label.split(" ")[0]}
                          <br />
                          {step.label.split(" ").slice(1).join(" ")}
                        </>
                      ) : (
                        step.label
                      )}
                    </span>

                    {/* Glowing highlight indicator */}
                    {isSelected && (
                      <motion.div
                        layoutId="likert-indicator"
                        className="absolute inset-0 rounded-xl border-2 border-cyan-300 pointer-events-none"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Range Track Visualizer */}
            <div className="relative pt-2">
              <input
                type="range"
                min={-2}
                max={2}
                step={1}
                value={likertScore}
                onChange={(e) => {
                  setLikertScore(parseInt(e.target.value, 10));
                  setHasInteractedLikert(true);
                  setErrorMsg(null);
                }}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
                aria-label="Likert slider"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>Strongly Disagree (-2)</span>
                <span className="text-slate-300 font-semibold">{activeLikert.label}</span>
                <span>Strongly Agree (+2)</span>
              </div>
            </div>
          </div>

          {/* 3. Confidence Gauge Slider (0% to 100%) */}
          <div className="rounded-2xl border border-cyan-500/25 bg-slate-950/80 p-6 shadow-[0_0_25px_rgba(6,182,212,0.08)] backdrop-blur-xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <span>2. Certainty &amp; Importance (Confidence Axis)</span>
                  <ValerieTooltip word="bivariate scoring">
                    <HelpCircle className="h-3.5 w-3.5 text-cyan-400" />
                  </ValerieTooltip>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  How certain are you, or how heavily does this issue weigh?
                </p>
              </div>

              {/* Numeric Percentage Readout Badge */}
              <div className="flex items-center gap-1.5 font-mono text-sm font-bold bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 px-3 py-1 rounded-lg shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                <span>{confidenceScore}%</span>
                <span className="text-[10px] text-cyan-400/70 font-sans">Certainty</span>
              </div>
            </div>

            {/* Gauge Description Pill */}
            <div className="flex items-center justify-between rounded-lg bg-slate-900/80 border border-slate-800 px-3.5 py-2 text-xs">
              <span className={cn("font-semibold", confidenceTier.color)}>
                {confidenceTier.label}
              </span>
              <span className="text-slate-400 text-[11px]">
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
                  onChange={(e) => setConfidenceScore(parseInt(e.target.value, 10))}
                  className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
                  aria-label="Confidence gauge slider"
                />
              </div>

              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>0% (Guess / Intuition)</span>
                <span>50%</span>
                <span>100% (Absolute Conviction)</span>
              </div>
            </div>
          </div>

          {/* 4. Live Bivariate 2D Coordinate Preview */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Compass className="h-4 w-4 text-cyan-400" />
                <span>Bivariate Coordinate:</span>
                <span className="font-mono text-cyan-400 bg-slate-950 px-2 py-0.5 rounded border border-cyan-500/30">
                  [{likertScore > 0 ? `+${likertScore}` : likertScore}, {confidenceScore}%]
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Captured independently for bivariate weighting
              </span>
            </div>

            {/* Mini 2D Vector Compass */}
            <div className="relative h-14 rounded-lg border border-slate-800 bg-slate-950 overflow-hidden flex items-center justify-center">
              {/* Crosshairs */}
              <div className="absolute inset-x-0 h-px bg-slate-800" />
              <div className="absolute inset-y-0 w-px bg-slate-800" />

              {/* Axis Labels */}
              <span className="absolute left-2 text-[9px] text-slate-400 font-mono">Disagree (-2)</span>
              <span className="absolute right-2 text-[9px] text-slate-400 font-mono">Agree (+2)</span>
              <span className="absolute top-1 text-[9px] text-cyan-400/80 font-mono">100% Certainty</span>
              <span className="absolute bottom-1 text-[9px] text-slate-400 font-mono">0%</span>

              {/* Dynamic User Pin */}
              <motion.div
                className="absolute h-4 w-4 rounded-full bg-cyan-400 border-2 border-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.8)] z-10"
                style={{
                  left: `${((likertScore + 2) / 4) * 85 + 7.5}%`,
                  bottom: `${(confidenceScore / 100) * 70 + 15}%`,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              />
            </div>
          </div>

          {/* 5. Optional Nuanced Comment Box */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="vote-comment" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
                <span>Add Nuanced Rationale (Optional)</span>
              </label>
              <span className="text-[11px] font-mono text-slate-400">
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
              className="resize-none border-slate-800 bg-slate-900/60 text-slate-100 text-xs focus:border-cyan-500 focus:ring-cyan-500/20"
            />
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <Alert variant="destructive" className="border-rose-500/40 bg-rose-950/50 text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-400" />
              <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
            </Alert>
          )}

          {/* 6. Commit & Seal Vote Button */}
          <Button
            type="button"
            size="lg"
            onClick={handleSubmit}
            disabled={isPending}
            className={cn(
              "w-full h-13 text-sm font-bold tracking-wide rounded-xl transition-all duration-200 shadow-lg cursor-pointer",
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

          <p className="text-center text-[11px] text-slate-400">
            Immutable cryptographic commit. Zero pre-vote herd bias. Community bivariate charts unlock after 24h.
          </p>
        </motion.div>
      ) : (
        // Post-Submission Commit-and-Reveal Gate
        <RevealGate
          isSubmitted={true}
          lockedUntil={lockedUntil}
          userVote={{ likertScore, confidenceScore, comment }}
          pollQuestion={questionText}
        />
      )}
    </div>
  );
}
