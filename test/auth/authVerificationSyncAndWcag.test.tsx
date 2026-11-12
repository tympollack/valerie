import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import React from "react"
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider"
import { UserNav } from "@/components/valerie/UserNav"
import { UserMenu } from "@/components/navigation/UserMenu"
import { Header } from "@/components/nav/Header"
import { SettingsView } from "@/components/valerie/SettingsView"
import { BivariatePollCard } from "@/components/valerie/BivariatePollCard"
import type { UserContext } from "@/app/actions/auth"

// Mock next/navigation
const mockRefresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

// Mock auth actions
vi.mock("@/app/actions/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/actions/auth")>()
  return {
    ...actual,
    signOutAction: vi.fn().mockResolvedValue({ success: true }),
    revalidateUserContextAction: vi.fn().mockResolvedValue({
      authenticated: true,
      userId: "usr-sync-1",
      email: "citizen@sunshade.icu",
      displayName: "Citizen Sync",
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "active",
    }),
  }
})

// Mock vote actions for BivariatePollCard
vi.mock("@/app/actions/vote", () => ({
  castVote: vi.fn().mockResolvedValue({ success: true }),
  submitVote: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock("@/app/actions/valerieFlagActions", () => ({
  flagPollWithCommitGate: vi.fn().mockResolvedValue({ success: true }),
  VALID_FLAG_REASONS: ["LOADED_FRAMING", "FALSE_DICHOTOMY", "DISPUTED_PREMISE", "LOCALE_MISMATCH"],
}))

// Mock Supabase client
const mockRefreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null })
const mockRpc = vi.fn().mockResolvedValue({ data: false, error: null })
let authCallback: ((event: string, session: any) => void) | null = null

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      refreshSession: mockRefreshSession,
      getUser: mockGetUser,
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn((cb) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
    },
    rpc: mockRpc,
  }),
}))

describe("TASK-VAL-HUB-VERIFY-SYNC: Hub Verification Session Sync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("AuthProvider refreshes session and queries authoritative RPC on window focus", async () => {
    const unverifiedUserContext: UserContext = {
      authenticated: true,
      userId: "usr-sync-test",
      email: "sync@sunshade.icu",
      displayName: "Sync User",
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "active",
    }

    // When focus occurs, authoritative RPC flips is_human_verified to true
    mockRpc.mockResolvedValueOnce({ data: true, error: null })
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "usr-sync-test",
          email: "sync@sunshade.icu",
          app_metadata: { is_human: true, anti_sybil_verified: true, trust_state: "active" },
          user_metadata: {},
        },
      },
      error: null,
    })

    function Consumer() {
      const auth = useAuth()
      return (
        <div>
          <span data-testid="verified-status">
            {auth?.userContext.isHumanVerified ? "VERIFIED" : "UNVERIFIED"}
          </span>
        </div>
      )
    }

    render(
      <AuthProvider initialUserContext={unverifiedUserContext}>
        <Consumer />
      </AuthProvider>
    )

    expect(screen.getByTestId("verified-status")).toHaveTextContent("UNVERIFIED")

    // Simulate returning to tab (focus)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })

    expect(mockRefreshSession).toHaveBeenCalled()
    expect(mockGetUser).toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByTestId("verified-status")).toHaveTextContent("VERIFIED")
    })
  })

  it("UserNav synchronizes verification on visibilitychange event", async () => {
    const unverifiedContext: UserContext = {
      authenticated: true,
      userId: "usr-nav-sync",
      email: "navsync@sunshade.icu",
      displayName: "Nav Sync",
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "active",
    }

    mockRpc.mockResolvedValueOnce({ data: true, error: null })
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "usr-nav-sync",
          email: "navsync@sunshade.icu",
          app_metadata: { is_human: true, anti_sybil_verified: true, trust_state: "active" },
          user_metadata: {},
        },
      },
      error: null,
    })

    render(<UserNav initialUserContext={unverifiedContext} />)
    expect(screen.getByText("Setup Needed")).toBeInTheDocument()

    // Simulate tab becoming visible
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })

    expect(mockRefreshSession).toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByText("Verified Human")).toBeInTheDocument()
    })
  })
})

describe("TASK-VAL-VERIFY-COPY-PAP-TEST: Plain-Language Civic Copy", () => {
  const unverifiedContext: UserContext = {
    authenticated: true,
    userId: "usr-pap-test",
    email: "citizen@sunshade.icu",
    displayName: "Jane Citizen",
    isHumanVerified: false,
    verificationTier: "UNVERIFIED",
    trustState: "active",
  }

  it("replaces technical jargon with accessible plain-language copy", () => {
    render(<UserMenu initialUserContext={unverifiedContext} />)

    // 1. Navbar pill subtitle: Setup Needed
    expect(screen.getByText("Setup Needed")).toBeInTheDocument()
    expect(screen.queryByText(/^Unverified$/)).not.toBeInTheDocument()

    // Open menu
    const trigger = screen.getByRole("button", { name: /User Account Menu/i })
    fireEvent.click(trigger)

    // 2. Dropdown status pill: Voter Status: Unconfirmed
    expect(screen.getByText("Voter Status: Unconfirmed")).toBeInTheDocument()
    expect(screen.queryByText("Unverified Identity")).not.toBeInTheDocument()

    // 3. Warning heading: Confirm Your Account to Vote:
    expect(screen.getByText(/Confirm Your Account to Vote/i)).toBeInTheDocument()
    expect(screen.queryByText(/Verification Required:/i)).not.toBeInTheDocument()

    // 4. Warning body: plain-language 6th-grade civic explanation
    expect(
      screen.getByText(
        /To ensure one person equals one vote and keep bots out, please confirm your identity on your SunShade Hub profile\./i
      )
    ).toBeInTheDocument()

    // 5. Primary CTA button: Confirm Identity on Hub
    const ctaButton = screen.getByRole("link", { name: /Confirm Identity on Hub/i })
    expect(ctaButton).toBeInTheDocument()
    expect(screen.queryByText("Complete Verification on Hub")).not.toBeInTheDocument()

    // 6. Outbound link contains redirectTo
    expect(ctaButton.getAttribute("href")).toContain("redirectTo=")
  })
})

describe("TASK-VAL-VERIFY-UI-WCAG-SPACE: De-Cramp Menu, Contrast & Inline Gate", () => {
  const unverifiedContext: UserContext = {
    authenticated: true,
    userId: "usr-wcag-test",
    email: "wcag@sunshade.icu",
    displayName: "WCAG Tester",
    isHumanVerified: false,
    verificationTier: "UNVERIFIED",
    trustState: "active",
  }

  it("eliminates redundant Tier monospace badge and applies spacious padding in UserMenu", () => {
    render(<UserMenu initialUserContext={unverifiedContext} />)
    const trigger = screen.getByRole("button", { name: /User Account Menu/i })
    fireEvent.click(trigger)

    // Status is only stated once — redundant monospace tier badge is eliminated
    expect(screen.queryByText(/Tier: UNVERIFIED/i)).not.toBeInTheDocument()

    // Warning body text has high-contrast class text-slate-100 (>7:1 AAA)
    const warningBody = screen.getByText(/To ensure one person equals one vote/i)
    expect(warningBody).toHaveClass("text-slate-100")

    // CTA button has >=44px touch target (min-h-[44px]), amber fill, and focus ring
    const ctaButton = screen.getByRole("link", { name: /Confirm Identity on Hub/i })
    expect(ctaButton).toHaveClass("min-h-[44px]")
    expect(ctaButton).toHaveClass("bg-amber-400")
    expect(ctaButton).toHaveClass("text-slate-950")
    expect(ctaButton).toHaveClass("focus-visible:ring-2")
  })

  it("declutters top Header by omitting debug icon pills", () => {
    render(<Header userContext={unverifiedContext} />)

    // The top navbar remains calm and scannable — debug icon pills are omitted
    expect(screen.queryByLabelText("Anti-Bandwagoning")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("SHA-256 AI Active")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Internal Telemetry Kernel: v2.4-alpha")).not.toBeInTheDocument()
  })

  it("renders system diagnostics and telemetry kernel inside SettingsView", () => {
    render(<SettingsView userContext={unverifiedContext} />)

    expect(screen.getByText("System Diagnostics & Deliberation Telemetry")).toBeInTheDocument()
    expect(screen.getByText("Telemetry Kernel")).toBeInTheDocument()
    expect(screen.getByText("Anti-Bandwagoning")).toBeInTheDocument()
    expect(screen.getByText("SHA-256 AI Attestation")).toBeInTheDocument()
  })

  it("displays calm, inline ballot verification gate above submit button when unverified user interacts with Likert scale", () => {
    render(
      <BivariatePollCard
        pollId="poll-inline-gate"
        questionText="Should public transit fares be subsidized?"
        userContext={unverifiedContext}
      />
    )

    // Initially prior to interaction, inline gate is not active
    expect(screen.queryByTestId("inline-verification-gate")).not.toBeInTheDocument()

    // User interacts with Likert scale
    const agreeBtn = screen.getByRole("radio", { name: "Agree" })
    fireEvent.click(agreeBtn)

    // Inline gate becomes visible directly above the submit button
    const inlineGate = screen.getByTestId("inline-verification-gate")
    expect(inlineGate).toBeInTheDocument()
    expect(inlineGate).toHaveTextContent("Confirm Your Account to Vote")
    expect(inlineGate).toHaveTextContent("To ensure one person equals one vote and keep bots out")

    // Verify direct CTA link on inline gate
    const inlineCta = screen.getAllByRole("link", { name: /Confirm Identity on Hub/i })
    expect(inlineCta.length).toBeGreaterThanOrEqual(1)
    expect(inlineCta[0].getAttribute("href")).toContain("redirectTo=")
    expect(inlineCta[0]).toHaveClass("min-h-[44px]")
    expect(inlineCta[0]).toHaveClass("bg-amber-400")
    expect(inlineCta[0]).toHaveClass("text-slate-950")
  })
})
