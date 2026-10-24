import { describe, it, expect } from "vitest";
import { parseDigestPayload } from "@/lib/valerie/digestEngine";

describe("lib/valerie/digestEngine - parseDigestPayload", () => {
  it("handles null, undefined, and non-array inputs gracefully", () => {
    expect(parseDigestPayload(null)).toEqual({
      items: [],
      summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
    });

    expect(parseDigestPayload(undefined)).toEqual({
      items: [],
      summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
    });

    expect(parseDigestPayload("invalid-string")).toEqual({
      items: [],
      summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
    });

    expect(parseDigestPayload([])).toEqual({
      items: [],
      summary: { personaCount: 0, civicCount: 0, blindspotCount: 0, total: 0 },
    });
  });

  it("filters out invalid objects missing poll_id or question_text", () => {
    const raw = [
      { foo: "bar" },
      { poll_id: "poll-1" }, // missing question_text
      { question_text: "Where is the poll id?" }, // missing poll_id
      null,
      123,
    ];

    const result = parseDigestPayload(raw);
    expect(result.items).toHaveLength(0);
    expect(result.summary.total).toBe(0);
  });

  it("correctly parses 60/30/10 categorized digest items", () => {
    const raw = [
      {
        category: "BLINDSPOT_BRIDGE",
        category_ratio: "10%",
        poll_id: "poll-blindspot-1",
        question_text: "Should algorithmic transparency be legally mandatory?",
        scope_tier: "NATIONAL",
        axis_category: "GOVERNANCE",
        cluster_id: "cluster-far",
        cluster_name: "Far Polar Cluster",
        divergence_distance: 0.82,
        cluster_variance: 0.65,
        is_reveal_ready: false,
        participation_count: 50,
      },
      {
        category: "CIVIC_ANCHOR",
        category_ratio: "30%",
        poll_id: "poll-civic-1",
        question_text: "Local transit levy in cell 872681a33ffffff?",
        scope_tier: "LOCAL",
        target_locale_code: "US-CA",
        detected_locales: ["US-CA", "en-US"],
        related_ecosystem_refs: { system: "patchwork", node_id: "pw-42" },
        is_reveal_ready: false,
        participation_count: 120,
      },
      {
        category: "PERSONA_MATCH",
        category_ratio: "60%",
        poll_id: "poll-persona-1",
        question_text: "Optimal distribution ratio for sovereign dividends?",
        scope_tier: "GLOBAL",
        affinity_score: 0.945,
        is_reveal_ready: true,
        participation_count: 310,
      },
    ];

    const result = parseDigestPayload(raw);

    expect(result.items).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.summary.blindspotCount).toBe(1);
    expect(result.summary.civicCount).toBe(1);
    expect(result.summary.personaCount).toBe(1);

    // Verify Blindspot card
    const blindspot = result.items[0];
    expect(blindspot.category).toBe("BLINDSPOT_BRIDGE");
    expect(blindspot.category_ratio).toBe("10%");
    expect(blindspot.divergence_distance).toBe(0.82);
    expect(blindspot.cluster_variance).toBe(0.65);
    expect(blindspot.cluster_name).toBe("Far Polar Cluster");
    expect(blindspot.is_reveal_ready).toBe(false);

    // Verify Civic Anchor card
    const civic = result.items[1];
    expect(civic.category).toBe("CIVIC_ANCHOR");
    expect(civic.category_ratio).toBe("30%");
    expect(civic.target_locale_code).toBe("US-CA");
    expect(civic.detected_locales).toEqual(["US-CA", "en-US"]);
    expect(civic.related_ecosystem_refs).toEqual({ system: "patchwork", node_id: "pw-42" });
    expect(civic.participation_count).toBe(120);

    // Verify Persona Match card
    const persona = result.items[2];
    expect(persona.category).toBe("PERSONA_MATCH");
    expect(persona.category_ratio).toBe("60%");
    expect(persona.affinity_score).toBe(0.945);
    expect(persona.is_reveal_ready).toBe(true);
  });

  it("assigns fallback default ratios and default values for omitted optional fields", () => {
    const raw = [
      {
        category: "BLINDSPOT_BRIDGE",
        poll_id: "p-1",
        question_text: "Minimal blindspot question",
      },
      {
        category: "CIVIC_ANCHOR",
        poll_id: "p-2",
        question_text: "Minimal civic question",
      },
      {
        category: "UNKNOWN_CATEGORY",
        poll_id: "p-3",
        question_text: "Minimal unknown falls back to persona",
      },
    ];

    const result = parseDigestPayload(raw);
    expect(result.items[0].category_ratio).toBe("10%");
    expect(result.items[0].scope_tier).toBe("NATIONAL");
    expect(result.items[0].is_reveal_ready).toBe(false);

    expect(result.items[1].category_ratio).toBe("30%");
    expect(result.items[2].category).toBe("PERSONA_MATCH");
    expect(result.items[2].category_ratio).toBe("60%");
  });
});
