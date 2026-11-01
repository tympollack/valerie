"use client";

/**
 * Project Valerie: Packet Progression Transition Banner
 * File: components/valerie/PacketProgressBanner.tsx
 * Work Item: [TASK-VAL-UI-PACKET-FLOW] / [STORY-VAL-CLUSTER-SURGE]
 *
 * Renders the transitional callout banner connecting anchor and companion poll axes,
 * prompting the voter forward to the next sequential question in their district packet.
 */

import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Lock, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PacketProgressBannerProps {
  currentStep: number;
  totalSteps: number;
  nextPollTitle: string;
  onAdvance: () => void;
  isSurge?: boolean;
  className?: string;
}

export function PacketProgressBanner({
  currentStep,
  totalSteps,
  nextPollTitle,
  onAdvance,
  isSurge = false,
  className,
}: PacketProgressBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
      }}
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 shadow-lg backdrop-blur-xl transition-all",
        isSurge
          ? "border-amber-500/40 bg-amber-950/40 shadow-[0_0_30px_rgba(245,158,11,0.15)]"
          : "border-cyan-500/40 bg-cyan-950/40 shadow-[0_0_30px_rgba(6,182,212,0.15)]",
        className
      )}
      data-testid="packet-progress-banner"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
              isSurge
                ? "border-amber-500/40 bg-amber-900/50 text-amber-300"
                : "border-cyan-500/40 bg-cyan-900/50 text-cyan-300"
            )}
          >
            {isSurge ? <Zap className="h-4 w-4 animate-pulse" /> : <Lock className="h-4 w-4" />}
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[10px] font-mono font-bold uppercase tracking-wider",
                  isSurge ? "text-amber-300" : "text-cyan-300"
                )}
              >
                Ballot Enclosed in 24h Lockbox
              </span>
              <span className="text-[10px] text-slate-400">
                • Step {currentStep} of {totalSteps}
              </span>
            </div>

            <p className="text-xs font-semibold text-slate-100 truncate">
              {nextPollTitle}
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={onAdvance}
          className={cn(
            "h-9 px-4 shrink-0 rounded-xl text-xs font-bold tracking-wide shadow-md cursor-pointer transition-all hover:opacity-95",
            isSurge
              ? "bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 hover:shadow-[0_0_20px_rgba(245,158,11,0.4)]"
              : "bg-gradient-to-r from-cyan-400 to-teal-400 text-slate-950 hover:shadow-[0_0_20px_rgba(6,182,212,0.4)]"
          )}
        >
          <span>Continue</span>
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    </motion.div>
  );
}
