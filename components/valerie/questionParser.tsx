import React from "react"
import { ValerieTooltip } from "@/components/valerie/ValerieTooltip"

export const KNOWN_GLOSSARY_TERMS = [
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
]

/**
 * Parses raw text for bracketed [[term]] patterns or known civic keywords,
 * replacing them with interactive ValerieTooltip components.
 */
export function parseQuestionWithTooltips(text: string): React.ReactNode {
  if (!text) return null

  // 1. Check for explicit bracketed syntax like [[pedestrian-only zone]]
  const bracketRegex = /\[\[(.*?)\]\]/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  if (text.includes("[[")) {
    while ((match = bracketRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index))
      }
      const term = match[1]
      parts.push(
        <ValerieTooltip key={`bracket-${match.index}`} word={term}>
          {term}
        </ValerieTooltip>
      )
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }
    return <>{parts}</>
  }

  // 2. Automatic keyword extraction
  const escapedTerms = KNOWN_GLOSSARY_TERMS.sort((a, b) => b.length - a.length)
  const regex = new RegExp(`\\b(${escapedTerms.join("|")})\\b`, "gi")

  const elements: React.ReactNode[] = []
  let currIndex = 0
  let keywordMatch: RegExpExecArray | null

  while ((keywordMatch = regex.exec(text)) !== null) {
    if (keywordMatch.index > currIndex) {
      elements.push(text.substring(currIndex, keywordMatch.index))
    }
    const matchedTerm = keywordMatch[0]
    elements.push(
      <ValerieTooltip
        key={`auto-${keywordMatch.index}`}
        word={matchedTerm.toLowerCase()}
      >
        {matchedTerm}
      </ValerieTooltip>
    )
    currIndex = keywordMatch.index + matchedTerm.length
  }

  if (currIndex < text.length) {
    elements.push(text.substring(currIndex))
  }

  return <>{elements}</>
}
