/**
 * Project Valerie: Ad Compliance Decomposer & Dual-Agent Cynic Gate
 * Work Item: [TASK-VAL-DECOMPOSER-EDGE] / [STORY-VAL-AD-DECOMPOSER]
 *
 * Pipeline:
 *  1. Agent 1 (Decomposer): Strips commercial brand names from billboard OCR text
 *     and reframes physical/visual complaints into an objective civic proposition.
 *  2. Agent 2 (Cynic Referee): Audits candidate proposition for bias, loaded framing,
 *     or commercial vendettas. Forces rewrite if cynic_bias_score >= 0.15.
 */

import { cellToParent } from "h3-js";
import { AdViolationCategory } from "../valerie/adCompliance";

export interface AdDecomposerInput {
  ocrRawText: string;
  flaggedCategories: AdViolationCategory[];
  h3IndexRes8?: string;
  patchworkPortId?: string;
  parcelId?: string;
}

export interface CynicAuditResult {
  cynic_bias_score: number;
  feedback: string;
  detectedBrand?: string;
}

export interface DecomposedPollResult {
  question: string;
  cynic_bias_score: number;
  attempts: number;
  passed: boolean;
  violationFocus: AdViolationCategory[];
  scopeTier: "LOCAL";
  h3_res7?: string | null;
}

// Brand patterns to strip from raw billboard OCR
const KNOWN_BRAND_PATTERNS = [
  /\b(mcdonald'?s|burger king|wendy'?s|starbucks|dunkin'?|taco bell|subway)\b/gi,
  /\b(coca[\s-]?cola|pepsi|bud light|coors|heineken|corona)\b/gi,
  /\b(apple|google|samsung|amazon|meta|microsoft|verizon|t-mobile|at&t)\b/gi,
  /\b(chevrolet|ford|toyota|honda|geico|progressive|state farm)\b/gi,
  /\b(nike|adidas|target|walmart|home depot|cvs|walgreens)\b/gi,
  /\b(casinos?|draftkings|fanduel|betmgm)\b/gi,
];

// Biased / loaded terminology
const BIASED_TERMS = [
  "corrupt",
  "tyrannical",
  "reckless",
  "eyesore",
  "greedy",
  "evil",
  "blight",
  "destroying",
  "obviously",
  "clearly",
  "monstrous",
  "predatory",
];

/**
 * Resolves H3 resolution-7 parent from an H3 resolution-8 index to ensure voter matching.
 */
export function resolveRes7FromRes8(h3Index?: string | null): string | null {
  if (!h3Index) return null;
  try {
    return cellToParent(h3Index, 7);
  } catch {
    return null;
  }
}

/**
 * Infer violation categories from OCR text when flagged_categories is empty.
 */
export function inferCategoriesFromOcr(ocrText: string): AdViolationCategory[] {
  const lower = ocrText.toLowerCase();
  const categories: AdViolationCategory[] = [];

  if (/\b(glare|luminance|bright|night|nits|illumination|blinding|light|flash)\b/i.test(lower)) {
    categories.push("EXCESSIVE_LUMINANCE");
  }
  if (/\b(sightline|vision|blind spot|traffic|merge|intersection|distraction|roadway|highway|hazard)\b/i.test(lower)) {
    categories.push("TRAFFIC_SIGHTLINE_HAZARD");
  }
  if (/\b(school|playground|children|elementary|students?|kindergarten|buffer|daycare)\b/i.test(lower)) {
    categories.push("SCHOOL_BUFFER_BREACH");
  }
  if (/\b(distress|anxiety|existential|overstimulation|mental|sensory|stress)\b/i.test(lower)) {
    categories.push("UNASSISTED_EXISTENTIAL_DISTRESS");
  }
  if (/\b(density|cluster|corridor|equity|overburdened|billboard density|clutter)\b/i.test(lower) || categories.length === 0) {
    categories.push("CORRIDOR_EQUITY_DISPARITY");
  }

  return categories;
}

/**
 * Strips brand names and corporate identifiers from raw billboard text.
 */
export function sanitizeBrandNames(rawText: string): { sanitized: string; removedBrands: string[] } {
  let sanitized = rawText;
  const removedBrands: string[] = [];

  for (const pattern of KNOWN_BRAND_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      for (const m of matches) {
        if (!removedBrands.includes(m.toLowerCase())) {
          removedBrands.push(m.toLowerCase());
        }
      }
      sanitized = sanitized.replace(pattern, "commercial advertiser");
    }
  }

  sanitized = sanitized.replace(/(https?:\/\/[^\s]+|www\.[^\s]+|\b\d{3}[-.\s]??\d{3}[-.\s]??\d{4}\b)/gi, "");
  return { sanitized: sanitized.trim(), removedBrands };
}

/**
 * Agent 2: Cynic Referee.
 * Audits candidate question for bias, leading language, and commercial vendettas.
 * Returns a bias score between 0.0 (neutral) and 1.0 (heavily biased).
 */
export async function auditAdQuestionBias(
  questionText: string,
  openaiApiKey?: string
): Promise<CynicAuditResult> {
  if (openaiApiKey) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.0,
          messages: [
            {
              role: "system",
              content:
                "You are an adversarial Red-Pen Cynic Referee for Project Valerie. Audit the provided question for brand targeting, emotional bias, leading premises, or non-neutral framing. Return ONLY JSON: {\"cynic_bias_score\": <number 0.0 to 1.0>, \"feedback\": \"<brief reason>\"}.",
            },
            {
              role: "user",
              content: questionText,
            },
          ],
        }),
      });

      if (resp.ok) {
        const json = await resp.json();
        const content = json.choices?.[0]?.message?.content?.trim() || "{}";
        const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.cynic_bias_score === "number") {
          return {
            cynic_bias_score: Math.max(0.0, Math.min(1.0, parsed.cynic_bias_score)),
            feedback: parsed.feedback || "Evaluated by Cynic Referee LLM",
          };
        }
      }
    } catch {
      // Fall through to heuristic
    }
  }

  const lower = questionText.toLowerCase();
  let biasScore = 0.04;

  for (const pattern of KNOWN_BRAND_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      biasScore += 0.35;
      return {
        cynic_bias_score: Math.min(1.0, biasScore),
        feedback: `Contains specific commercial brand reference: ${match[0]}`,
        detectedBrand: match[0],
      };
    }
  }

  for (const term of BIASED_TERMS) {
    if (lower.includes(term)) {
      biasScore += 0.30;
    }
  }

  const isQuestion = questionText.trim().endsWith("?");
  if (!isQuestion) biasScore += 0.15;

  return {
    cynic_bias_score: Math.min(1.0, biasScore),
    feedback: biasScore >= 0.15 ? "Detected biased framing or brand reference" : "Passed neutrality audit",
  };
}

/**
 * Agent 1: Decomposer.
 * Generates an objective civic proposition addressing the root zoning/environmental issue.
 */
export function synthesizeCivicProposition(
  _sanitizedCopy: string,
  categories: AdViolationCategory[],
  attempt: number
): string {
  const primaryCategory = categories[0] || "CORRIDOR_EQUITY_DISPARITY";

  switch (primaryCategory) {
    case "EXCESSIVE_LUMINANCE":
      return attempt === 1
        ? "Should municipal night-sky ordinances impose dynamic nighttime nit limits and automated curfew dimming on high-intensity digital display corridors?"
        : "Should local zoning authorities restrict illuminated digital billboard output between 10 PM and 6 AM along residential-adjacent transit corridors?";

    case "TRAFFIC_SIGHTLINE_HAZARD":
      return attempt === 1
        ? "Should municipal traffic safety guidelines prohibit high-contrast dynamic digital signage within 300 feet of highway merge intersections?"
        : "Should local road commission standards require minimum sightline setback distances for dynamic advertising along high-collision roadway segments?";

    case "SCHOOL_BUFFER_BREACH":
      return attempt === 1
        ? "Should district zoning boards enforce a mandatory 1,000-foot buffer zone prohibiting commercial billboard placement around primary and secondary school perimeters?"
        : "Should municipal land-use regulations restrict commercial outdoor advertising within designated pedestrian school-walkway zones?";

    case "UNASSISTED_EXISTENTIAL_DISTRESS":
      return attempt === 1
        ? "Should public advertising standards require visual breathing corridors and cap the density of high-stimulation commercial screens in pedestrian plazas?"
        : "Should municipal aesthetic review boards limit high-frequency visual messaging displays in dense civic gathering areas?";

    case "CORRIDOR_EQUITY_DISPARITY":
    default:
      return attempt === 1
        ? "Should municipal planning commissions cap aggregate outdoor advertising square footage per resident in historically overburdened commercial corridors?"
        : "Should local zoning laws require parity in billboard density across commercial and residential neighborhood districts?";
  }
}

/**
 * Runs the complete Dual-Agent Ad Decomposer & Cynic Referee loop.
 */
export async function runAdDecomposerPipeline(
  input: AdDecomposerInput,
  openaiApiKey?: string
): Promise<DecomposedPollResult> {
  const { sanitized } = sanitizeBrandNames(input.ocrRawText);
  const effectiveCategories =
    input.flaggedCategories && input.flaggedCategories.length > 0
      ? input.flaggedCategories
      : inferCategoriesFromOcr(input.ocrRawText);

  let attempts = 0;
  let bestQuestion = "";
  let lowestBias = 1.0;
  const h3Res7 = resolveRes7FromRes8(input.h3IndexRes8);

  while (attempts < 3) {
    attempts++;
    const candidate = synthesizeCivicProposition(sanitized, effectiveCategories, attempts);
    const audit = await auditAdQuestionBias(candidate, openaiApiKey);

    if (audit.cynic_bias_score < lowestBias) {
      lowestBias = audit.cynic_bias_score;
      bestQuestion = candidate;
    }

    if (audit.cynic_bias_score < 0.15) {
      return {
        question: candidate,
        cynic_bias_score: audit.cynic_bias_score,
        attempts,
        passed: true,
        violationFocus: effectiveCategories,
        scopeTier: "LOCAL",
        h3_res7: h3Res7,
      };
    }
  }

  // If even after max attempts question fails neutrality cutoff (0.15), return passed: false
  return {
    question: bestQuestion,
    cynic_bias_score: lowestBias,
    attempts,
    passed: lowestBias < 0.15,
    violationFocus: effectiveCategories,
    scopeTier: "LOCAL",
    h3_res7: h3Res7,
  };
}
