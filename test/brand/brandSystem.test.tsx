import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import fs from "node:fs"
import path from "node:path"
import { siteConfig } from "@/config/site"
import { VotaryEmblem } from "@/components/brand/VotaryEmblem"
import { Header } from "@/components/nav/Header"
import { metadata } from "@/app/layout"

// Mock next/font/google
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-sans" }),
  Geist_Mono: () => ({ variable: "--font-mono" }),
}))

// Mock next/navigation
const mockRefresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

// Mock Supabase client for UserNav
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  }),
}))

describe("Brand System & Design Alignment (STORY-VAL-BRAND-VOTARY)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Site Configuration & Metadata", () => {
    it("defines The Votary brand naming and civic consensus engine descriptors", () => {
      expect(siteConfig.name).toBe("The Votary")
      expect(siteConfig.title).toBe("The Votary | Civic Consensus Engine")
      expect(siteConfig.tagline).toBe("The Civic Consensus Engine")
      expect(siteConfig.description).toMatch(/Anti-Sybil/i)
      expect(siteConfig.description).toMatch(/deliberative/i)
      expect(siteConfig.url).toContain(".sunshade.icu")
      expect(siteConfig.telemetry.system).toBe("SunShade")
      expect(siteConfig.telemetry.kernel).toBe("Project Valerie")

      // Verify social preview image exists on disk
      const ogPath = path.resolve(process.cwd(), "public", "og.png")
      expect(fs.existsSync(ogPath)).toBe(true)
      const stat = fs.statSync(ogPath)
      expect(stat.size).toBeGreaterThan(1000)
    })

    it("exports layout metadata with correct title and OpenGraph configuration", () => {
      expect(metadata.title).toEqual({
        default: "The Votary | Civic Consensus Engine",
        template: "%s | The Votary",
      })
      expect(metadata.description).toBe(siteConfig.description)

      // OpenGraph assertions
      const og = metadata.openGraph as any
      expect(og).toBeDefined()
      expect(og.title).toBe("The Votary | Civic Consensus Engine")
      expect(og.siteName).toBe("The Votary")
      expect(og.description).toBe(siteConfig.description)
      expect(og.images?.[0]?.alt).toBe("The Votary | Civic Consensus Engine")
    })
  })

  describe("VotaryEmblem SVG Component", () => {
    it("renders mechanical rotary and interlocking ballot ring motifs with accessibility label", () => {
      const { container } = render(<VotaryEmblem size={40} data-testid="votary-emblem-svg" />)
      const svg = screen.getByRole("img", { name: /The Votary Emblem/i })
      expect(svg).toBeDefined()
      expect(svg.getAttribute("viewBox")).toBe("0 0 48 48")

      // Verify circles and ellipses representing interlocking rotary and ballot rings
      const circles = container.querySelectorAll("circle")
      const ellipses = container.querySelectorAll("ellipse")
      expect(circles.length).toBeGreaterThanOrEqual(4)
      expect(ellipses.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe("Header Component", () => {
    it("renders brand typography, tagline, and navigation chips", () => {
      render(<Header activeNav="Deliberation" />)

      // Brand Title and Tagline
      expect(screen.getByText("The Votary")).toBeDefined()
      expect(screen.getByText("The Civic Consensus Engine")).toBeDefined()

      // Telemetry Markers preserved
      expect(screen.getByText("SunShade")).toBeDefined()
      expect(screen.getByText("Project Valerie")).toBeDefined()
      expect(screen.getByText("Anti-Bandwagoning")).toBeDefined()
      expect(screen.getByText("SHA-256 AI Active")).toBeDefined()

      // Navigation chips
      expect(screen.getByText("Deliberation")).toBeDefined()
      expect(screen.getByText("Settings")).toBeDefined()
    })

    it("renders back button when showBackButton is enabled", () => {
      render(
        <Header
          showBackButton
          backButtonHref="/"
          backButtonLabel="Back to Polls"
        />
      )

      expect(screen.getByText("Back to Polls")).toBeDefined()
    })

    it("renders compact brand typography when showBackButton is enabled on narrow screens", () => {
      render(
        <Header
          showBackButton
          backButtonHref="/"
          backButtonLabel="Back to Deliberation"
        />
      )

      expect(screen.getByText("Back to Deliberation")).toBeDefined()
      const titleSpan = screen.getByText("The Votary")
      expect(titleSpan.className).toContain("hidden sm:inline")
    })
  })
})
