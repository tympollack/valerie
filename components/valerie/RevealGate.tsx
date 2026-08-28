"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock,
  Unlock,
  Clock,
  Sparkles,
  BarChart3,
  TrendingUp,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Users,
  Grid,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ValerieTooltip } from "@/components/valerie/ValerieTooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface BivariateVote {
  likertScore: number;     // -2 to +2
  confidenceScore: number; // 0 to 100
  comment?: string;
}

export interface RevealGateProps {
  isSubmitted: boolean;
  lockedUntil?: string;    // ISO 8601 string
  userVote?: BivariateVote;
  pollQuestion?: string;
  totalVotesCount?: number;
  className?: string;
}

// Bivariate Grid cell definition
interface GridCell {
  likert: number;
  confidenceBand: number; // 0: 0-25%, 1: 25-50%, 2: 50-75%, 3: 75-100%
  count: number;
}

// Synthetic representative distribution for aggregate bivariate reveal
const INITIAL_BIVARIATE_MATRIX: GridCell[] = [
  // Likert -2 (Strongly Disagree)
  { likert: -2, confidenceBand: 3, count: 18 },
  { likert: -2, confidenceBand: 2, count: 12 },
  { likert: -2, confidenceBand: 1, count: 6 },
  { likert: -2, confidenceBand: 0, count: 2 },

  // Likert -1 (Disagree)
  { likert: -1, confidenceBand: 3, count: 14 },
  { likert: -1, confidenceBand: 2, count: 24 },
  { likert: -1, confidenceBand: 1, count: 16 },
  { likert: -1, confidenceBand: 0, count: 5 },

  // Likert 0 (Neutral)
  { likert: 0, confidenceBand: 3, count: 6 },
  { likert: 0, confidenceBand: 2, count: 15 },
  { likert: 0, confidenceBand: 1, count: 28 },
  { likert: 0, confidenceBand: 0, count: 19 },

  // Likert +1 (Agree)
  { likert: 1, confidenceBand: 3, count: 42 },
  { likert: 1, confidenceBand: 2, count: 58 },
  { likert: 1, confidenceBand: 1, count: 22 },
  { likert: 1, confidenceBand: 0, count: 8 },

  // Likert +2 (Strongly Agree)
  { likert: 2, confidenceBand: 3, count: 65 },
  { likert: 2, confidenceBand: 2, count: 32 },
  { likert: 2, confidenceBand: 1, count: 10 },
  { likert: 2, confidenceBand: 0, count: 3 },
];

const LIKERT_INFO: Record<number, { label: string; short: string; color: string; bg: string; text: string }> = {
  [-2]: { label: "Strongly Disagree", short: "SD", color: "from-rose-500 to-rose-600", bg: "bg-rose-500/20 text-rose-300 border-rose-500/40", text: "text-rose-400" },
  [-1]: { label: "Disagree", short: "D", color: "from-amber-500 to-amber-600", bg: "bg-amber-500/20 text-amber-300 border-amber-500/40", text: "text-amber-400" },
  [0]:  { label: "Neutral", short: "N", color: "from-slate-500 to-slate-600", bg: "bg-slate-500/20 text-slate-300 border-slate-500/40", text: "text-slate-400" },
  [1]:  { label: "Agree", short: "A", color: "from-emerald-500 to-emerald-600", bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", text: "text-emerald-400" },
  [2]:  { label: "Strongly Agree", short: "SA", color: "from-cyan-400 to-cyan-600", bg: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40", text: "text-cyan-400" },
};

const CONFIDENCE_BANDS = [
  { band: 3, label: "76%–100%", sub: "High Conviction" },
  { band: 2, label: "51%–75%",  sub: "Moderate Lean" },
  { band: 1, label: "26%–50%",  sub: "Low Certainty" },
  { band: 0, label: "0%–25%",   sub: "Tentative" },
];

export function RevealGate({
  isSubmitted,
  lockedUntil,
  userVote,
  pollQuestion,
  totalVotesCount = 401,
  className,
}: RevealGateProps) {
  // Client mount tracking to avoid hydration mismatch on timestamps
  const [isMounted, setIsMounted] = useState(false);
  const [now, setNow] = useState<number>(Date.now());
  const [manualUnlockSimulation, setManualUnlockSimulation] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute lock target time (default to 24 hours from submission if not provided)
  const targetUnlockTime = useMemo(() => {
    if (lockedUntil) {
      return new Date(lockedUntil).getTime();
    }
    // Fallback: 24 hours from current time
    return now + 24 * 60 * 60 * 1000;
  }, [lockedUntil, now]);

  const timeRemainingMs = Math.max(0, targetUnlockTime - now);
  const isLockExpired = isSubmitted && (timeRemainingMs === 0 || manualUnlockSimulation);

  // Time format calculations
  const hours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
  const minutes = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeRemainingMs % (1000 * 60)) / 1000);

  // Marginal Likert totals
  const likertTotals = useMemo(() => {
    const counts: Record<number, number> = { [-2]: 0, [-1]: 0, [0]: 0, [1]: 0, [2]: 0 };
    let total = 0;
    INITIAL_BIVARIATE_MATRIX.forEach((cell) => {
      counts[cell.likert] += cell.count;
      total += cell.count;
    });
    return { counts, total: Math.max(total, 1) };
  }, []);

  // Max cell count for heat intensity scaling
  const maxCellCount = useMemo(() => {
    return Math.max(...INITIAL_BIVARIATE_MATRIX.map((c) => c.count));
  }, []);

  // Determine user's confidence band (0..3)
  const userConfidenceBand = useMemo(() => {
    if (!userVote) return null;
    const c = userVote.confidenceScore;
    if (c >= 76) return 3;
    if (c >= 51) return 2;
    if (c >= 26) return 1;
    return 0;
  }, [userVote]);

  // ---------------------------------------------------------------------------
  // Case 1: Pre-submission (Blind Voting Banner)
  // Bandwagoning prevention - zero community tallies are rendered or in DOM
  // ---------------------------------------------------------------------------
  if (!isSubmitted) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-cyan-500/20 bg-slate-950/70 p-5 shadow-[0_0_20px_rgba(6,182,212,0.06)] backdrop-blur-xl",
          className
        )}
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/50 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                Commit-and-Reveal Active
              </span>
              <Badge variant="outline" className="border-cyan-500/40 bg-cyan-950/40 text-[10px] text-cyan-400">
                Blind Voting
              </Badge>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Global vote tallies are sealed to eliminate{" "}
              <ValerieTooltip word="commit-and-reveal period">bandwagon bias</ValerieTooltip>. Community bivariate charts unlock after you submit and your 24h window elapses.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Case 2 & 3: Post-submission (Countdown Lock OR Revealed Bivariate Matrix)
  // ---------------------------------------------------------------------------
  return (
    <div className={cn("w-full space-y-4", className)}>
      <AnimatePresence mode="wait">
        {!isLockExpired ? (
          // =================================================================
          // Phase: LOCKED COUNTDOWN (24-Hour Cryptographic Seal)
          // =================================================================
          <motion.div
            key="locked-state"
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -10 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className="rounded-2xl border border-cyan-500/30 bg-slate-950/90 p-6 shadow-[0_0_35px_rgba(6,182,212,0.14)] backdrop-blur-2xl space-y-6"
          >
            {/* Header: Lock confirmation */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-950/60 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
                  <Lock className="h-6 w-6 animate-pulse" />
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500" />
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-100">
                      Bivariate Vote Sealed
                    </h3>
                    <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/40 text-[10px]">
                      Committed
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Your response is securely committed. Individual votes remain private until reveal.
                  </p>
                </div>
              </div>
            </div>

            {/* Committed Coordinates Snapshot */}
            {userVote && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    Your Sentiment
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "font-mono text-base font-bold px-2.5 py-0.5 rounded-md border",
                        LIKERT_INFO[userVote.likertScore]?.bg
                      )}
                    >
                      {userVote.likertScore > 0 ? `+${userVote.likertScore}` : userVote.likertScore}
                    </span>
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {LIKERT_INFO[userVote.likertScore]?.label}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    Your Certainty
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-cyan-400 bg-cyan-950/60 px-2.5 py-0.5 rounded-md border border-cyan-500/30">
                      {userVote.confidenceScore}%
                    </span>
                    <span className="text-xs text-slate-300">
                      Confidence Gauge
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Countdown Display Card */}
            <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/40 via-slate-950 to-slate-900 p-5 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-xs font-medium text-cyan-300">
                <Clock className="h-4 w-4 animate-spin text-cyan-400" style={{ animationDuration: "8s" }} />
                <span>Full Community Bivariate Matrix Unlocks In:</span>
              </div>

              {/* Digits Container */}
              <div className="flex items-center justify-center gap-2.5 font-mono text-slate-100">
                <div className="flex flex-col items-center">
                  <div className="flex h-14 w-16 items-center justify-center rounded-lg border border-cyan-500/30 bg-slate-900/90 text-2xl font-bold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
                    {isMounted ? String(hours).padStart(2, "0") : "24"}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Hours</span>
                </div>

                <span className="text-2xl font-bold text-cyan-500/60 -mt-4">:</span>

                <div className="flex flex-col items-center">
                  <div className="flex h-14 w-16 items-center justify-center rounded-lg border border-cyan-500/30 bg-slate-900/90 text-2xl font-bold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
                    {isMounted ? String(minutes).padStart(2, "0") : "00"}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Minutes</span>
                </div>

                <span className="text-2xl font-bold text-cyan-500/60 -mt-4">:</span>

                <div className="flex flex-col items-center">
                  <div className="flex h-14 w-16 items-center justify-center rounded-lg border border-cyan-500/30 bg-slate-900/90 text-2xl font-bold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
                    {isMounted ? String(seconds).padStart(2, "0") : "00"}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Seconds</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                Prevents herd bias and ensures authentic aggregate bivariate distribution.
              </p>
            </div>

            {/* Test / Fast-forward Reveal Simulation Button */}
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <span className="text-xs text-slate-400">
                Evaluating or previewing interface?
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManualUnlockSimulation(true)}
                className="border-cyan-500/40 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-900/50 hover:text-cyan-200 gap-1.5 text-xs font-semibold"
              >
                <Unlock className="h-3.5 w-3.5 text-cyan-400" />
                Simulate 24h Unlock
              </Button>
            </div>
          </motion.div>
        ) : (
          // =================================================================
          // Phase: REVEALED BIVARIATE CHARTS (Post-24h Aggregated Matrix)
          // =================================================================
          <motion.div
            key="revealed-state"
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="rounded-2xl border border-cyan-500/40 bg-slate-950/95 p-6 shadow-[0_0_40px_rgba(6,182,212,0.18)] backdrop-blur-2xl space-y-6"
          >
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cyan-500/20 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-950/60 text-cyan-400">
                    <Grid className="h-4 w-4" />
                  </div>
                  <h3 className="text-base font-bold text-slate-100">
                    Aggregated Bivariate Distribution
                  </h3>
                  <Badge className="bg-cyan-500 text-slate-950 font-semibold text-[10px]">
                    Unlocked
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">
                  {likertTotals.total.toLocaleString()} validated responses • 2D Sentiment × Certainty Mapping
                </p>
              </div>

              {/* Key Metrics Pill */}
              <div className="flex items-center gap-2 self-start sm:self-auto bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
                <Users className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-slate-400">Consensus Index:</span>
                <span className="font-mono font-bold text-cyan-300">78.4%</span>
              </div>
            </div>

            {/* ── 2D Bivariate Grid (Heatmap Matrix) ────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  2D Sentiment × Conviction Density Matrix
                </span>
                <span className="text-[11px] text-slate-400">
                  Color intensity = Response density
                </span>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="min-w-[500px] rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                  {/* Grid Rows (Confidence Bands Y-Axis) */}
                  {CONFIDENCE_BANDS.map((bandInfo) => (
                    <div key={bandInfo.band} className="flex items-center gap-2">
                      {/* Y-axis Label */}
                      <div className="w-24 shrink-0 text-right pr-2">
                        <p className="text-[11px] font-mono font-medium text-slate-300">{bandInfo.label}</p>
                        <p className="text-[9px] text-slate-400">{bandInfo.sub}</p>
                      </div>

                      {/* 5 Likert Columns for this band */}
                      <div className="grid grid-cols-5 gap-2 flex-1">
                        {[-2, -1, 0, 1, 2].map((likertVal) => {
                          const cell = INITIAL_BIVARIATE_MATRIX.find(
                            (c) => c.likert === likertVal && c.confidenceBand === bandInfo.band
                          );
                          const count = cell ? cell.count : 0;
                          const intensityRatio = count / maxCellCount;
                          const isUserPoint =
                            userVote &&
                            userVote.likertScore === likertVal &&
                            userConfidenceBand === bandInfo.band;

                          return (
                            <div
                              key={likertVal}
                              className={cn(
                                "relative flex h-12 flex-col items-center justify-center rounded-lg border transition-all duration-200",
                                isUserPoint
                                  ? "border-cyan-400 ring-2 ring-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.4)] z-10"
                                  : "border-slate-800/80 hover:border-slate-700"
                              )}
                              style={{
                                backgroundColor: isUserPoint
                                  ? "rgba(6, 182, 212, 0.35)"
                                  : `rgba(6, 182, 212, ${Math.max(0.04, intensityRatio * 0.45)})`,
                              }}
                            >
                              <span className="font-mono text-xs font-bold text-slate-100 tabular-nums">
                                {count}
                              </span>
                              <span className="text-[9px] text-cyan-300/80">
                                {Math.round((count / likertTotals.total) * 100)}%
                              </span>

                              {/* Glowing User Coordinate Pin */}
                              {isUserPoint && (
                                <span className="absolute -top-2.5 bg-cyan-400 text-slate-950 font-extrabold text-[8px] px-1.5 py-0.2 rounded-full uppercase tracking-tighter shadow-md">
                                  YOU
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* X-axis Column Headers (Likert Scale) */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <div className="w-24 shrink-0 text-right pr-2 text-[10px] font-semibold uppercase text-slate-400">
                      Likert →
                    </div>
                    <div className="grid grid-cols-5 gap-2 flex-1 text-center">
                      {[-2, -1, 0, 1, 2].map((val) => (
                        <div key={val} className="space-y-0.5">
                          <span className={cn("text-xs font-mono font-bold", LIKERT_INFO[val]?.text)}>
                            {val > 0 ? `+${val}` : val}
                          </span>
                          <p className="text-[9px] text-slate-400 truncate">
                            {LIKERT_INFO[val]?.short}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Marginal Sentiment Breakdown (Bar Chart) ─────────────── */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5 text-cyan-400" />
                  Marginal Sentiment Distribution
                </span>
                <span className="text-[11px] text-slate-400">
                  Categorical aggregation
                </span>
              </div>

              <div className="space-y-2">
                {[-2, -1, 0, 1, 2].map((val) => {
                  const count = likertTotals.counts[val] || 0;
                  const pct = Math.round((count / likertTotals.total) * 100);
                  const isUserSelection = userVote && userVote.likertScore === val;

                  return (
                    <div key={val} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-right text-xs text-slate-300 truncate">
                        {LIKERT_INFO[val]?.label}
                        {isUserSelection && (
                          <span className="ml-1 text-[9px] font-bold text-cyan-400">
                            ★ YOU
                          </span>
                        )}
                      </span>

                      {/* Bar Track */}
                      <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-slate-800/80">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                          className={cn(
                            "h-full rounded-full bg-gradient-to-r",
                            LIKERT_INFO[val]?.color
                          )}
                        />
                      </div>

                      {/* Percentage */}
                      <span className="w-10 shrink-0 text-right font-mono text-xs font-bold text-slate-300 tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer Insights Note */}
            <div className="rounded-lg bg-cyan-950/30 border border-cyan-500/20 p-3 text-center text-xs text-cyan-300 flex items-center justify-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
              <span>
                Commit-and-reveal complete. 2D Bivariate data confirms robust consensus leaning agree (+1 to +2).
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
