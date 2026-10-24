/**
 * Civic Stance Matrix Nomenclature & Psychometric Lookups
 *
 * Maps bivariate coordinates (Likert [-2..+2], Confidence [0..100]) into the
 * 9-cell human civic vocabulary and provides visual design tokens (colors, glows,
 * spring configurations).
 */

export type StanceArchetype =
  | "Principled Dissent"
  | "Deliberate Equilibrium"
  | "Bedrock Conviction"
  | "Grounded Skepticism"
  | "Balanced Inquiry"
  | "Grounded Support"
  | "Provisional Concern"
  | "Agnostic Observer"
  | "Provisional Curiosity"

export type StanceCategory = "support" | "neutral" | "dissent"

export interface StanceArchetypeMeta {
  archetype: StanceArchetype
  category: StanceCategory
  confidenceBand: "high" | "mid" | "low"
  description: string
  // Color styling tokens following SunShade dark/cyan & glassmorphic design
  badgeClassName: string
  textColorClassName: string
  borderColorClassName: string
  bgClassName: string
  glowClassName: string
}

const STANCE_METADATA: Record<StanceArchetype, StanceArchetypeMeta> = {
  "Bedrock Conviction": {
    archetype: "Bedrock Conviction",
    category: "support",
    confidenceBand: "high",
    description: "Foundational, unwavering affirmative conviction",
    badgeClassName:
      "border-cyan-400/60 bg-cyan-950/80 text-cyan-200 shadow-[0_0_20px_rgba(6,182,212,0.4)]",
    textColorClassName: "text-cyan-300",
    borderColorClassName: "border-cyan-400/60",
    bgClassName: "bg-cyan-950/80",
    glowClassName: "shadow-[0_0_20px_rgba(6,182,212,0.4)]",
  },
  "Deliberate Equilibrium": {
    archetype: "Deliberate Equilibrium",
    category: "neutral",
    confidenceBand: "high",
    description: "Resolute neutrality sustained by intentional deliberation",
    badgeClassName:
      "border-violet-400/60 bg-violet-950/80 text-violet-200 shadow-[0_0_20px_rgba(139,92,246,0.4)]",
    textColorClassName: "text-violet-300",
    borderColorClassName: "border-violet-400/60",
    bgClassName: "bg-violet-950/80",
    glowClassName: "shadow-[0_0_20px_rgba(139,92,246,0.4)]",
  },
  "Principled Dissent": {
    archetype: "Principled Dissent",
    category: "dissent",
    confidenceBand: "high",
    description: "Unambiguous opposition anchored in core conviction",
    badgeClassName:
      "border-amber-400/60 bg-amber-950/80 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.4)]",
    textColorClassName: "text-amber-300",
    borderColorClassName: "border-amber-400/60",
    bgClassName: "bg-amber-950/80",
    glowClassName: "shadow-[0_0_20px_rgba(245,158,11,0.4)]",
  },
  "Grounded Support": {
    archetype: "Grounded Support",
    category: "support",
    confidenceBand: "mid",
    description: "Affirmative alignment grounded in clear reasoning",
    badgeClassName:
      "border-emerald-500/50 bg-emerald-950/70 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.3)]",
    textColorClassName: "text-emerald-300",
    borderColorClassName: "border-emerald-500/50",
    bgClassName: "bg-emerald-950/70",
    glowClassName: "shadow-[0_0_15px_rgba(16,185,129,0.3)]",
  },
  "Balanced Inquiry": {
    archetype: "Balanced Inquiry",
    category: "neutral",
    confidenceBand: "mid",
    description: "Open inquiry actively weighing divergent factors",
    badgeClassName:
      "border-slate-500/50 bg-slate-900/80 text-slate-200 shadow-[0_0_15px_rgba(148,163,184,0.25)]",
    textColorClassName: "text-slate-300",
    borderColorClassName: "border-slate-500/50",
    bgClassName: "bg-slate-900/80",
    glowClassName: "shadow-[0_0_15px_rgba(148,163,184,0.25)]",
  },
  "Grounded Skepticism": {
    archetype: "Grounded Skepticism",
    category: "dissent",
    confidenceBand: "mid",
    description: "Substantiated critique and conditional resistance",
    badgeClassName:
      "border-amber-500/50 bg-amber-950/70 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.3)]",
    textColorClassName: "text-amber-300",
    borderColorClassName: "border-amber-500/50",
    bgClassName: "bg-amber-950/70",
    glowClassName: "shadow-[0_0_15px_rgba(245,158,11,0.3)]",
  },
  "Provisional Curiosity": {
    archetype: "Provisional Curiosity",
    category: "support",
    confidenceBand: "low",
    description: "Preliminary leaning toward exploration and support",
    badgeClassName:
      "border-cyan-500/30 bg-cyan-950/50 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.15)]",
    textColorClassName: "text-cyan-400",
    borderColorClassName: "border-cyan-500/30",
    bgClassName: "bg-cyan-950/50",
    glowClassName: "shadow-[0_0_10px_rgba(6,182,212,0.15)]",
  },
  "Agnostic Observer": {
    archetype: "Agnostic Observer",
    category: "neutral",
    confidenceBand: "low",
    description: "Tentative stance awaiting clearer civic evidence",
    badgeClassName:
      "border-slate-700/60 bg-slate-900/60 text-slate-400 shadow-[0_0_10px_rgba(100,116,139,0.1)]",
    textColorClassName: "text-slate-400",
    borderColorClassName: "border-slate-700/60",
    bgClassName: "bg-slate-900/60",
    glowClassName: "shadow-[0_0_10px_rgba(100,116,139,0.1)]",
  },
  "Provisional Concern": {
    archetype: "Provisional Concern",
    category: "dissent",
    confidenceBand: "low",
    description: "Early hesitation or intuitive caution",
    badgeClassName:
      "border-amber-500/30 bg-amber-950/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.15)]",
    textColorClassName: "text-amber-400",
    borderColorClassName: "border-amber-500/30",
    bgClassName: "bg-amber-950/50",
    glowClassName: "shadow-[0_0_10px_rgba(245,158,11,0.15)]",
  },
}

/**
 * Maps raw Likert (-2 to +2) and Confidence (0 to 100) into a 9-cell stance archetype.
 */
export function getStanceArchetype(
  likert: number,
  confidence: number
): StanceArchetype {
  const conf = Math.max(0, Math.min(100, Math.round(confidence)))

  if (conf >= 75) {
    if (likert < 0) return "Principled Dissent"
    if (likert === 0) return "Deliberate Equilibrium"
    return "Bedrock Conviction"
  } else if (conf >= 40) {
    if (likert < 0) return "Grounded Skepticism"
    if (likert === 0) return "Balanced Inquiry"
    return "Grounded Support"
  } else {
    if (likert < 0) return "Provisional Concern"
    if (likert === 0) return "Agnostic Observer"
    return "Provisional Curiosity"
  }
}

/**
 * Returns complete UX metadata (colors, description, glow) for a stance archetype.
 */
export function getStanceArchetypeMeta(
  archetype: StanceArchetype
): StanceArchetypeMeta {
  return STANCE_METADATA[archetype] ?? STANCE_METADATA["Balanced Inquiry"]
}

/**
 * Spring physics configuration for dynamic badge morphing:
 * stiffness: 400, damping: 25.
 */
export const STANCE_BADGE_SPRING = {
  type: "spring" as const,
  stiffness: 400,
  damping: 25,
}

/**
 * Returns contextual relative conviction descriptor:
 * 'Primary Personal Anchor' or 'Standard Civic Stance'.
 */
export function getRelativeWeightDescriptor(
  confidence: number,
  zScore?: number | null
): "Primary Personal Anchor" | "Standard Civic Stance" {
  if (zScore != null && zScore >= 1.5) {
    return "Primary Personal Anchor"
  }
  if (confidence >= 85) {
    return "Primary Personal Anchor"
  }
  return "Standard Civic Stance"
}

export interface LikertStep {
  value: number
  label: string
  short: string
  activeColor: string
  dotColor: string
  textColor: string
  gradient: string
}

export const LIKERT_STEPS: LikertStep[] = [
  {
    value: -2,
    label: "Strongly Disagree",
    short: "SD",
    activeColor:
      "bg-rose-500 text-white border-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.4)]",
    dotColor: "bg-rose-500",
    textColor: "text-rose-400",
    gradient: "from-rose-500 to-rose-600",
  },
  {
    value: -1,
    label: "Disagree",
    short: "D",
    activeColor:
      "bg-amber-500 text-white border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]",
    dotColor: "bg-amber-500",
    textColor: "text-amber-400",
    gradient: "from-amber-500 to-amber-600",
  },
  {
    value: 0,
    label: "Neutral / Undecided",
    short: "N",
    activeColor:
      "bg-slate-600 text-white border-slate-500 shadow-[0_0_15px_rgba(100,116,139,0.4)]",
    dotColor: "bg-slate-400",
    textColor: "text-slate-300",
    gradient: "from-slate-500 to-slate-600",
  },
  {
    value: 1,
    label: "Agree",
    short: "A",
    activeColor:
      "bg-emerald-500 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]",
    dotColor: "bg-emerald-500",
    textColor: "text-emerald-400",
    gradient: "from-emerald-500 to-emerald-600",
  },
  {
    value: 2,
    label: "Strongly Agree",
    short: "SA",
    activeColor:
      "bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.6)] font-extrabold",
    dotColor: "bg-cyan-400",
    textColor: "text-cyan-400",
    gradient: "from-cyan-400 to-cyan-500",
  },
]

export function getConfidenceDescription(val: number): {
  label: string
  tone: string
  color: string
} {
  if (val >= 85)
    return {
      label: "Absolute Conviction",
      tone: "High certainty backed by deep familiarity",
      color: "text-cyan-400",
    }
  if (val >= 60)
    return {
      label: "Strong Certainty",
      tone: "Confident perspective with firm reasoning",
      color: "text-emerald-400",
    }
  if (val >= 35)
    return {
      label: "Moderate Lean",
      tone: "Tending toward this stance, open to new information",
      color: "text-amber-400",
    }
  return {
    label: "Tentative / Unsure",
    tone: "Intuitive guess or preliminary leaning",
    color: "text-slate-400",
  }
}
