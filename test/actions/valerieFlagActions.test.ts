import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  flagPollWithCommitGate,
  VALID_FLAG_REASONS,
  resolveCoarseLocaleBuckets,
  resolveUserThetaVector,
} from "@/app/actions/valerieFlagActions";
import { VECTOR_DIM } from "@/lib/ai/embedding";

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
let mockInsertResult: any = { data: { id: "flag-123", locked_until: "2026-10-20T17:00:00.000Z" }, error: null };
let mockPastResponses: any = [];

const mockInsert = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(async () => mockInsertResult),
  })),
}));

const mockFrom = vi.fn((tableName: string) => {
  if (tableName === "poll_flags") {
    return {
      insert: mockInsert,
    };
  }
  if (tableName === "poll_responses") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: mockPastResponses, error: null })),
          })),
        })),
      })),
    };
  }
  return {
    select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: [], error: null })) })),
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
  })),
}));

describe("flagPollWithCommitGate Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHeader.mockReset();
    mockUser = {
      id: "user-human-1",
      app_metadata: {
        is_human: true,
        trust_state: "active",
        verification_tier: "COMMUNITY_VERIFIED",
      },
      user_metadata: {},
    };
    mockInsertResult = {
      data: { id: "flag-123", locked_until: "2026-10-20T17:00:00.000Z" },
      error: null,
    };
    mockPastResponses = [];
  });

  it("exports valid diagnostic flag reasons", () => {
    expect(VALID_FLAG_REASONS).toEqual([
      "LOADED_FRAMING",
      "FALSE_DICHOTOMY",
      "DISPUTED_PREMISE",
      "LOCALE_MISMATCH",
    ]);
  });

  it("rejects unauthenticated callers", async () => {
    mockUser = null;
    const result = await flagPollWithCommitGate({
      pollId: "poll-1",
      flagReason: "FALSE_DICHOTOMY",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must be signed in/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects unverified human or quarantined callers", async () => {
    mockUser = {
      id: "user-unverified",
      app_metadata: {
        is_human: false,
        trust_state: "quarantined",
      },
    };

    const result = await flagPollWithCommitGate({
      pollId: "poll-1",
      flagReason: "LOADED_FRAMING",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Single-human identity verification required/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects invalid flag reasons with a descriptive error", async () => {
    const result = await flagPollWithCommitGate({
      pollId: "poll-1",
      flagReason: "INVALID_REASON" as any,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid flag reason/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("successfully commits structured flag with 24h lockedUntil timestamp", async () => {
    mockGetHeader.mockImplementation((headerName: string) => {
      if (headerName === "cf-ipcountry") return "US";
      if (headerName === "x-admin1-code") return "CA";
      if (headerName === "x-h3-res7") return "872830828ffffff";
      return null;
    });

    const result = await flagPollWithCommitGate({
      pollId: "poll-1",
      flagReason: "FALSE_DICHOTOMY",
      suggestedAxisComment: "Misses the housing density perspective",
    });

    expect(result.success).toBe(true);
    expect(result.lockedUntil).toBe("2026-10-20T17:00:00.000Z");
    expect(result.flagId).toBe("flag-123");

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertPayload = (mockInsert.mock.calls as any)[0]?.[0];
    expect(insertPayload.poll_id).toBe("poll-1");
    expect(insertPayload.user_id).toBe("user-human-1");
    expect(insertPayload.flag_reason).toBe("FALSE_DICHOTOMY");
    expect(insertPayload.suggested_axis_comment).toBe("Misses the housing density perspective");
    expect(insertPayload.country_iso).toBe("US");
    expect(insertPayload.admin1_code).toBe("CA");
    expect(insertPayload.h3_res7).toBe("872830828ffffff");
    expect(insertPayload.user_theta_snapshot).toBeDefined();
    expect(insertPayload.comment_embedding).toBeDefined();
  });

  it("handles duplicate flag attempt gracefully (code 23505)", async () => {
    mockInsertResult = {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    };

    const result = await flagPollWithCommitGate({
      pollId: "poll-1",
      flagReason: "DISPUTED_PREMISE",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already submitted a premise challenge/i);
  });

  it("resolves coarse locale buckets without persisting raw coordinates", async () => {
    mockGetHeader.mockImplementation((h: string) => {
      if (h === "x-country-iso") return "CA";
      if (h === "x-admin1-code") return "ON";
      if (h === "x-admin2-code") return "Toronto";
      return null;
    });

    const buckets = await resolveCoarseLocaleBuckets();
    expect(buckets.country_iso).toBe("CA");
    expect(buckets.admin1_code).toBe("ON");
    expect(buckets.admin2_code).toBe("Toronto");
    // Verify no latitude or longitude fields exist
    expect((buckets as any).latitude).toBeUndefined();
    expect((buckets as any).longitude).toBeUndefined();
  });

  it("resolves a 1536-dimensional user_theta_snapshot unit vector", async () => {
    const vector = await resolveUserThetaVector(
      { schema: mockSchema },
      "user-test-uuid",
      { user_metadata: {} }
    );

    expect(vector).toHaveLength(VECTOR_DIM);
    let normSq = 0;
    for (const val of vector) {
      normSq += val * val;
    }
    expect(Math.sqrt(normSq)).toBeCloseTo(1.0, 4);
  });
});
