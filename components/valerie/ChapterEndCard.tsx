"use client";

/**
 * Project Valerie: Cadence Chapter End Off-Ramp Card
 * File: components/valerie/ChapterEndCard.tsx
 * Work Item: [TASK-VAL-UI-PACKET-FLOW] / [STORY-VAL-CLUSTER-SURGE]
 *
 * Provides a clean, satisfying cognitive off-ramp when a voter completes
 * a 3-axis deliberation packet, preventing infinite doomscrolling.
 */

import React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Lock, ShieldCheck, ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { VotaryEmblem } from "@/components/brand/VotaryEmblem";
import { cn } from "@/lib/utils";

export interface ChapterEndCardProps {
  message?: string;
  totalCompleted?: number;
  pollId?: string;
  resultsHref?: string;
  onResetSession?: () => void;
  className?: string;
}

export function ChapterEndCard({
  message = "You have weighed in on all active measures in this district today. Your voice is sealed.",
  totalCompleted = 3,
  pollId,
  resultsHref,
  onResetSession,
  className,
}: ChapterEndCardProps) {
  const destinationHref = resultsHref || (pollId ? `/poll/${pollId}` : "/polls");
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 260,
        damping: 24,
      }}
      className={cn(
        "relative mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-emerald-500/30 bg-slate-950/90 p-8 text-center shadow-[0_0_50px_rgba(16,185,129,0.12)] backdrop-blur-2xl",
        className
      )}
      data-testid="chapter-end-card"
    >
      {/* Background ambient radial glow */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-gradient-to-b from-emerald-500/15 via-cyan-500/10 to-transparent blur-3xl" />

      {/* Emblem & Verified Seal */}
      <div className="relative z-10 flex flex-col items-center space-y-4">
        <div className="relative">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-950/60 text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.25)]">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/50 bg-slate-950 text-cyan-400">
            <Lock className="h-3 w-3" />
          </div>
        </div>

        <div className="space-y-1.5 max-w-md">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 text-[11px] font-semibold text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Civic Packet Complete • {totalCompleted} Measures Sealed</span>
          </div>

          <h2 className="text-xl font-bold tracking-tight text-slate-100 sm:text-2xl pt-2">
            District Deliberation Complete
          </h2>

          <p className="text-xs text-slate-300 leading-relaxed pt-1">
            {message}
          </p>
        </div>

        {/* Informational Pillars */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg pt-4 text-left">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-400">Lockbox Status</div>
            <div className="text-xs font-semibold text-emerald-400 mt-0.5">Sealed 24h</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-400">Herd Bias Guard</div>
            <div className="text-xs font-semibold text-cyan-400 mt-0.5">100% Blind Commit</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-[10px] font-mono uppercase text-slate-400">Constituent Power</div>
            <div className="text-xs font-semibold text-slate-200 mt-0.5">Dual-Axis Weighted</div>
          </div>
        </div>

        {/* Primary Navigation Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md pt-5">
          <Link href={destinationHref} className="w-full sm:w-auto flex-1">
            <Button
              className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-slate-950 font-bold text-xs tracking-wide shadow-lg hover:opacity-95 cursor-pointer"
            >
              <span>Explore Community Results</span>
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </Link>

          {onResetSession && (
            <Button
              variant="outline"
              onClick={onResetSession}
              className="w-full sm:w-auto h-11 rounded-xl border border-slate-800 bg-slate-900/60 px-4 text-xs font-semibold text-slate-300 hover:text-slate-100 hover:border-slate-700 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
              <span>Review Packet</span>
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
