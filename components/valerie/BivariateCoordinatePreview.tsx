"use client"

import React from "react"
import { motion } from "framer-motion"
import { Compass } from "lucide-react"

export interface BivariateCoordinatePreviewProps {
  likertScore: number
  confidenceScore: number
}

export function BivariateCoordinatePreview({
  likertScore,
  confidenceScore,
}: BivariateCoordinatePreviewProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Compass className="h-4 w-4 text-cyan-400" />
          <span>Bivariate Coordinate:</span>
          <span className="rounded border border-cyan-500/30 bg-slate-950 px-2 py-0.5 font-mono text-cyan-400">
            [{likertScore > 0 ? `+${likertScore}` : likertScore},{" "}
            {confidenceScore}%]
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          Captured independently for bivariate weighting
        </span>
      </div>

      {/* Mini 2D Vector Compass */}
      <div className="relative flex h-14 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        {/* Crosshairs */}
        <div className="absolute inset-x-0 h-px bg-slate-800" />
        <div className="absolute inset-y-0 w-px bg-slate-800" />

        {/* Axis Labels */}
        <span className="absolute left-2 font-mono text-[9px] text-slate-400">
          Disagree (-2)
        </span>
        <span className="absolute right-2 font-mono text-[9px] text-slate-400">
          Agree (+2)
        </span>
        <span className="absolute top-1 font-mono text-[9px] text-cyan-400/80">
          100% Certainty
        </span>
        <span className="absolute bottom-1 font-mono text-[9px] text-slate-400">
          0%
        </span>

        {/* Dynamic User Pin */}
        <motion.div
          className="absolute z-10 h-4 w-4 rounded-full border-2 border-slate-950 bg-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.8)]"
          style={{
            left: `${((likertScore + 2) / 4) * 85 + 7.5}%`,
            bottom: `${(confidenceScore / 100) * 70 + 15}%`,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        />
      </div>
    </div>
  )
}
