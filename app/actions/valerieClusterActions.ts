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
 * Resolves ties deterministically by cluster name ascending when active weights are equal.
 */
export function sanitizeClusterNode(raw: any): ClusterLineageNode {
  const childrenRaw = Array.isArray(raw?.children) ? raw.children : [];
  const sanitizedChildren = childrenRaw.map(sanitizeClusterNode);

  sanitizedChildren.sort((a: ClusterLineageNode, b: ClusterLineageNode) => {
    if (b.active_weight !== a.active_weight) {
      return b.active_weight - a.active_weight;
    }
    return a.cluster_name.localeCompare(b.cluster_name);
  });

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
 * Reconstructs a complete recursive tree from flat or partially nested records,
 * canonicalizing every node by ID so descendants are never lost and no duplicate children exist.
 */
export function buildNestedClusterTree(nodes: ClusterLineageNode[]): ClusterLineageNode[] {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  const nodeMap = new Map<string, ClusterLineageNode>();

  // 1. Register canonical instances for all nodes (both flat top-level rows and embedded children)
  const registerCanonicalNode = (node: ClusterLineageNode) => {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, {
        ...node,
        children: [],
      });
    } else {
      const existing = nodeMap.get(node.id)!;
      if (!existing.parent_cluster_id && node.parent_cluster_id) {
        existing.parent_cluster_id = node.parent_cluster_id;
      }
    }

    if (Array.isArray(node.children)) {
      node.children.forEach(registerCanonicalNode);
    }
  };

  nodes.forEach(registerCanonicalNode);

  // 2. Link parent-child relationships using canonical object references exclusively
  const linkChildren = (node: ClusterLineageNode) => {
    const canonicalCurrent = nodeMap.get(node.id)!;

    if (canonicalCurrent.parent_cluster_id && nodeMap.has(canonicalCurrent.parent_cluster_id)) {
      const canonicalParent = nodeMap.get(canonicalCurrent.parent_cluster_id)!;
      if (!canonicalParent.children.some((c) => c.id === canonicalCurrent.id)) {
        canonicalParent.children.push(canonicalCurrent);
      }
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((child) => {
        const canonicalChild = nodeMap.get(child.id);
        if (canonicalChild && !canonicalCurrent.children.some((c) => c.id === canonicalChild.id)) {
          canonicalCurrent.children.push(canonicalChild);
        }
      });
    }
  };

  nodes.forEach(linkChildren);

  // 3. Sort children deterministically across all canonical nodes
  nodeMap.forEach((node) => {
    node.children.sort((a, b) => {
      if (b.active_weight !== a.active_weight) {
        return b.active_weight - a.active_weight;
      }
      return a.cluster_name.localeCompare(b.cluster_name);
    });
  });

  // 4. Collect top-level roots
  const roots: ClusterLineageNode[] = [];
  nodeMap.forEach((node) => {
    if (!node.parent_cluster_id || !nodeMap.has(node.parent_cluster_id)) {
      roots.push(node);
    }
  });

  roots.sort((a, b) => {
    if (b.active_weight !== a.active_weight) {
      return b.active_weight - a.active_weight;
    }
    return a.cluster_name.localeCompare(b.cluster_name);
  });

  return roots;
}

// ---------------------------------------------------------------------------
// Supabase RPC Executor
// ---------------------------------------------------------------------------

async function fetchLineageFromDb(
  rootId?: string,
  authToken?: string | null
): Promise<{ data: ClusterLineageNode[]; rawRows: ClusterLineageNode[] }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment configuration is missing.");
  }

  const client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    },
  });

  const rpcName = "get_cluster_lineage";
  const rpcParams = rootId ? { p_root_cluster_id: rootId } : {};

  const { data, error } = typeof (client as any).schema === "function"
    ? await (client as any).schema("valerie").rpc(rpcName, rpcParams)
    : await client.rpc(rpcName, rpcParams);

  if (error) {
    throw new Error(error.message || "Failed to fetch cluster lineage from database.");
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return { data: [], rawRows: [] };
  }

  const sanitizedRows = data.map(sanitizeClusterNode);

  // Assemble the complete tree from all flat/hierarchical rows before selecting target roots
  const fullTree = buildNestedClusterTree(sanitizedRows);

  let treeRoots: ClusterLineageNode[];
  if (rootId) {
    const findSubtree = (nodes: ClusterLineageNode[], target: string): ClusterLineageNode | null => {
      for (const n of nodes) {
        if (n.id === target) return n;
        const found = findSubtree(n.children, target);
        if (found) return found;
      }
      return null;
    };

    const matchedRoot = findSubtree(fullTree, rootId);
    treeRoots = matchedRoot ? [matchedRoot] : fullTree;
  } else {
    treeRoots = fullTree;
  }

  return {
    data: treeRoots,
    rawRows: sanitizedRows,
  };
}

// ---------------------------------------------------------------------------
// ISR Cached Lineage Fetcher (60s Revalidation)
// Throws on database failure so transient errors are never cached.
// Ephemeral token store decouples raw JWT from cache arguments so token rotation
// never invalidates valid cached lineage data.
// ---------------------------------------------------------------------------

const activeUserAuthTokens = new Map<string, string>();

const getCachedClusterLineageInternal = unstable_cache(
  async (targetRootId: string, targetUserId: string) => {
    const token = activeUserAuthTokens.get(targetUserId) || null;
    return fetchLineageFromDb(targetRootId === "global" ? undefined : targetRootId, token);
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
 * Performs caller session verification before reading cache to prevent expired bearer access.
 * Cached via ISR with 60s revalidation and tagged with "cluster-lineage".
 *
 * @param rootId Optional root cluster UUID to restrict subtree traversal.
 * @returns Result object containing hierarchical tree nodes and raw rows.
 */
export async function getClusterLineage(rootId?: string): Promise<ClusterLineageResult> {
  let authToken: string | null = null;
  let userId: string | null = null;

  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    const hasNativeSession = allCookies.some(
      (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
    );

    // 1. Prefer native Supabase session cookies over external SSO token
    if (hasNativeSession) {
      const authCookie = allCookies.find(
        (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
      );
      if (authCookie) {
        try {
          const parsed = JSON.parse(authCookie.value);
          authToken = parsed?.access_token || parsed?.[0] || authCookie.value;
          if (parsed?.user?.id) userId = parsed.user.id;
        } catch {
          authToken = authCookie.value;
        }
      }
    } else {
      // 2. Only supply SSO bearer when no native session exists
      const ssoToken = extractSSOToken(cookieStore);
      if (ssoToken) {
        authToken = ssoToken;
      }
    }
  } catch {
    // In static rendering or test runner contexts, cookies() may not be available.
  }

  // 3. Authenticate caller on every request before serving cached lineage
  try {
    const serverClient = await createServerClient();
    const { data: authData, error: authError } = await serverClient.auth.getUser();

    if (authError || !authData?.user) {
      return {
        success: false,
        data: [],
        error: "AUTH_REQUIRED: Authentication required to view cluster lineage.",
      };
    }

    userId = authData.user.id;
  } catch (authException: any) {
    return {
      success: false,
      data: [],
      error: authException?.message || "AUTH_REQUIRED: Authentication required to view cluster lineage.",
    };
  }

  const stableRootId = rootId || "global";
  if (authToken) {
    activeUserAuthTokens.set(userId, authToken);
  }

  try {
    const result = await getCachedClusterLineageInternal(stableRootId, userId);
    return {
      success: true,
      data: result.data,
      rawRows: result.rawRows,
    };
  } catch (err: any) {
    return {
      success: false,
      data: [],
      error: err?.message || "Failed to fetch cluster lineage from database.",
    };
  } finally {
    activeUserAuthTokens.delete(userId);
  }
}
