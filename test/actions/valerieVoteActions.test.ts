import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitVote, castVote } from "@/app/actions/valerieVoteActions";

// Mock next/headers
const mockGetHeader = vi.fn();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => mockGetHeader(name),
  })),
  cookies: vi.fn(async () => ({
    getAll: () => [],
    get: () => undefined,
  })),
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock supabase client
let mockUser: any = null;
let mockInsertResult: any = { data: { id: "resp-101", locked_until: "2026-10-20T18:00:00.000Z" }, error: null };
let capturedInsertPayload: any = null;

const mockInvoke = vi.fn(async () => ({ data: {}, error: null }));

const mockInsert = vi.fn((payload: any) => {
  capturedInsertPayload = payload;
  return {
    select: vi.fn(() => ({
      single: vi.fn(async () => mockInsertResult),
    })),
  };
});

const mockFrom = vi.fn((tableName: string) => {
  if (tableName === "poll_responses") {
    return {
      insert: mockInsert,
    };
  }
  return {
    insert: vi.fn(),
  };
});

const mockSchema = vi.fn(() => ({
  from: mockFrom,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockUser },
        error: mockUser ? null : new Error("Not signed in"),
      })),
    },
    schema: mockSchema,
    functions: {
      invoke: mockInvoke,
    },
  })),
}));

describe("valerieVoteActions (submitVote & castVote)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHeader.mockReset();
    capturedInsertPayload = null;
    mockUser = {
      id: "usr-voter-42",
      app_metadata: {
        is_human: true,
        trust_state: "active",
        verification_tier: "COMMUNITY_VERIFIED",
      },
      user_metadata: {},
    };
    mockInsertResult = {
      data: { id: "resp-101", locked_until: "2026-10-20T18:00:00.000Z" },
      error: null,
    };
  });

  it("stamps resolved coarse locale tiers into poll_responses insert payload", async () => {
    mockGetHeader.mockImplementation((name: string) => {
      if (name === "x-country-iso") return "US";
      if (name === "x-admin1-code") return "US-OH";
      if (name === "x-admin2-code") return "Franklin";
      if (name === "x-h3-res7") return "872a956abffffff";
      return null;
    });

    const result = await castVote({
      pollId: "poll-uuid-1",
      likertScore: 1,
      confidenceScore: 85,
      comment: "Solid infrastructure proposal",
    });

    expect(result.success).toBe(true);
    expect(result.lockedUntil).toBe("2026-10-20T18:00:00.000Z");

    // Verify database insert payload
    expect(mockSchema).toHaveBeenCalledWith("valerie");
    expect(mockFrom).toHaveBeenCalledWith("poll_responses");
    expect(capturedInsertPayload).toBeDefined();
    expect(capturedInsertPayload.poll_id).toBe("poll-uuid-1");
    expect(capturedInsertPayload.user_id).toBe("usr-voter-42");
    expect(capturedInsertPayload.likert_score).toBe(1);
    expect(capturedInsertPayload.confidence_score).toBe(85);
    expect(capturedInsertPayload.comment).toBe("Solid infrastructure proposal");
    expect(capturedInsertPayload.country_iso).toBe("US");
    expect(capturedInsertPayload.admin1_code).toBe("US-OH");
    expect(capturedInsertPayload.admin2_code).toBe("Franklin");
    expect(capturedInsertPayload.h3_res7).toBe("872a956abffffff");
    expect(capturedInsertPayload.h3_hex_index).toBe("872a956abffffff");

    // Critical Zero-Coordinate Verification: No raw coordinates persisted to PostgreSQL
    expect(capturedInsertPayload.latitude).toBeUndefined();
    expect(capturedInsertPayload.longitude).toBeUndefined();
    expect(capturedInsertPayload.lat).toBeUndefined();
    expect(capturedInsertPayload.lng).toBeUndefined();
  });

  it("computes H3 res-7 from ephemeral coarse coordinates in headers without leaking coordinates to DB", async () => {
    mockGetHeader.mockImplementation((name: string) => {
      if (name === "x-country-iso") return "US";
      if (name === "x-admin1-code") return "US-OH";
      if (name === "x-vercel-ip-latitude") return "39.9612";
      if (name === "x-vercel-ip-longitude") return "-82.9988";
      return null;
    });

    const result = await submitVote({
      pollId: "poll-uuid-2",
      likertScore: 2,
      confidenceScore: 90,
    });

    expect(result.success).toBe(true);
    expect(capturedInsertPayload.h3_res7).toBe("872a956abffffff");
    expect(capturedInsertPayload.country_iso).toBe("US");
    expect(capturedInsertPayload.admin1_code).toBe("US-OH");

    // Coordinate privacy assertion
    expect(capturedInsertPayload.latitude).toBeUndefined();
    expect(capturedInsertPayload.longitude).toBeUndefined();
    expect(capturedInsertPayload.lat).toBeUndefined();
    expect(capturedInsertPayload.lng).toBeUndefined();
  });

  it("uses explicit h3HexIndex from payload if header resolution is absent", async () => {
    mockGetHeader.mockReturnValue(null);

    const result = await castVote({
      pollId: "poll-uuid-3",
      likertScore: -1,
      confidenceScore: 50,
      h3HexIndex: "872a956abffffff",
    });

    expect(result.success).toBe(true);
    expect(capturedInsertPayload.h3_res7).toBe("872a956abffffff");
    expect(capturedInsertPayload.h3_hex_index).toBe("872a956abffffff");
    expect(capturedInsertPayload.country_iso).toBeNull();
  });

  it("blocks unauthenticated users from casting votes", async () => {
    mockUser = null;

    const result = await castVote({
      pollId: "poll-uuid-4",
      likertScore: 0,
      confidenceScore: 50,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("signed in");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("blocks unverified accounts that fail Anti-Sybil human checks", async () => {
    mockUser.app_metadata.is_human = false;
    mockUser.app_metadata.anti_sybil_verified = false;
    mockUser.app_metadata.verification_tier = "UNVERIFIED";
    mockUser.app_metadata.trust_state = "quarantined";

    const result = await castVote({
      pollId: "poll-uuid-5",
      likertScore: 0,
      confidenceScore: 50,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Single-human identity verification required");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("validates Likert score and confidence score bounds", async () => {
    const invalidLikert = await castVote({
      pollId: "poll-uuid-6",
      likertScore: 5, // out of range [-2, 2]
      confidenceScore: 50,
    });
    expect(invalidLikert.success).toBe(false);
    expect(invalidLikert.error).toContain("Invalid sentiment score");

    const invalidConf = await castVote({
      pollId: "poll-uuid-6",
      likertScore: 1,
      confidenceScore: 150, // out of range [0, 100]
    });
    expect(invalidConf.success).toBe(false);
    expect(invalidConf.error).toContain("Invalid confidence score");
  });

  it("handles duplicate votes gracefully on unique violation (code 23505)", async () => {
    mockInsertResult = {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    };

    const result = await castVote({
      pollId: "poll-uuid-7",
      likertScore: 1,
      confidenceScore: 60,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("already voted");
  });

  it("recovers gracefully from unexpected exceptions without bubbling up unhandled errors", async () => {
    mockInsert.mockImplementationOnce(() => {
      throw new Error("Unexpected database connection crash");
    });

    const result = await castVote({
      pollId: "poll-uuid-8",
      likertScore: 1,
      confidenceScore: 70,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unexpected database connection crash");
  });

  it("safely falls back to 24h lockedUntil when data.locked_until is null", async () => {
    mockInsertResult = {
      data: { id: "resp-202", locked_until: null },
      error: null,
    };

    const result = await castVote({
      pollId: "poll-uuid-9",
      likertScore: -1,
      confidenceScore: 40,
    });

    expect(result.success).toBe(true);
    expect(result.lockedUntil).toBeDefined();
    expect(new Date(result.lockedUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it("authenticates via middleware headers when direct Supabase SSR session is missing", async () => {
    mockUser = null;
    mockGetHeader.mockImplementation((name: string) => {
      if (name === "x-user-id") return "usr-middleware-header-99";
      if (name === "x-is-human-verified") return "true";
      if (name === "x-verification-tier") return "COMMUNITY_VERIFIED";
      if (name === "x-trust-state") return "active";
      return null;
    });

    const result = await castVote({
      pollId: "poll-uuid-10",
      likertScore: 0,
      confidenceScore: 50,
    });

    expect(result.success).toBe(true);
    expect(capturedInsertPayload.user_id).toBe("usr-middleware-header-99");
  });
});
