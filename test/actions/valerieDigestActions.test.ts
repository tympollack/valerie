import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPersonalizedDigest } from "@/app/actions/valerieDigestActions";

let mockUserContext: any = {
  authenticated: true,
  userId: "user-123",
  email: "curator@sunshade.icu",
  verificationTier: "TIER_1_BASIC",
};

let mockRpcResult: { data: any; error: any } = {
  data: [
    {
      category: "BLINDSPOT_BRIDGE",
      category_ratio: "10%",
      poll_id: "poll-blindspot-1",
      question_text: "Should algorithmic decisions require cross-spectrum audits?",
      divergence_distance: 0.74,
      cluster_variance: 0.58,
    },
    {
      category: "CIVIC_ANCHOR",
      category_ratio: "30%",
      poll_id: "poll-civic-1",
      question_text: "Local zoning reform in resolution 7 hex cell?",
      scope_tier: "LOCAL",
      participation_count: 85,
    },
    {
      category: "PERSONA_MATCH",
      category_ratio: "60%",
      poll_id: "poll-persona-1",
      question_text: "Decentralized consensus parameters for regional delegates?",
      affinity_score: 0.91,
    },
  ],
  error: null,
};

let mockFallbackPolls: any[] = [];
let mockFallbackError: any = null;
let capturedRpcCall: { method: string; params: any } | null = null;

const mockRpc = vi.fn(async (method: string, params: any) => {
  capturedRpcCall = { method, params };
  return mockRpcResult;
});

const mockFrom = vi.fn((tableName: string) => {
  if (tableName === "polls") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({
              data: mockFallbackPolls,
              error: mockFallbackError,
            })),
          })),
        })),
      })),
    };
  }
  return {};
});

vi.mock("@/app/actions/auth", () => ({
  getCurrentUserContext: vi.fn(async () => mockUserContext),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    schema: vi.fn((schemaName: string) => ({
      rpc: mockRpc,
      from: mockFrom,
    })),
  })),
}));

describe("app/actions/valerieDigestActions - getPersonalizedDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcCall = null;
    mockFallbackPolls = [];
    mockFallbackError = null;
    mockUserContext = {
      authenticated: true,
      userId: "user-123",
      email: "curator@sunshade.icu",
      verificationTier: "TIER_1_BASIC",
    };
    mockRpcResult = {
      data: [
        {
          category: "BLINDSPOT_BRIDGE",
          category_ratio: "10%",
          poll_id: "poll-blindspot-1",
          question_text: "Should algorithmic decisions require cross-spectrum audits?",
          divergence_distance: 0.74,
          cluster_variance: 0.58,
        },
        {
          category: "CIVIC_ANCHOR",
          category_ratio: "30%",
          poll_id: "poll-civic-1",
          question_text: "Local zoning reform in resolution 7 hex cell?",
          scope_tier: "LOCAL",
          participation_count: 85,
        },
        {
          category: "PERSONA_MATCH",
          category_ratio: "60%",
          poll_id: "poll-persona-1",
          question_text: "Decentralized consensus parameters for regional delegates?",
          affinity_score: 0.91,
        },
      ],
      error: null,
    };
  });

  it("successfully invokes assemble_digest_payload with authenticated user ID and default limit", async () => {
    const res = await getPersonalizedDigest();

    expect(res.success).toBe(true);
    expect(capturedRpcCall?.method).toBe("assemble_digest_payload");
    expect(capturedRpcCall?.params).toEqual({
      p_user_id: "user-123",
      p_limit: 5,
    });

    expect(res.data.items).toHaveLength(3);
    expect(res.data.summary.blindspotCount).toBe(1);
    expect(res.data.summary.civicCount).toBe(1);
    expect(res.data.summary.personaCount).toBe(1);
    expect(res.data.summary.total).toBe(3);
  });

  it("respects custom limit and clamps to bounded range", async () => {
    const res = await getPersonalizedDigest({ limit: 10, userIdOverride: "custom-user-999" });

    expect(res.success).toBe(true);
    expect(capturedRpcCall?.params).toEqual({
      p_user_id: "custom-user-999",
      p_limit: 10,
    });

    // Limit exceeding 20 is clamped
    await getPersonalizedDigest({ limit: 50 });
    expect(capturedRpcCall?.params.p_limit).toBe(20);
  });

  it("handles unauthenticated user by dispatching null p_user_id", async () => {
    mockUserContext = {
      authenticated: false,
      userId: null,
    };

    const res = await getPersonalizedDigest();

    expect(res.success).toBe(true);
    expect(capturedRpcCall?.params.p_user_id).toBeNull();
  });

  it("falls back to querying active polls when RPC is not available", async () => {
    mockRpcResult = {
      data: null,
      error: { message: "function valerie.assemble_digest_payload does not exist", code: "42883" },
    };

    mockFallbackPolls = [
      { id: "fallback-poll-1", question_text: "Fallback Question 1", scope_tier: "LOCAL" },
      { id: "fallback-poll-2", question_text: "Fallback Question 2", scope_tier: "STATE" },
      { id: "fallback-poll-3", question_text: "Fallback Question 3", scope_tier: "NATIONAL" },
    ];

    const res = await getPersonalizedDigest();

    expect(res.success).toBe(true);
    expect(res.data.items).toHaveLength(3);
    expect(res.data.items[0].category).toBe("BLINDSPOT_BRIDGE");
    expect(res.data.items[1].category).toBe("CIVIC_ANCHOR");
    expect(res.data.items[2].category).toBe("PERSONA_MATCH");
  });

  it("handles fallback failure cleanly without throwing unhandled exceptions", async () => {
    mockRpcResult = {
      data: null,
      error: { message: "Database connection failed", code: "PGRST001" },
    };
    mockFallbackPolls = [];
    mockFallbackError = { message: "Table not found" };

    const res = await getPersonalizedDigest();

    expect(res.success).toBe(false);
    expect(res.error).toBe("Database connection failed");
    expect(res.data.items).toHaveLength(0);
    expect(res.data.summary.total).toBe(0);
  });
});
