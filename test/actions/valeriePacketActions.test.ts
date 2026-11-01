import { describe, it, expect, vi, beforeEach } from "vitest";
import { getClusterPacketAction } from "@/app/actions/valeriePacketActions";

let mockRpcResult: any = { data: null, error: null };
let mockPollsQueryResult: any = { data: [], error: null };

const mockRpc = vi.fn(async (rpcName: string, params: any) => {
  return mockRpcResult;
});

const mockSelect = vi.fn(() => ({
  eq: vi.fn(() => ({
    order: vi.fn(() => ({
      limit: vi.fn(async () => mockPollsQueryResult),
    })),
  })),
}));

const mockFrom = vi.fn((tableName: string) => ({
  select: mockSelect,
}));

const mockSchema = vi.fn(() => ({
  rpc: mockRpc,
  from: mockFrom,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    schema: mockSchema,
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

describe("valeriePacketActions: getClusterPacketAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcResult = { data: null, error: null };
    mockPollsQueryResult = { data: [], error: null };
  });

  it("successfully invokes assemble_cluster_packet RPC and unpacks emergency surge packet", async () => {
    const mockPacket = {
      packet_id: "pkt-surge-001",
      is_surge: true,
      cluster_id: "cluster-transit-77",
      material_domain: "Transportation Infrastructure",
      material_consequence_score: 0.95,
      anchor_poll: {
        id: "poll-anchor-1",
        question_text: "Should express lanes be made free during bridge repairs?",
        axis_category: "Transit Equity",
        material_consequence_score: 0.95,
      },
      companion_polls: [
        {
          id: "poll-companion-1",
          question_text: "Should emergency transit shuttles run every 5 minutes?",
          axis_category: "Municipal Service",
        },
        {
          id: "poll-companion-2",
          question_text: "Should parking enforcement be paused along detour corridors?",
          axis_category: "Public Commerce",
        },
      ],
      total_packet_polls: 3,
    };

    mockRpcResult = { data: mockPacket, error: null };

    const result = await getClusterPacketAction({
      userId: "usr-456",
      h3Cell: "87283472bffffff",
    });

    expect(result.success).toBe(true);
    expect(result.data.packet_id).toBe("pkt-surge-001");
    expect(result.data.is_surge).toBe(true);
    expect(result.data.anchor_poll?.id).toBe("poll-anchor-1");
    expect(result.data.companion_polls.length).toBe(2);
    expect(result.data.total_packet_polls).toBe(3);
    expect(mockRpc).toHaveBeenCalledWith("assemble_cluster_packet", {
      p_user_id: "usr-456",
      p_h3_cell: "87283472bffffff",
    });
  });

  it("gracefully falls back to polls table query when RPC fails", async () => {
    mockRpcResult = { data: null, error: { message: "function valerie.assemble_cluster_packet does not exist" } };
    mockPollsQueryResult = {
      data: [
        {
          id: "poll-fb-1",
          question_text: "Fallback Question 1",
          axis_category: "Governance",
        },
        {
          id: "poll-fb-2",
          question_text: "Fallback Question 2",
          axis_category: "Environment",
        },
      ],
      error: null,
    };

    const result = await getClusterPacketAction({
      userId: "usr-999",
    });

    expect(result.success).toBe(true);
    expect(result.data.packet_id).toBe("fallback-poll-fb-1");
    expect(result.data.is_surge).toBe(false);
    expect(result.data.anchor_poll?.id).toBe("poll-fb-1");
    expect(result.data.companion_polls.length).toBe(1);
    expect(result.data.total_packet_polls).toBe(2);
  });

  it("returns safe empty packet when both RPC and fallback query return no polls", async () => {
    mockRpcResult = { data: null, error: { message: "RPC timeout" } };
    mockPollsQueryResult = { data: [], error: null };

    const result = await getClusterPacketAction();

    expect(result.success).toBe(true);
    expect(result.data.packet_id).toBeNull();
    expect(result.data.anchor_poll).toBeNull();
    expect(result.data.companion_polls).toEqual([]);
    expect(result.data.total_packet_polls).toBe(0);
  });
});
