import { describe, it, expect } from "vitest";
import {
  AD_VIOLATION_CATEGORIES,
  AD_AUDIT_STATUSES,
  evaluateAdAuditEscalation,
  type AdViolationCategory,
  type AdAuditStatus,
  type AdComplianceAudit,
} from "@/lib/valerie/adCompliance";
import fs from "node:fs";
import path from "node:path";

describe("Ad Compliance Audit Schema & Escalation Contracts (TASK-VAL-AD-SCHEMA)", () => {
  it("defines the 5 canonical violation categories", () => {
    expect(AD_VIOLATION_CATEGORIES).toEqual([
      "EXCESSIVE_LUMINANCE",
      "TRAFFIC_SIGHTLINE_HAZARD",
      "SCHOOL_BUFFER_BREACH",
      "UNASSISTED_EXISTENTIAL_DISTRESS",
      "CORRIDOR_EQUITY_DISPARITY",
    ]);
  });

  it("defines the 5 valid audit workflow statuses", () => {
    expect(AD_AUDIT_STATUSES).toEqual([
      "REPORTED",
      "NORMALIZED",
      "DELIBERATING",
      "RESOLVED",
      "DISMISSED",
    ]);
  });

  it("does not escalate when fewer than 5 distinct ports exist in the H3 cell", () => {
    const existing = [
      { patchwork_port_id: "port-1", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-2", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-3", status: "REPORTED" as AdAuditStatus },
    ];

    const result = evaluateAdAuditEscalation(existing, "port-4");
    expect(result.shouldEscalate).toBe(false);
    expect(result.distinctPortCount).toBe(4);
    expect(result.newStatus).toBe("REPORTED");
  });

  it("auto-escalates to NORMALIZED when 5 distinct neighborhood ports occur in the same H3 cell", () => {
    const existing = [
      { patchwork_port_id: "port-1", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-2", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-3", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-4", status: "REPORTED" as AdAuditStatus },
    ];

    const result = evaluateAdAuditEscalation(existing, "port-5");
    expect(result.shouldEscalate).toBe(true);
    expect(result.distinctPortCount).toBe(5);
    expect(result.newStatus).toBe("NORMALIZED");
  });

  it("ignores duplicate reports from the same port when calculating escalation", () => {
    const existing = [
      { patchwork_port_id: "port-1", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-1", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-2", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-3", status: "REPORTED" as AdAuditStatus },
    ];

    const result = evaluateAdAuditEscalation(existing, "port-2");
    expect(result.shouldEscalate).toBe(false);
    expect(result.distinctPortCount).toBe(3);
    expect(result.newStatus).toBe("REPORTED");
  });

  it("ignores DISMISSED audit records in escalation tally", () => {
    const existing = [
      { patchwork_port_id: "port-1", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-2", status: "REPORTED" as AdAuditStatus },
      { patchwork_port_id: "port-3", status: "DISMISSED" as AdAuditStatus },
      { patchwork_port_id: "port-4", status: "REPORTED" as AdAuditStatus },
    ];

    const result = evaluateAdAuditEscalation(existing, "port-5");
    // port-3 is dismissed, so active ports are 1, 2, 4 + incoming 5 = 4
    expect(result.shouldEscalate).toBe(false);
    expect(result.distinctPortCount).toBe(4);
    expect(result.newStatus).toBe("REPORTED");
  });

  it("verifies the SQL migration schema constructs if migration file is present locally", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "../sunshade-db-platform/supabase/migrations/20261108170500_valerie_ad_audits.sql"
    );
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, "utf-8");
      expect(sql).toContain("CREATE TYPE valerie.ad_violation_category");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS valerie.ad_compliance_audits");
      expect(sql).toContain("patchwork_port_id");
      expect(sql).toContain("parcel_id");
      expect(sql).toContain("h3_index_res8");
      expect(sql).toContain("flagged_categories");
      expect(sql).toContain("ocr_raw_text");
      expect(sql).toContain("decomposed_poll_id");
      expect(sql).toContain("valerie.trigger_ad_audit_deliberation()");
      expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
      expect(sql).toContain("ad_compliance_audits_select");
      expect(sql).toContain("GRANT ALL ON valerie.ad_compliance_audits TO service_role");
    } else {
      // Sibling repo may be on a different branch or in standalone CI environment
      expect(true).toBe(true);
    }
  });
});
