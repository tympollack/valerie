/**
 * Project Valerie: Ad Compliance Audit & Normalization Types and Services
 * Work Item: [TASK-VAL-AD-SCHEMA] / [STORY-VAL-AD-DECOMPOSER]
 */

export const AD_VIOLATION_CATEGORIES = [
  "EXCESSIVE_LUMINANCE",
  "TRAFFIC_SIGHTLINE_HAZARD",
  "SCHOOL_BUFFER_BREACH",
  "UNASSISTED_EXISTENTIAL_DISTRESS",
  "CORRIDOR_EQUITY_DISPARITY",
] as const;

export type AdViolationCategory = (typeof AD_VIOLATION_CATEGORIES)[number];

export const AD_AUDIT_STATUSES = [
  "REPORTED",
  "NORMALIZED",
  "DELIBERATING",
  "RESOLVED",
  "DISMISSED",
] as const;

export type AdAuditStatus = (typeof AD_AUDIT_STATUSES)[number];

export interface AdComplianceAudit {
  id: string;
  patchwork_port_id: string;
  parcel_id: string | null;
  h3_index_res8: string;
  flagged_categories: AdViolationCategory[];
  ocr_raw_text: string | null;
  decomposed_poll_id: string | null;
  status: AdAuditStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AdAuditEscalationResult {
  shouldEscalate: boolean;
  distinctPortCount: number;
  newStatus: AdAuditStatus;
}

/**
 * Evaluates whether an H3 cell meets the 5-port deliberation escalation threshold.
 * Matching valerie.trigger_ad_audit_deliberation() DB logic.
 */
export function evaluateAdAuditEscalation(
  existingAuditsInCell: Array<{ patchwork_port_id: string; status: AdAuditStatus }>,
  incomingPortId: string
): AdAuditEscalationResult {
  const activePorts = new Set<string>();

  for (const audit of existingAuditsInCell) {
    if (audit.status !== "DISMISSED") {
      activePorts.add(audit.patchwork_port_id);
    }
  }

  // Add the incoming port
  activePorts.add(incomingPortId);

  const distinctPortCount = activePorts.size;
  const shouldEscalate = distinctPortCount >= 5;

  return {
    shouldEscalate,
    distinctPortCount,
    newStatus: shouldEscalate ? "NORMALIZED" : "REPORTED",
  };
}
