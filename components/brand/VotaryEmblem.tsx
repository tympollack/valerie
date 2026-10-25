import React from "react"
import { cn } from "@/lib/utils"

export interface VotaryEmblemProps extends React.SVGProps<SVGSVGElement> {
  size?: number
  className?: string
}

export function VotaryEmblem({
  size = 36,
  className,
  ...props
}: VotaryEmblemProps) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-xl bg-slate-950 border border-cyan-500/40 p-1.5 shadow-[0_0_15px_rgba(6,182,212,0.35)] transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.55)]",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
        role="img"
        aria-label="The Votary Emblem"
        {...props}
      >
        <defs>
          <linearGradient id="votary-cyan-glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="50%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
          <linearGradient id="votary-interlock-grad" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <radialGradient id="votary-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity="1" />
            <stop offset="60%" stopColor="#06b6d4" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#083344" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer Rotary Dial / Calibration Ring with Mechanical Ticks */}
        <circle
          cx="24"
          cy="24"
          r="21"
          stroke="url(#votary-cyan-glow)"
          strokeWidth="1.2"
          strokeDasharray="2.5 3.5"
          className="opacity-75"
        />

        {/* Primary Rotary Outer Track */}
        <circle
          cx="24"
          cy="24"
          r="17"
          stroke="#0e7490"
          strokeWidth="1"
          className="opacity-40"
        />

        {/* First Interlocking Ballot Ring (Tilted -35deg) */}
        <ellipse
          cx="24"
          cy="24"
          rx="15"
          ry="7.5"
          transform="rotate(-35 24 24)"
          stroke="url(#votary-cyan-glow)"
          strokeWidth="2"
          strokeLinecap="round"
          className="opacity-95"
        />

        {/* Second Interlocking Ballot Ring (Tilted +35deg) */}
        <ellipse
          cx="24"
          cy="24"
          rx="15"
          ry="7.5"
          transform="rotate(35 24 24)"
          stroke="url(#votary-interlock-grad)"
          strokeWidth="2"
          strokeLinecap="round"
          className="opacity-95"
        />

        {/* Interlocking Intersection Nodes (Mechanical Ballot Rivets) */}
        <circle cx="24" cy="11.5" r="1.5" fill="#a5f3fc" />
        <circle cx="24" cy="36.5" r="1.5" fill="#a5f3fc" />
        <circle cx="11.5" cy="24" r="1.2" fill="#38bdf8" />
        <circle cx="36.5" cy="24" r="1.2" fill="#38bdf8" />

        {/* Inner Deliberative Core (Rotary Hub) */}
        <circle cx="24" cy="24" r="5" fill="url(#votary-core-glow)" />
        <circle
          cx="24"
          cy="24"
          r="3"
          fill="#083344"
          stroke="#22d3ee"
          strokeWidth="1.5"
        />
        <circle cx="24" cy="24" r="1.2" fill="#ecfeff" />
      </svg>
    </div>
  )
}
