import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeClusterNode,
  buildNestedClusterTree,
  getClusterLineage,
  type ClusterLineageNode,
} from "@/app/actions/valerieClusterActions";

// Mock next/cache unstable_cache to execute the handler directly
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((fn: (...args: any[]) => any) => {
    return async (...args: any[]) => fn(...args);
  }),
}));

// Mock next/headers cookies
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockImplementation(() =>
    Promise.resolve({
      getAll: () => [],
      get: () => undefined,
    })
  ),
}));

// Mock Supabase client
let mockRpcResult: { data: any; error: any } = { data: [], error: null };
let lastRpcName = "";
let lastRpcParams: Record<string, any> = {};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn().mockImplementation(() => ({
    schema: () => ({
      rpc: (name: string, params: Record<string, any>) => {
        lastRpcName = name;
        lastRpcParams = params;
        return Promise.resolve(mockRpcResult);
      },
    }),
    rpc: (name: string, params: Record<string, any>) => {
      lastRpcName = name;
      lastRpcParams = params;
      return Promise.resolve(mockRpcResult);
    },
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(() =>
    Promise.resolve({
      schema: () => ({
        rpc: (name: string, params: Record<string, any>) => {
          lastRpcName = name;
          lastRpcParams = params;
          return Promise.resolve(mockRpcResult);
        },
      }),
      rpc: (name: string, params: Record<string, any>) => {
        lastRpcName = name;
        lastRpcParams = params;
        return Promise.resolve(mockRpcResult);
      },
    })
  ),
}));

describe("Cluster Lineage & Hierarchy API (TASK-VAL-VEC-HIERARCHY)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastRpcName = "";
    lastRpcParams = {};
    mockRpcResult = { data: [], error: null };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
  });

  describe("sanitizeClusterNode", () => {
    it("converts raw database rows into typed ClusterLineageNode", () => {
      const raw = {
        id: "c1-uuid",
        cluster_name: "Urban Infrastructure",
        parent_cluster_id: null,
        depth: 0,
        path: ["c1-uuid"],
        is_active: true,
        member_count: 42,
        variance: 0.12,
        avg_likert: 1.45,
        avg_confidence: 82.5,
        total_votes: 120,
        active_weight: 42.0,
        children: [],
      };

      const sanitized = sanitizeClusterNode(raw);
      expect(sanitized.id).toBe("c1-uuid");
      expect(sanitized.cluster_name).toBe("Urban Infrastructure");
      expect(sanitized.parent_cluster_id).toBeNull();
      expect(sanitized.depth).toBe(0);
      expect(sanitized.active_weight).toBe(42.0);
      expect(sanitized.children).toEqual([]);
    });

    it("sorts nested children by active_weight descending", () => {
      const raw = {
        id: "root-uuid",
        cluster_name: "Root",
        active_weight: 100,
        children: [
          { id: "child-low", cluster_name: "Low Weight", active_weight: 10, children: [] },
          { id: "child-high", cluster_name: "High Weight", active_weight: 50, children: [] },
          { id: "child-mid", cluster_name: "Mid Weight", active_weight: 25, children: [] },
        ],
      };

      const sanitized = sanitizeClusterNode(raw);
      expect(sanitized.children).toHaveLength(3);
      expect(sanitized.children[0].id).toBe("child-high");
      expect(sanitized.children[1].id).toBe("child-mid");
      expect(sanitized.children[2].id).toBe("child-low");
    });
  });

  describe("buildNestedClusterTree", () => {
    it("assembles multi-tier parent-child trees from flat records", () => {
      const flatNodes: ClusterLineageNode[] = [
        {
          id: "root-1",
          cluster_name: "Root Macro",
          parent_cluster_id: null,
          depth: 0,
          path: ["root-1"],
          is_active: true,
          member_count: 50,
          variance: 0.2,
          avg_likert: 0.8,
          avg_confidence: 70,
          total_votes: 15,
          active_weight: 50,
          children: [],
        },
        {
          id: "child-1",
          cluster_name: "Child Subtopic A",
          parent_cluster_id: "root-1",
          depth: 1,
          path: ["root-1", "child-1"],
          is_active: true,
          member_count: 30,
          variance: 0.1,
          avg_likert: 1.1,
          avg_confidence: 75,
          total_votes: 10,
          active_weight: 30,
          children: [],
        },
        {
          id: "grandchild-1",
          cluster_name: "Grandchild Split",
          parent_cluster_id: "child-1",
          depth: 2,
          path: ["root-1", "child-1", "grandchild-1"],
          is_active: true,
          member_count: 12,
          variance: 0.05,
          avg_likert: 1.5,
          avg_confidence: 85,
          total_votes: 5,
          active_weight: 12,
          children: [],
        },
      ];

      const tree = buildNestedClusterTree(flatNodes);
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe("root-1");
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe("child-1");
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].id).toBe("grandchild-1");
    });

    it("returns empty array for empty inputs", () => {
      expect(buildNestedClusterTree([])).toEqual([]);
    });
  });

  describe("getClusterLineage Server Action", () => {
    it("calls get_cluster_lineage RPC without params when rootId is omitted", async () => {
      mockRpcResult = {
        data: [
          {
            id: "root-1",
            cluster_name: "Macro Topic",
            parent_cluster_id: null,
            depth: 0,
            path: ["root-1"],
            is_active: true,
            member_count: 20,
            variance: 0.1,
            avg_likert: 1.0,
            avg_confidence: 75,
            total_votes: 8,
            active_weight: 20,
            children: [],
          },
        ],
        error: null,
      };

      const result = await getClusterLineage();
      expect(result.success).toBe(true);
      expect(lastRpcName).toBe("get_cluster_lineage");
      expect(lastRpcParams).toEqual({});
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("root-1");
    });

    it("passes p_root_cluster_id param when rootId is provided", async () => {
      const targetId = "target-root-uuid";
      mockRpcResult = {
        data: [
          {
            id: targetId,
            cluster_name: "Target Subtree Root",
            parent_cluster_id: null,
            depth: 0,
            path: [targetId],
            is_active: true,
            member_count: 15,
            variance: 0.15,
            avg_likert: 0.5,
            avg_confidence: 65,
            total_votes: 4,
            active_weight: 15,
            children: [],
          },
        ],
        error: null,
      };

      const result = await getClusterLineage(targetId);
      expect(result.success).toBe(true);
      expect(lastRpcParams).toEqual({ p_root_cluster_id: targetId });
      expect(result.data[0].id).toBe(targetId);
    });

    it("returns empty list gracefully when query yields zero rows (Zero Mock Data)", async () => {
      mockRpcResult = { data: [], error: null };
      const result = await getClusterLineage();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.rawRows).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it("guards against Supabase errors and returns descriptive failure", async () => {
      mockRpcResult = {
        data: null,
        error: { message: "AUTH_REQUIRED: Authentication required to view cluster lineage." },
      };

      const result = await getClusterLineage();
      expect(result.success).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toContain("AUTH_REQUIRED");
    });
  });
});
