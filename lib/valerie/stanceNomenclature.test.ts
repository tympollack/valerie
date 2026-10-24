import { describe, it, expect } from "vitest"
import {
  getStanceArchetype,
  getStanceArchetypeMeta,
  getRelativeWeightDescriptor,
  STANCE_BADGE_SPRING,
  type StanceArchetype,
} from "./stanceNomenclature"

describe("Civic Stance Matrix Nomenclature Engine", () => {
  describe("getStanceArchetype 3x3 Matrix Coordinates", () => {
    // 1. High Confidence (75-100%)
    it("maps high confidence coordinates correctly", () => {
      expect(getStanceArchetype(-2, 90)).toBe("Principled Dissent")
      expect(getStanceArchetype(-1, 75)).toBe("Principled Dissent")
      expect(getStanceArchetype(0, 95)).toBe("Deliberate Equilibrium")
      expect(getStanceArchetype(0, 75)).toBe("Deliberate Equilibrium")
      expect(getStanceArchetype(1, 80)).toBe("Bedrock Conviction")
      expect(getStanceArchetype(2, 85)).toBe("Bedrock Conviction")
    })

    // 2. Mid Confidence (40-74%)
    it("maps mid confidence coordinates correctly", () => {
      expect(getStanceArchetype(-2, 40)).toBe("Grounded Skepticism")
      expect(getStanceArchetype(-1, 55)).toBe("Grounded Skepticism")
      expect(getStanceArchetype(0, 60)).toBe("Balanced Inquiry")
      expect(getStanceArchetype(0, 40)).toBe("Balanced Inquiry")
      expect(getStanceArchetype(1, 50)).toBe("Grounded Support")
      expect(getStanceArchetype(2, 70)).toBe("Grounded Support")
    })

    // 3. Low Confidence (0-39%)
    it("maps low confidence coordinates correctly", () => {
      expect(getStanceArchetype(-2, 20)).toBe("Provisional Concern")
      expect(getStanceArchetype(-1, 35)).toBe("Provisional Concern")
      expect(getStanceArchetype(0, 10)).toBe("Agnostic Observer")
      expect(getStanceArchetype(0, 0)).toBe("Agnostic Observer")
      expect(getStanceArchetype(1, 25)).toBe("Provisional Curiosity")
      expect(getStanceArchetype(2, 39)).toBe("Provisional Curiosity")
    })

    // Bounds & Clamping
    it("clamps confidence outside 0-100 range gracefully", () => {
      expect(getStanceArchetype(2, 120)).toBe("Bedrock Conviction")
      expect(getStanceArchetype(-1, -10)).toBe("Provisional Concern")
    })
  })

  describe("getStanceArchetypeMeta", () => {
    it("returns correct color tokens for Support, Dissent, and Neutral archetypes", () => {
      const bedrock = getStanceArchetypeMeta("Bedrock Conviction")
      expect(bedrock.category).toBe("support")
      expect(bedrock.badgeClassName).toContain("cyan")

      const dissent = getStanceArchetypeMeta("Principled Dissent")
      expect(dissent.category).toBe("dissent")
      expect(dissent.badgeClassName).toContain("amber")

      const equilibrium = getStanceArchetypeMeta("Deliberate Equilibrium")
      expect(equilibrium.category).toBe("neutral")
      expect(equilibrium.badgeClassName).toContain("violet")
    })
  })

  describe("STANCE_BADGE_SPRING", () => {
    it("provides the specified spring physics tokens", () => {
      expect(STANCE_BADGE_SPRING).toEqual({
        type: "spring",
        stiffness: 400,
        damping: 25,
      })
    })
  })

  describe("getRelativeWeightDescriptor", () => {
    it("returns Primary Personal Anchor for confidence >= 85 or zScore >= 1.5", () => {
      expect(getRelativeWeightDescriptor(85)).toBe("Primary Personal Anchor")
      expect(getRelativeWeightDescriptor(100)).toBe("Primary Personal Anchor")
      expect(getRelativeWeightDescriptor(50, 1.8)).toBe("Primary Personal Anchor")
    })

    it("returns Standard Civic Stance for confidence < 85 with normal zScore", () => {
      expect(getRelativeWeightDescriptor(75)).toBe("Standard Civic Stance")
      expect(getRelativeWeightDescriptor(30)).toBe("Standard Civic Stance")
      expect(getRelativeWeightDescriptor(60, 0.4)).toBe("Standard Civic Stance")
    })
  })
})
