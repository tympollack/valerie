import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPersonalizedDigest } from "@/app/actions/valerieDigestActions";

let mockUserContext: any = {
  authenticated: true,
  userId: "user-123",
  email: "curator@sunshade.icu",
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

let capturedRpcCall: { method: string; params: any } | null = null;

const mockRpc = vi.fn(async (method: string, params: any) => {
  capturedRpcCall = { method, params };
  return mockRpcResult;
});

vi.mock("@/app/actions/auth", () => ({
  getCurrentUserContext: vi.fn(async () => mockUserContext),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    schema: vi.fn((schemaName: string) => ({
      rpc: mockRpc,
    })),
  })),
}));

describe("app/actions/valerieDigestActions - getPersonalizedDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRpcCall = null;
    mockUserContext = {
      authenticated: true,
      userId: "user-123",
      email: "curator@sunshade.icu",
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

  it("respects custom limit and userIdOverride", async () => {
    const res = await getPersonalizedDigest({ limit: 10, userIdOverride: "custom-user-999" });

    expect(res.success).toBe(true);
    expect(capturedRpcCall?.params).toEqual({
      p_user_id: "custom-user-999",
      p_limit: 10,
    });
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

  it("handles RPC database errors gracefully without throwing unhandled exceptions", async () => {
    mockRpcResult = {
      data: null,
      error: { message: "Database connection failed", code: "PGRST001" },
    };

    const res = await getPersonalizedDigest();

    expect(res.success).toBe(false);
    expect(res.error).toBe("Database connection failed");
    expect(res.data.items).toHaveLength(0);
    expect(res.data.summary.total).toBe(0);
  });
});
