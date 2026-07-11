/**
 * Project Valerie: Bivariate Voting UI
 * File: components/voting/VotingCard.tsx
 *
 * This is the primary user-facing component for the MVP. It implements a
 * finite state machine with three phases:
 *
 *   "voting"     → User sees the form: Likert buttons + confidence slider + comment
 *   "submitting" → useTransition isPending: submit button shows spinner, form locked
 *   "sealed"     → Vote committed: form replaced by SealedResultsView
 *
 * BLIND VOTING (Commit-and-Reveal):
 *   The "Community Sentiment Distribution" panel is rendered ONLY inside
 *   SealedResultsView, which is only mounted after the server action succeeds.
 *   Before voting, the results section does not exist in the DOM — not hidden
 *   with CSS, actually absent — so there is no risk of dev-tools inspection
 *   revealing pre-vote community data.
 *
 *   The DB-level lock (locked_until = NOW()+24h) means even if a user
 *   inspects raw API responses, they cannot read others' individual votes
 *   until their own lock expires (enforced by RLS).
 *
 * BIVARIATE SCORING:
 *   Likert score (integer, -2..2) captures categorical sentiment direction.
 *   Confidence score (integer, 0..100) captures continuous certainty/importance.
 *   Both are stored separately in poll_responses for independent analysis.
 *
 * Props:
 *   pollId       — UUID of the poll from valerie.polls
 *   questionText — The prompt to display to the user
 *
 * Dependencies: shadcn/ui (Button, Slider, Textarea, Badge, Alert), lucide-react
 */

"use client";

import { useState, useCallback, useTransition } from "react";
import { submitVote, type VoteResult } from "@/app/actions/vote";
import { Button }   from "@/components/ui/button";
import { Slider }   from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge }    from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  Clock,
  Lock,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WordTooltip } from "@/components/voting/WordTooltip";

// =============================================================================
// Constants
// =============================================================================

/**
 * Project Valerie bivariate Likert scale definition.
 * Each entry maps an integer score to display labels and Tailwind color tokens
 * for both the selection state and the results bar chart.
 */
const LIKERT_OPTIONS = [
  {
    value:         -2 as const,
    label:         "Strongly Disagree",
    shortLabel:    "SD",
    selectedClass: "bg-rose-600 border-rose-700 text-white ring-2 ring-rose-300 ring-offset-1",
    hoverClass:    "hover:bg-rose-50 hover:border-rose-400 hover:text-rose-700 dark:hover:bg-rose-950/40",
    barClass:      "bg-rose-500",
    textClass:     "text-rose-600",
  },
  {
    value:         -1 as const,
    label:         "Disagree",
    shortLabel:    "D",
    selectedClass: "bg-orange-500 border-orange-600 text-white ring-2 ring-orange-300 ring-offset-1",
    hoverClass:    "hover:bg-orange-50 hover:border-orange-400 hover:text-orange-700 dark:hover:bg-orange-950/40",
    barClass:      "bg-orange-400",
    textClass:     "text-orange-600",
  },
  {
    value:         0 as const,
    label:         "Neutral",
    shortLabel:    "N",
    selectedClass: "bg-slate-500 border-slate-600 text-white ring-2 ring-slate-300 ring-offset-1",
    hoverClass:    "hover:bg-slate-50 hover:border-slate-400 hover:text-slate-700 dark:hover:bg-slate-800/60",
    barClass:      "bg-slate-400",
    textClass:     "text-slate-500",
  },
  {
    value:         1 as const,
    label:         "Agree",
    shortLabel:    "A",
    selectedClass: "bg-emerald-500 border-emerald-600 text-white ring-2 ring-emerald-300 ring-offset-1",
    hoverClass:    "hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 dark:hover:bg-emerald-950/40",
    barClass:      "bg-emerald-400",
    textClass:     "text-emerald-600",
  },
  {
    value:         2 as const,
    label:         "Strongly Agree",
    shortLabel:    "SA",
    selectedClass: "bg-emerald-700 border-emerald-800 text-white ring-2 ring-emerald-500 ring-offset-1",
    hoverClass:    "hover:bg-emerald-50 hover:border-emerald-500 hover:text-emerald-800 dark:hover:bg-emerald-950/40",
    barClass:      "bg-emerald-700",
    textClass:     "text-emerald-700",
  },
] as const;

/**
 * Mock community results for the MVP results panel.
 *
 * In production, replace with:
 *   const { data } = await supabase.rpc('get_poll_results', { p_poll_id: pollId })
 *
 * The valerie.get_poll_results() RPC (defined in the schema migration) returns
 * aggregate counts without exposing individual user votes, and applies the same
 * Commit-and-Reveal gate at the DB layer.
 */
const MOCK_COMMUNITY_RESULTS = [
  { value: -2, label: "Strongly Disagree", count: 14, barClass: "bg-rose-500"     },
  { value: -1, label: "Disagree",          count: 22, barClass: "bg-orange-400"   },
  { value:  0, label: "Neutral",           count: 31, barClass: "bg-slate-400"    },
  { value:  1, label: "Agree",             count: 58, barClass: "bg-emerald-400"  },
  { value:  2, label: "Strongly Agree",    count: 41, barClass: "bg-emerald-700"  },
] as const;

const TOTAL_MOCK_VOTES = MOCK_COMMUNITY_RESULTS.reduce((s, r) => s + r.count, 0);
const MAX_MOCK_COUNT   = Math.max(...MOCK_COMMUNITY_RESULTS.map((r) => r.count));

// =============================================================================
// Phase state type (explicit state machine, not boolean flags)
// =============================================================================

type VotingPhase =
  | { phase: "voting" }
  | { phase: "sealed"; lockedUntil: string; myLikert: number; myConfidence: number };

// =============================================================================
// Props
// =============================================================================

interface VotingCardProps {
  pollId:       string;
  questionText: string;
}

// =============================================================================
// VotingCard — root component
// =============================================================================

export function VotingCard({ pollId, questionText }: VotingCardProps) {
  // --- UI phase state machine
  const [votingPhase, setVotingPhase] = useState<VotingPhase>({ phase: "voting" });

  // --- Form state
  const [selectedLikert,  setSelectedLikert]  = useState<number | null>(null);
  const [confidence,      setConfidence]       = useState<number>(50);
  const [comment,         setComment]          = useState<string>("");
  const [formError,       setFormError]        = useState<string | null>(null);

  // useTransition provides an isPending flag and defers the async Server Action
  // without blocking UI interactions (e.g., the user can still read the question
  // while the vote is being written to Supabase).
  const [isPending, startTransition] = useTransition();

  // ---------------------------------------------------------------------------
  // Submit handler — calls the Server Action via useTransition
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(() => {
    if (selectedLikert === null) {
      setFormError("Please select a sentiment rating before submitting.");
      return;
    }
    setFormError(null);

    startTransition(async () => {
      const result: VoteResult = await submitVote({
        pollId,
        likertScore:     selectedLikert,
        confidenceScore: confidence,
        comment:         comment.trim() || undefined,
        // h3HexIndex: could be populated here from browser geolocation + H3 library
      });

      if (result.success && result.lockedUntil) {
        // Transition to the sealed phase — this unmounts the form and mounts
        // the results view. Community data is now safe to display.
        setVotingPhase({
          phase:        "sealed",
          lockedUntil:  result.lockedUntil,
          myLikert:     selectedLikert,
          myConfidence: confidence,
        });
      } else {
        setFormError(result.error ?? "An unexpected error occurred. Please try again.");
      }
    });
  }, [pollId, selectedLikert, confidence, comment]);

  // ---------------------------------------------------------------------------
  // Sealed phase — community results view
  // ---------------------------------------------------------------------------
  if (votingPhase.phase === "sealed") {
    return (
      <SealedResultsView
        lockedUntil={votingPhase.lockedUntil}
        myLikert={votingPhase.myLikert}
        myConfidence={votingPhase.myConfidence}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Voting phase — the form
  // ---------------------------------------------------------------------------
  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">

      {/* ── Poll question card ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Community Poll
        </p>
        <h2 className="text-xl font-semibold leading-snug text-card-foreground">
          {questionText}
        </h2>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3 flex-shrink-0" />
          Your vote is sealed for 24 hours before{" "}
          <WordTooltip word="community sentiment">
            community sentiment
          </WordTooltip>{" "}
          is revealed. Votes are immutable once submitted.
        </p>
      </div>

      {/* ── Likert scale ───────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-medium text-card-foreground">
            How strongly do you agree with this statement?
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Select a position on the{" "}
            <WordTooltip word="Likert scale">Likert scale</WordTooltip>.
          </p>
        </div>

        {/* Five Likert buttons — one per integer score (-2 to 2) */}
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Sentiment rating">
          {LIKERT_OPTIONS.map((option) => {
            const isSelected = selectedLikert === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={option.label}
                onClick={() => {
                  setSelectedLikert(option.value);
                  setFormError(null);
                }}
                className={cn(
                  // Base — shared across all states
                  "flex flex-col items-center justify-center rounded-lg border-2 py-3 px-1",
                  "text-center transition-all duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  // Unselected
                  !isSelected && [
                    "bg-background border-border text-foreground",
                    option.hoverClass,
                  ],
                  // Selected
                  isSelected && option.selectedClass,
                )}
              >
                <span className="text-lg font-bold leading-none tabular-nums">
                  {option.value > 0 ? `+${option.value}` : option.value}
                </span>
                <span className="mt-1.5 text-[10px] font-medium leading-tight">
                  {/* Break "Strongly Disagree" / "Strongly Agree" across two lines */}
                  {option.label.includes(" ") ? (
                    <>
                      {option.label.split(" ")[0]}
                      <br />
                      {option.label.split(" ").slice(1).join(" ")}
                    </>
                  ) : (
                    option.label
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected label readout for accessibility / clarity */}
        {selectedLikert !== null && (
          <p className="text-center text-xs text-muted-foreground animate-in fade-in-0 duration-150">
            Selected:{" "}
            <span className={cn(
              "font-semibold",
              LIKERT_OPTIONS.find((o) => o.value === selectedLikert)?.textClass,
            )}>
              {LIKERT_OPTIONS.find((o) => o.value === selectedLikert)?.label}
            </span>
          </p>
        )}
      </div>

      {/* ── Confidence slider ──────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-card-foreground">
              Confidence &amp; Importance
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How certain are you, or how important is this issue to you?
            </p>
          </div>
          {/* Live numeric readout of the slider value */}
          <Badge
            variant="secondary"
            className="font-mono text-sm tabular-nums px-3 py-1 flex-shrink-0"
          >
            {confidence}
            <span className="text-muted-foreground text-xs ml-0.5">/100</span>
          </Badge>
        </div>

        <div className="px-1 space-y-1.5">
          <Slider
            value={[confidence]}
            onValueChange={([val]) => setConfidence(val)}
            min={0}
            max={100}
            step={1}
            aria-label="Confidence or importance score"
            aria-valuetext={`${confidence} out of 100`}
            className="w-full"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Not sure (0)</span>
            <span>Very certain (100)</span>
          </div>
        </div>
      </div>

      {/* ── Optional comment ──────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-medium text-card-foreground">
            Add a comment{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Share your reasoning, nuance, or context. Comments are public after
            your{" "}
            <WordTooltip word="commit-and-reveal period">
              commit-and-reveal period
            </WordTooltip>
            {" "}expires.
          </p>
        </div>
        <Textarea
          placeholder="Explain your perspective…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={3}
          className="resize-none text-sm"
          aria-label="Optional comment"
        />
        <p className="text-right text-[11px] text-muted-foreground tabular-nums">
          {comment.length}&thinsp;/&thinsp;500
        </p>
      </div>

      {/* ── Form error ────────────────────────────────────────────────── */}
      {formError && (
        <Alert variant="destructive" className="animate-in fade-in-0 duration-200">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      {/* ── Submit button ─────────────────────────────────────────────── */}
      <Button
        type="button"
        size="lg"
        onClick={handleSubmit}
        disabled={selectedLikert === null || isPending}
        className="w-full h-12 text-base font-semibold"
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            Sealing your vote…
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Submit &amp; Seal Vote
          </span>
        )}
      </Button>

      <p className="pb-2 text-center text-[11px] text-muted-foreground">
        Votes are final once submitted. Results unlock after your 24-hour window.
      </p>
    </div>
  );
}

// =============================================================================
// SealedResultsView
//
// Mounted only after a successful vote submission — the Commit-and-Reveal
// "reveal" side. Shows the user's own committed vote alongside the community
// sentiment distribution.
//
// The results panel being conditionally rendered (not just hidden with CSS)
// is intentional: it cannot be revealed by toggling display:none in DevTools.
// =============================================================================

interface SealedResultsViewProps {
  lockedUntil:  string;    // ISO 8601 timestamp from the DB
  myLikert:     number;    // The user's own submitted score
  myConfidence: number;    // The user's own submitted confidence
}

function SealedResultsView({ lockedUntil, myLikert, myConfidence }: SealedResultsViewProps) {
  const lockedUntilDate = new Date(lockedUntil);
  const myOption        = LIKERT_OPTIONS.find((o) => o.value === myLikert);

  const formattedUnlockDate = lockedUntilDate.toLocaleDateString("en-US", {
    weekday: "long",
    month:   "long",
    day:     "numeric",
    hour:    "2-digit",
    minute:  "2-digit",
  });

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">

      {/* ── Confirmation banner ───────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/30">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">
              Vote sealed successfully
            </h3>
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
              Your response has been committed. Individual votes remain private
              during the{" "}
              <WordTooltip word="commit-and-reveal period">
                commit-and-reveal period
              </WordTooltip>
              .
            </p>
          </div>
        </div>
      </div>

      {/* ── My vote summary ───────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-medium text-card-foreground">Your Response</h3>

        <div className="flex items-center gap-4">
          {/* Score badge */}
          <div
            className={cn(
              "flex h-14 w-14 flex-shrink-0 items-center justify-center",
              "rounded-xl text-2xl font-bold text-white",
              myOption?.barClass ?? "bg-slate-400",
            )}
            aria-label={`Your score: ${myOption?.label}`}
          >
            {myLikert > 0 ? `+${myLikert}` : myLikert}
          </div>
          <div>
            <p className="font-semibold text-card-foreground">
              {myOption?.label ?? "Neutral"}
            </p>
            <p className="text-sm text-muted-foreground">
              Confidence:{" "}
              <span className="font-mono font-medium text-foreground">
                {myConfidence}
              </span>
              <span className="text-xs">/100</span>
            </p>
          </div>
        </div>

        {/* Unlock countdown chip */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-4 py-3">
          <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Full individual results unlock on{" "}
            <span className="font-medium text-foreground">{formattedUnlockDate}</span>
          </p>
        </div>
      </div>

      {/* ── Community sentiment distribution ──────────────────────────── */}
      {/* This panel is ONLY rendered post-vote — the core Commit-and-Reveal UI gate */}
      <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium text-card-foreground">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Community Sentiment Distribution
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {TOTAL_MOCK_VOTES.toLocaleString()} responses · aggregate view only
            </p>
          </div>
          <Badge variant="outline" className="flex-shrink-0 text-[10px]">
            LIVE
          </Badge>
        </div>

        {/*
         * Horizontal bar chart — pure Tailwind, no charting library.
         * Each bar's width is scaled to the max bar count (not total) so
         * the dominant category always fills the container.
         *
         * Production TODO: replace MOCK_COMMUNITY_RESULTS with data from
         * supabase.rpc('get_poll_results', { p_poll_id: pollId })
         */}
        <div className="space-y-2.5" role="list" aria-label="Community vote distribution">
          {MOCK_COMMUNITY_RESULTS.map((result) => {
            const pct         = Math.round((result.count / TOTAL_MOCK_VOTES) * 100);
            const barWidthPct = Math.round((result.count / MAX_MOCK_COUNT)   * 100);
            const isMyVote    = result.value === myLikert;

            return (
              <div
                key={result.value}
                role="listitem"
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-1 -mx-2 transition-colors",
                  isMyVote && "bg-muted/60 ring-1 ring-border",
                )}
              >
                {/* Label */}
                <span className="w-28 flex-shrink-0 text-right text-xs text-muted-foreground">
                  {result.label}
                  {isMyVote && (
                    <span className="ml-1 text-[9px] font-bold text-foreground">
                      ← YOU
                    </span>
                  )}
                </span>

                {/* Bar */}
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className={cn(
                      "h-full rounded transition-all duration-700 ease-out",
                      result.barClass,
                    )}
                    style={{ width: `${barWidthPct}%` }}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    role="progressbar"
                    aria-label={`${result.label}: ${pct}%`}
                  />
                </div>

                {/* Percentage */}
                <span className="w-9 flex-shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>

        <p className="border-t pt-3 text-center text-[10px] text-muted-foreground">
          ⚠️ Aggregate preview only. Individual breakdowns and geographic{" "}
          <WordTooltip word="heat map">heat map</WordTooltip> unlock after your
          24-hour window closes.
        </p>
      </div>

    </div>
  );
}
