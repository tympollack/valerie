/**
 * Project Valerie: 60/30/10 Content Curation & Intake Engine
 * File: lib/valerie/digestEngine.ts
 * Work Item: [TASK-VAL-DIGEST-RPC] / [STORY-VAL-DIGEST-ENGINE]
 *
 * Implements client & server utility functions to process the 60/30/10 curated
 * intake feed:
 *   - 60% Affinity (Persona Match): High cosine similarity to user latent belief vector
 *   - 30% Salience (Civic Anchors): H3 cell, LOCAL/STATE tier, or ecosystem refs
 *   - 10% Blindspot (Bridge Card): Ideologically divergent cluster with high variance
 */

export type DigestCategory = "PERSONA_MATCH" | "CIVIC_ANCHOR" | "BLINDSPOT_BRIDGE";

export interface DigestCard {
  category: DigestCategory;
  category_ratio: string; // "60%" | "30%" | "10%"
  poll_id: string;
  question_text: string;
  scope_tier?: "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL" | string;
  axis_category?: string | null;
  target_locale_code?: string | null;
  detected_locales?: string[];
  related_ecosystem_refs?: Record<string, unknown>;
  is_reveal_ready: boolean;
  cluster_id?: string | null;
  cluster_name?: string | null;
  divergence_distance?: number;
  cluster_variance?: number;
  affinity_score?: number;
  participation_count?: number;
}

export interface DigestPayload {
  items: DigestCard[];
  summary: {
    personaCount: number;
    civicCount: number;
    blindspotCount: number;
    total: number;
  };
}

/**
 * Validates and normalizes raw JSON response from valerie.assemble_digest_payload RPC.
 */
export function parseDigestPayload(raw: unknown): DigestPayload {
  if (!Array.isArray(raw)) {
    return {
      items: [],
      summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
    };
  }

  const items: DigestCard[] = [];
  let personaCount = 0;
  let civicCount = 0;
  let blindspotCount = 0;

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;

    if (!obj.poll_id || typeof obj.poll_id !== "string") continue;
    if (!obj.question_text || typeof obj.question_text !== "string") continue;

    let category: DigestCategory = "PERSONA_MATCH";
    if (obj.category === "BLINDSPOT_BRIDGE") {
      category = "BLINDSPOT_BRIDGE";
      blindspotCount++;
    } else if (obj.category === "CIVIC_ANCHOR") {
      category = "CIVIC_ANCHOR";
      civicCount++;
    } else {
      category = "PERSONA_MATCH";
      personaCount++;
    }

    const ratio =
      typeof obj.category_ratio === "string"
        ? obj.category_ratio
        : category === "BLINDSPOT_BRIDGE"
        ? "10%"
        : category === "CIVIC_ANCHOR"
        ? "30%"
        : "60%";

    items.push({
      category,
      category_ratio: ratio,
      poll_id: obj.poll_id,
      question_text: obj.question_text,
      scope_tier: typeof obj.scope_tier === "string" ? obj.scope_tier : "NATIONAL",
      axis_category: typeof obj.axis_category === "string" ? obj.axis_category : null,
      target_locale_code:
        typeof obj.target_locale_code === "string" ? obj.target_locale_code : null,
      detected_locales: Array.isArray(obj.detected_locales)
        ? (obj.detected_locales as string[])
        : [],
      related_ecosystem_refs:
        obj.related_ecosystem_refs && typeof obj.related_ecosystem_refs === "object"
          ? (obj.related_ecosystem_refs as Record<string, unknown>)
          : {},
      is_reveal_ready: Boolean(obj.is_reveal_ready),
      cluster_id: typeof obj.cluster_id === "string" ? obj.cluster_id : null,
      cluster_name: typeof obj.cluster_name === "string" ? obj.cluster_name : null,
      divergence_distance:
        typeof obj.divergence_distance === "number" ? obj.divergence_distance : undefined,
      cluster_variance:
        typeof obj.cluster_variance === "number" ? obj.cluster_variance : undefined,
      affinity_score:
        typeof obj.affinity_score === "number" ? obj.affinity_score : undefined,
      participation_count:
        typeof obj.participation_count === "number" ? obj.participation_count : 0,
    });
  }

  return {
    items,
    summary: {
      personaCount,
      civicCount,
      blindspotCount,
      total: items.length,
    },
  };
}
