"use client"

import React from "react"
import { motion } from "framer-motion"
import { HelpCircle } from "lucide-react"
import { ValerieTooltip } from "@/components/valerie/ValerieTooltip"
import { LIKERT_STEPS, type LikertStep } from "@/lib/valerie/stanceNomenclature"
import { cn } from "@/lib/utils"

export interface LikertScaleInputProps {
  likertScore: number
  activeLikert: LikertStep
  onSelectLikert: (score: number) => void
}

export function LikertScaleInput({
  likertScore,
  activeLikert,
  onSelectLikert,
}: LikertScaleInputProps) {
  return (
    <div className="space-y-5 rounded-2xl border border-cyan-500/25 bg-slate-950/80 p-6 shadow-[0_0_25px_rgba(6,182,212,0.08)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <span>1. Sentiment Direction (Likert Axis)</span>
            <ValerieTooltip word="likert scale">
              <HelpCircle className="h-3.5 w-3.5 text-cyan-400" />
            </ValerieTooltip>
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Where do you stand on this civic proposition?
          </p>
        </div>

        {/* Live Selected Badge */}
        <div
          className={cn(
            "rounded-lg border px-3 py-1 font-mono text-xs font-bold transition-all duration-200",
            activeLikert.activeColor
          )}
        >
          {activeLikert.value > 0
            ? `+${activeLikert.value}`
            : activeLikert.value}{" "}
          : {activeLikert.short}
        </div>
      </div>

      {/* Stepped Interactive Buttons / Slider */}
      <div
        className="grid grid-cols-5 gap-2 pt-1"
        role="radiogroup"
        aria-label="Likert Scale"
      >
        {LIKERT_STEPS.map((step) => {
          const isSelected = likertScore === step.value
          return (
            <button
              key={step.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={step.label}
              onClick={() => onSelectLikert(step.value)}
              className={cn(
                "group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border p-3.5 transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none",
                isSelected
                  ? step.activeColor
                  : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
              )}
            >
              <span className="font-mono text-lg font-bold">
                {step.value > 0 ? `+${step.value}` : step.value}
              </span>
              <span className="mt-1 text-center text-[10px] leading-tight font-medium">
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
                  className="pointer-events-none absolute inset-0 rounded-xl border-2 border-cyan-300"
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 30,
                  }}
                />
              )}
            </button>
          )
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
          onChange={(e) => onSelectLikert(parseInt(e.target.value, 10))}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-cyan-400 focus:outline-none"
          aria-label="Likert slider"
        />
        <div className="mt-1 flex justify-between text-[11px] text-slate-400">
          <span>Strongly Disagree (-2)</span>
          <span className="font-semibold text-slate-300">
            {activeLikert.label}
          </span>
          <span>Strongly Agree (+2)</span>
        </div>
      </div>
    </div>
  )
}
