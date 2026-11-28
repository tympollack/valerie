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
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { extractSSOToken } from "@/lib/auth/ssoHandshake";
import {
  sanitizeClusterNode,
  buildNestedClusterTree,
} from "@/lib/valerie/clusterTree";

// Type Definitions
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

// Supabase RPC Executor
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
// Ephemeral request context and reference-counted token registry decouple
// raw JWT credentials from cache keys without losing bearer on concurrent requests.
// ---------------------------------------------------------------------------

interface RequestAuthContext {
  userId: string;
  authToken: string | null;
}

const requestAuthStorage = new AsyncLocalStorage<RequestAuthContext>();
const userTokenRegistry = new Map<string, { token: string; refCount: number }>();

function retainUserAuthToken(userId: string, token: string): void {
  const entry = userTokenRegistry.get(userId);
  if (entry) {
    entry.refCount += 1;
    entry.token = token;
  } else {
    userTokenRegistry.set(userId, { token, refCount: 1 });
  }
}

function releaseUserAuthToken(userId: string): void {
  const entry = userTokenRegistry.get(userId);
  if (entry) {
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      userTokenRegistry.delete(userId);
    }
  }
}

function getActiveAuthToken(userId: string): string | null {
  const context = requestAuthStorage.getStore();
  if (context && context.userId === userId && context.authToken) {
    return context.authToken;
  }
  const registryEntry = userTokenRegistry.get(userId);
  if (registryEntry?.token) {
    return registryEntry.token;
  }
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

const getCachedClusterLineageInternal = unstable_cache(
  async (targetRootId: string, targetUserId: string) => {
    const token = getActiveAuthToken(targetUserId);
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
    retainUserAuthToken(userId, authToken);
  }

  try {
    const result = await requestAuthStorage.run(
      { userId, authToken },
      () => getCachedClusterLineageInternal(stableRootId, userId)
    );
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
    if (authToken) {
      releaseUserAuthToken(userId);
    }
  }
}
