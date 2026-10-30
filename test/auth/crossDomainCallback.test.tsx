import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import AuthCallbackPage from "@/app/auth/callback/page"
import {
  parseCallbackTokens,
  verifyAntiSybilClaim,
  getClientCookieStrings,
  sanitizeReturnTo,
} from "@/lib/auth/callback"
import { hydrateSessionAction } from "@/app/actions/auth"

// Helper to create mock JWT
function createTestJWT(payload: Record<string, unknown>): string {
  const encHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
  const encPayload = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
  return `${encHeader}.${encPayload}.mock_sig`
}

// Mock Supabase client
const mockSetSession = vi.fn().mockResolvedValue({ data: { session: {} }, error: null })
const mockExchangeCode = vi.fn().mockResolvedValue({
  data: { session: { access_token: "code_access_token", refresh_token: "code_refresh_token" } },
  error: null,
})

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      setSession: mockSetSession,
      exchangeCodeForSession: mockExchangeCode,
    },
  }),
}))

// Mock Server Actions
const mockHydrateSessionAction = vi.fn().mockResolvedValue({
  success: true,
  userId: "user-123",
  isHumanVerified: true,
})

vi.mock("@/app/actions/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/actions/auth")>()
  return {
    ...actual,
    hydrateSessionAction: (...args: any[]) => mockHydrateSessionAction(...args),
  }
})

describe("Cross-Domain Hub Callback Token Processing (lib/auth/callback.ts)", () => {
  const now = Math.floor(Date.now() / 1000)

  const verifiedJWT = createTestJWT({
    sub: "usr-verified-citizen-001",
    exp: now + 3600,
    user_metadata: {
      is_human_verified: true,
      full_name: "Citizen Alice",
    },
    app_metadata: {
      verification_tier: "COMMUNITY_VERIFIED",
      trust_state: "active",
    },
  })

  const unverifiedJWT = createTestJWT({
    sub: "usr-unverified-guest-002",
    exp: now + 3600,
    user_metadata: {
      is_human_verified: false,
    },
    app_metadata: {
      verification_tier: "UNVERIFIED",
      trust_state: "active",
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("parseCallbackTokens", () => {
    it("extracts access_token and refresh_token from URL hash fragments", () => {
      const hash = `#access_token=${verifiedJWT}&refresh_token=refresh_abc123&expires_in=3600&token_type=bearer`
      const tokens = parseCallbackTokens(hash, "")

      expect(tokens.accessToken).toBe(verifiedJWT)
      expect(tokens.refreshToken).toBe("refresh_abc123")
      expect(tokens.returnTo).toBe("/deliberation")
      expect(tokens.error).toBeNull()
    })

    it("parses tokens and custom return_to from hash fragment", () => {
      const hash = `#access_token=${verifiedJWT}&refresh_token=refresh_abc123&return_to=/poll/pol-456`
      const tokens = parseCallbackTokens(hash, "")

      expect(tokens.accessToken).toBe(verifiedJWT)
      expect(tokens.refreshToken).toBe("refresh_abc123")
      expect(tokens.returnTo).toBe("/poll/pol-456")
    })

    it("rejects tokens in query parameters to prevent credential exposure in URLs/logs", () => {
      const search = `?access_token=${verifiedJWT}&refresh_token=refresh_xyz789&return_to=/settings`
      const tokens = parseCallbackTokens("", search)

      expect(tokens.accessToken).toBeNull()
      expect(tokens.refreshToken).toBeNull()
      expect(tokens.returnTo).toBe("/settings")
    })

    it("extracts authorization code for PKCE flow", () => {
      const search = "?code=auth_code_pkce_999&state=%2Fdeliberation"
      const tokens = parseCallbackTokens("", search)

      expect(tokens.code).toBe("auth_code_pkce_999")
      expect(tokens.returnTo).toBe("/deliberation")
    })

    it("captures OAuth error parameters cleanly", () => {
      const hash = "#error=access_denied&error_description=User+cancelled+verification"
      const tokens = parseCallbackTokens(hash, "")

      expect(tokens.error).toBe("access_denied")
      expect(tokens.errorDescription).toBe("User cancelled verification")
    })

    it("sanitizes open-redirect attempts to local relative paths while accepting trusted apex domains", () => {
      expect(sanitizeReturnTo("https://evil.com")).toBe("/deliberation")
      expect(sanitizeReturnTo("//malicious-site.com")).toBe("/deliberation")
      expect(sanitizeReturnTo("/\\evil.com")).toBe("/deliberation")
      expect(sanitizeReturnTo("/\n/evil.example")).toBe("/deliberation")
      expect(sanitizeReturnTo("/\r\n/evil.example")).toBe("/deliberation")
      expect(sanitizeReturnTo("https://votary.app/settings")).toBe("/settings")
      expect(sanitizeReturnTo("https://deliberation.votary.app/poll/123?active=true#tally")).toBe("https://deliberation.votary.app/poll/123?active=true#tally")
      // Rejects cross-apex redirects to prevent cookie loss
      expect(sanitizeReturnTo("https://deliberation.votary.app/poll/123", "valerie.sunshade.icu")).toBe("/deliberation")
      expect(sanitizeReturnTo("https://valerie-stag.sunshade.icu/poll/123", "valerie.sunshade.icu")).toBe("https://valerie-stag.sunshade.icu/poll/123")
      expect(sanitizeReturnTo("/poll/123")).toBe("/poll/123")
      expect(sanitizeReturnTo("")).toBe("/deliberation")
    })
  })

  describe("verifyAntiSybilClaim", () => {
    it("validates human verification status when is_human_verified is true in user metadata", () => {
      const result = verifyAntiSybilClaim(verifiedJWT)

      expect(result.isHumanVerified).toBe(true)
      expect(result.userId).toBe("usr-verified-citizen-001")
      expect(result.verificationTier).toBe("COMMUNITY_VERIFIED")
      expect(result.trustState).toBe("active")
    })

    it("strictly rejects human verification if trust state is slashed even with verified claims", () => {
      const slashedJWT = createTestJWT({
        sub: "usr-slashed-003",
        exp: now + 3600,
        user_metadata: { is_human_verified: true },
        app_metadata: { is_human: true, trust_state: "slashed", verification_tier: "COMMUNITY_VERIFIED" },
      })
      const result = verifyAntiSybilClaim(slashedJWT)

      expect(result.isHumanVerified).toBe(false)
      expect(result.trustState).toBe("slashed")
    })

    it("identifies unverified accounts when is_human_verified is absent or false", () => {
      const result = verifyAntiSybilClaim(unverifiedJWT)

      expect(result.isHumanVerified).toBe(false)
      expect(result.userId).toBe("usr-unverified-guest-002")
      expect(result.verificationTier).toBe("UNVERIFIED")
    })

    it("handles null or malformed tokens without throwing", () => {
      const result = verifyAntiSybilClaim("not-a-valid-token")
      expect(result.isHumanVerified).toBe(false)
      expect(result.userId).toBeNull()
    })
  })

  describe("getClientCookieStrings", () => {
    it("generates safe non-sensitive session presence flag without exposing raw JWTs or refresh tokens", () => {
      const cookies = getClientCookieStrings("mock_token_123", "mock_refresh_456", "votary.app")

      expect(cookies.some((c) => c.startsWith("votary_session_active=true") && c.includes("domain=.votary.app"))).toBe(true)
      expect(cookies.some((c) => c.startsWith("sunshade_sso="))).toBe(false)
      expect(cookies.some((c) => c.startsWith("sb-access-token="))).toBe(false)
      expect(cookies.some((c) => c.startsWith("sb-refresh-token="))).toBe(false)
    })

    it("supports subdomains of votary.app with wildcard apex domain", () => {
      const cookies = getClientCookieStrings("mock_token_123", null, "deliberation.votary.app")

      expect(cookies.some((c) => c.includes("domain=.votary.app"))).toBe(true)
    })
  })
})

describe("AuthCallbackPage Component (app/auth/callback/page.tsx)", () => {
  const mockReplace = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    delete (window as any).location
    window.location = {
      hash: "",
      search: "",
      hostname: "votary.app",
      protocol: "https:",
      replace: mockReplace,
    } as any
  })

  it("hydrates session and smoothly redirects to /deliberation from hash fragment", async () => {
    const token = createTestJWT({
      sub: "usr-citizen-42",
      user_metadata: { is_human_verified: true },
      app_metadata: { verification_tier: "ANCHOR", trust_state: "active" },
    })

    window.location.hash = `#access_token=${token}&refresh_token=refresh_secret_777`

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: token,
        refresh_token: "refresh_secret_777",
      })
      expect(mockHydrateSessionAction).toHaveBeenCalledWith(token, "refresh_secret_777")
      expect(mockReplace).toHaveBeenCalledWith("/deliberation")
    })
  })

  it("respects custom return_to destination from query parameters without redirect loops", async () => {
    const token = createTestJWT({
      sub: "usr-citizen-42",
      user_metadata: { is_human_verified: true },
    })

    window.location.hash = `#access_token=${token}&refresh_token=refresh_123`
    window.location.search = "?return_to=%2Fpolls%2Fpoll-999"

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/polls/poll-999")
    })
  })

  it("displays error card when callback URL contains OAuth error", async () => {
    window.location.hash = "#error=access_denied&error_description=Verification+denied+by+user"

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(screen.getByText(/Authentication Incomplete/i)).toBeInTheDocument()
      expect(screen.getByText(/Verification denied by user/i)).toBeInTheDocument()
      expect(screen.getByRole("link", { name: /Return to Deliberation/i })).toBeInTheDocument()
    })
  })

  it("displays error card when server session hydration rejects token", async () => {
    mockHydrateSessionAction.mockResolvedValueOnce({
      success: false,
      userId: null,
      isHumanVerified: false,
      error: "Invalid or unverified access token",
    })

    const token = createTestJWT({
      sub: "usr-citizen-42",
      user_metadata: { is_human_verified: true },
    })

    window.location.hash = `#access_token=${token}&refresh_token=refresh_123`

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(screen.getByText(/Authentication Incomplete/i)).toBeInTheDocument()
      expect(screen.getByText(/Invalid or unverified access token/i)).toBeInTheDocument()
      expect(mockReplace).not.toHaveBeenCalled()
    })
  })
})
