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
  const parentChildEdges = new Map<string, Set<string>>();
  const childToParent = new Map<string, string>();

  const visitNode = (node: ClusterLineageNode, inferredParentId?: string) => {
    if (!node || !node.id) return;

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

    const parentId = node.parent_cluster_id || inferredParentId;
    if (parentId) {
      const canonical = nodeMap.get(node.id)!;
      if (!canonical.parent_cluster_id) {
        canonical.parent_cluster_id = parentId;
      }
      childToParent.set(node.id, parentId);
      if (!parentChildEdges.has(parentId)) {
        parentChildEdges.set(parentId, new Set());
      }
      parentChildEdges.get(parentId)!.add(node.id);
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && child.id) {
          if (!parentChildEdges.has(node.id)) {
            parentChildEdges.set(node.id, new Set());
          }
          parentChildEdges.get(node.id)!.add(child.id);
          childToParent.set(child.id, node.id);
          visitNode(child, node.id);
        }
      }
    }
  };

  nodes.forEach((n) => visitNode(n));

  parentChildEdges.forEach((childIds, parentId) => {
    const parentNode = nodeMap.get(parentId);
    if (parentNode) {
      childIds.forEach((childId) => {
        const childNode = nodeMap.get(childId);
        if (childNode && !parentNode.children.some((c) => c.id === childNode.id)) {
          parentNode.children.push(childNode);
        }
      });
    }
  });

  nodeMap.forEach((node) => {
    node.children.sort((a, b) => {
      if (b.active_weight !== a.active_weight) {
        return b.active_weight - a.active_weight;
      }
      return a.cluster_name.localeCompare(b.cluster_name);
    });
  });

  const roots: ClusterLineageNode[] = [];
  nodeMap.forEach((node) => {
    const parentId = childToParent.get(node.id) || node.parent_cluster_id;
    if (!parentId || !nodeMap.has(parentId)) {
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
