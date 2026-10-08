/**
 * Project Valerie: Multi-Tier Topic Cluster Lineage & Hierarchy Server Actions
 * File: app/actions/valerieClusterActions.ts
 * Work Item: TASK-VAL-VEC-HIERARCHY / STORY-VAL-SEMANTIC-CONSENSUS
 *
 * Exposes server actions for querying hierarchical topic trees with drill-downs
 * from macro categories to localized topic splits. Results are cached via ISR (60s).
 */

"use server";

import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { extractSSOToken } from "@/lib/auth/ssoHandshake";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface ClusterLineageNode {
  id: string;
  cluster_name: string;
  parent_cluster_id: string | null;
  depth: number;
  path: string[];
  is_active: boolean;
  member_count: number;
  variance: number;
  avg_likert: number;
  avg_confidence: number;
  total_votes: number;
  active_weight: number;
  children: ClusterLineageNode[];
}

export interface ClusterLineageResult {
  success: boolean;
  data: ClusterLineageNode[];
  rawRows?: ClusterLineageNode[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Tree Assembly & Sanitization Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw database record into a type-safe ClusterLineageNode.
 */
export function sanitizeClusterNode(raw: any): ClusterLineageNode {
  const childrenRaw = Array.isArray(raw?.children) ? raw.children : [];
  const sanitizedChildren = childrenRaw.map(sanitizeClusterNode);

  // Ensure children are ordered by active_weight DESC, then created_at / cluster_name ASC
  sanitizedChildren.sort((a: ClusterLineageNode, b: ClusterLineageNode) => b.active_weight - a.active_weight);

  return {
    id: String(raw?.id ?? ""),
    cluster_name: String(raw?.cluster_name ?? ""),
    parent_cluster_id: raw?.parent_cluster_id ? String(raw.parent_cluster_id) : null,
    depth: Number(raw?.depth ?? 0),
    path: Array.isArray(raw?.path) ? raw.path.map(String) : [],
    is_active: Boolean(raw?.is_active ?? true),
    member_count: Number(raw?.member_count ?? 0),
    variance: Number(raw?.variance ?? 0),
    avg_likert: Number(raw?.avg_likert ?? 0),
    avg_confidence: Number(raw?.avg_confidence ?? 0),
    total_votes: Number(raw?.total_votes ?? 0),
    active_weight: Number(raw?.active_weight ?? 0),
    children: sanitizedChildren,
  };
}

/**
 * Reconstructs a complete recursive tree from a flat list of nodes if children
 * arrays were not already populated by the RPC.
 */
export function buildNestedClusterTree(nodes: ClusterLineageNode[]): ClusterLineageNode[] {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  const nodeMap = new Map<string, ClusterLineageNode>();
  nodes.forEach((node) => {
    nodeMap.set(node.id, { ...node, children: [...(node.children || [])] });
  });

  const roots: ClusterLineageNode[] = [];

  nodes.forEach((originalNode) => {
    const current = nodeMap.get(originalNode.id)!;
    if (current.parent_cluster_id && nodeMap.has(current.parent_cluster_id)) {
      const parent = nodeMap.get(current.parent_cluster_id)!;
      // Add child if not already present in parent's children array
      if (!parent.children.some((c) => c.id === current.id)) {
        parent.children.push(current);
        parent.children.sort((a, b) => b.active_weight - a.active_weight);
      }
    } else {
      roots.push(current);
    }
  });

  roots.sort((a, b) => b.active_weight - a.active_weight);
  return roots;
}

// ---------------------------------------------------------------------------
// Supabase RPC Executor
// ---------------------------------------------------------------------------

async function fetchLineageFromDb(
  rootId?: string,
  authToken?: string | null
): Promise<ClusterLineageResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      success: false,
      data: [],
      error: "Supabase environment configuration is missing.",
    };
  }

  let client: any;

  if (authToken) {
    client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    });
  } else {
    try {
      client = await createServerClient();
    } catch {
      client = createSupabaseClient(supabaseUrl, supabaseAnonKey);
    }
  }

  const rpcName = "get_cluster_lineage";
  const rpcParams = rootId ? { p_root_cluster_id: rootId } : {};

  try {
    const { data, error } = typeof client?.schema === "function"
      ? await client.schema("valerie").rpc(rpcName, rpcParams)
      : await client.rpc(rpcName, rpcParams);

    if (error) {
      return {
        success: false,
        data: [],
        error: error.message || "Failed to fetch cluster lineage from database.",
      };
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      return {
        success: true,
        data: [],
        rawRows: [],
      };
    }

    const sanitizedRows = data.map(sanitizeClusterNode);

    // Filter to top-level roots for the hierarchical tree response
    let treeRoots: ClusterLineageNode[];
    if (rootId) {
      treeRoots = sanitizedRows.filter((n) => n.id === rootId);
      if (treeRoots.length === 0) {
        treeRoots = sanitizedRows.filter((n) => n.depth === 0);
      }
    } else {
      treeRoots = sanitizedRows.filter((n) => n.parent_cluster_id === null || n.depth === 0);
    }

    if (treeRoots.length === 0 && sanitizedRows.length > 0) {
      treeRoots = buildNestedClusterTree(sanitizedRows);
    }

    return {
      success: true,
      data: treeRoots,
      rawRows: sanitizedRows,
    };
  } catch (err: any) {
    return {
      success: false,
      data: [],
      error: err?.message || "Unexpected exception during cluster lineage retrieval.",
    };
  }
}

// ---------------------------------------------------------------------------
// ISR Cached Lineage Fetcher (60s Revalidation)
// ---------------------------------------------------------------------------

const getCachedClusterLineageInternal = unstable_cache(
  async (cacheKey: string, rootId?: string, authToken?: string | null) => {
    return fetchLineageFromDb(rootId, authToken);
  },
  ["valerie-cluster-lineage"],
  {
    revalidate: 60,
    tags: ["cluster-lineage"],
  }
);

// ---------------------------------------------------------------------------
// Public Server Action: getClusterLineage
// ---------------------------------------------------------------------------

/**
 * Server Action: Fetches hierarchical topic cluster lineage trees.
 * Cached via ISR with 60s revalidation and tagged with "cluster-lineage".
 *
 * @param rootId Optional root cluster UUID to restrict subtree traversal.
 * @returns Result object containing hierarchical tree nodes and raw rows.
 */
export async function getClusterLineage(rootId?: string): Promise<ClusterLineageResult> {
  let authToken: string | null = null;

  try {
    const cookieStore = await cookies();
    const ssoToken = extractSSOToken(cookieStore);
    if (ssoToken) {
      authToken = ssoToken;
    } else {
      const allCookies = cookieStore.getAll();
      const authCookie = allCookies.find(
        (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
      );
      if (authCookie) {
        try {
          const parsed = JSON.parse(authCookie.value);
          authToken = parsed?.access_token || parsed?.[0] || authCookie.value;
        } catch {
          authToken = authCookie.value;
        }
      }
    }
  } catch {
    // In static rendering or test runner contexts, cookies() may not be available.
  }

  const cacheKey = `${rootId || "global"}:${authToken ? "auth" : "anon"}`;
  return getCachedClusterLineageInternal(cacheKey, rootId, authToken);
}
