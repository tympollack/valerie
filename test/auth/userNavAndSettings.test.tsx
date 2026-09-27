import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { UserNav } from "@/components/valerie/UserNav"
import { SettingsView } from "@/components/valerie/SettingsView"
import type { UserContext } from "@/app/actions/auth"

// Mock next/navigation
const mockRefresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

// Mock auth actions
const mockSignOutAction = vi.fn().mockResolvedValue({ success: true })
vi.mock("@/app/actions/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/actions/auth")>()
  return {
    ...actual,
    signOutAction: () => mockSignOutAction(),
  }
})

// Mock Supabase client
const mockSignOut = vi.fn().mockResolvedValue({ error: null })
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: mockSignOut,
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}))

describe("UserNav Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders Sign In button when unauthenticated", () => {
    const unauthContext: UserContext = {
      authenticated: false,
      userId: null,
      email: null,
      displayName: null,
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "active",
    }

    render(<UserNav initialUserContext={unauthContext} />)

    expect(screen.getByText(/Sign In/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Settings/i })).toBeInTheDocument()
  })

  it("renders verified status and avatar when authenticated and verified", () => {
    const verifiedContext: UserContext = {
      authenticated: true,
      userId: "usr-verified-1234",
      email: "citizen@sunshade.icu",
      displayName: "Alice Citizen",
      isHumanVerified: true,
      verificationTier: "COMMUNITY_VERIFIED",
      trustState: "active",
    }

    render(<UserNav initialUserContext={verifiedContext} />)

    expect(screen.getByText(/Alice Citizen/i)).toBeInTheDocument()
    expect(screen.getByText(/Verified Human/i)).toBeInTheDocument()
  })

  it("renders unverified status when authenticated but not human-verified", () => {
    const unverifiedContext: UserContext = {
      authenticated: true,
      userId: "usr-unverified-5678",
      email: "unverified@sunshade.icu",
      displayName: "Bob Smith",
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "active",
    }

    render(<UserNav initialUserContext={unverifiedContext} />)

    expect(screen.getByText(/Bob Smith/i)).toBeInTheDocument()
    expect(screen.getByText("Unverified")).toBeInTheDocument()
  })

  it("opens popover menu and triggers sign out", async () => {
    const context: UserContext = {
      authenticated: true,
      userId: "usr-test-123",
      email: "test@sunshade.icu",
      displayName: "Test User",
      isHumanVerified: true,
      verificationTier: "ANCHOR",
      trustState: "active",
    }

    render(<UserNav initialUserContext={context} />)

    // Click user account menu button
    const trigger = screen.getByRole("button", { name: /User Account Menu/i })
    fireEvent.click(trigger)

    // Verify popover menu items
    expect(screen.getByText(/Single-Human Verified/i)).toBeInTheDocument()
    expect(screen.getByText(/Voting Rights Active/i)).toBeInTheDocument()
    expect(screen.getByText(/Account & Settings/i)).toBeInTheDocument()

    // Click Sign Out
    const signOutBtn = screen.getByRole("button", { name: /Sign Out/i })
    await act(async () => {
      fireEvent.click(signOutBtn)
    })

    expect(mockSignOut).toHaveBeenCalled()
    expect(mockSignOutAction).toHaveBeenCalled()
  })
})

describe("SettingsView Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("displays verified identity and voting eligibility", () => {
    const verifiedContext: UserContext = {
      authenticated: true,
      userId: "usr-verified-9999",
      email: "verified@sunshade.icu",
      displayName: "Verified Voter",
      isHumanVerified: true,
      verificationTier: "ANCHOR",
      trustState: "active",
    }

    render(<SettingsView userContext={verifiedContext} />)

    expect(screen.getByText(/SSO Connected/i)).toBeInTheDocument()
    expect(screen.getByText(/verified@sunshade.icu/i)).toBeInTheDocument()
    expect(screen.getByText("VERIFIED HUMAN")).toBeInTheDocument()
    expect(
      screen.getByText(/Eligible \(1 Human, 1 Vote\)/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Complete Single-Human Verification on SunShade Hub/i)
    ).not.toBeInTheDocument()
  })

  it("displays verification required banner and action button when unverified", () => {
    const unverifiedContext: UserContext = {
      authenticated: true,
      userId: "usr-unverified-4444",
      email: "guest@sunshade.icu",
      displayName: "Guest Voter",
      isHumanVerified: false,
      verificationTier: "UNVERIFIED",
      trustState: "active",
    }

    render(<SettingsView userContext={unverifiedContext} />)

    expect(screen.getByText(/VERIFICATION REQUIRED/i)).toBeInTheDocument()
    expect(screen.getByText(/Locked \(Requires Proof\)/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Complete Single-Human Verification on SunShade Hub/i)
    ).toBeInTheDocument()
  })
})
