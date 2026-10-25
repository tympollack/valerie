/**
 * Valerie Herald Dynamic Settings Test Suite
 * Work Item: TASK-VAL-SETTINGS-WIRE-EDGE-WORKERS
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSystemSettings,
  updateSystemSetting,
  getDynamicSettingNumeric,
} from "@/app/actions/valerieSettingsActions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/app/actions/auth";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("valerie-herald-agent dynamic settings contracts", () => {
  let mockSupabase: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      rpc: vi.fn(),
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);
  });

  it("provides fallback values for herald_cynic_bias_threshold and herald_semantic_dedup_threshold", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null as any);
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: "Not found" } });

    const queryBuilder = Promise.resolve({ data: null, error: { message: "Table not ready" } });
    mockSupabase.select.mockReturnValue(queryBuilder);
    (queryBuilder as any).order = vi.fn().mockReturnValue(queryBuilder);
    (queryBuilder as any).eq = vi.fn().mockReturnValue(queryBuilder);

    const res = await getSystemSettings();
    expect(res.success).toBe(true);

    const cynicSetting = res.data.find((s) => s.key === "herald_cynic_bias_threshold");
    expect(cynicSetting).toBeDefined();
    expect(cynicSetting?.value).toBe(0.15);

    const dedupSetting = res.data.find((s) => s.key === "herald_semantic_dedup_threshold");
    expect(dedupSetting).toBeDefined();
    expect(dedupSetting?.value).toBe(0.90);
  });

  it("validates boundary values for herald cynic bias and semantic dedup thresholds", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue({
      authenticated: true,
      userId: "admin-1",
      email: "admin@sunshade.icu",
      displayName: "Admin",
      isHumanVerified: true,
      verificationTier: "TIER_3_SOVEREIGN",
      trustState: "active",
    });

    // Sub-threshold cynic bias (< 0.05)
    const resLowCynic = await updateSystemSetting("herald_cynic_bias_threshold", 0.01);
    expect(resLowCynic.success).toBe(false);
    expect(resLowCynic.error).toMatch(/between 0.05 and 0.50/i);

    // Over-threshold semantic dedup (> 0.99)
    const resHighDedup = await updateSystemSetting("herald_semantic_dedup_threshold", 1.05);
    expect(resHighDedup.success).toBe(false);
    expect(resHighDedup.error).toMatch(/between 0.50 and 0.99/i);
  });

  it("resolves dynamic numeric herald settings via getDynamicSettingNumeric", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: 0.18,
      error: null,
    });

    const cynicVal = await getDynamicSettingNumeric("herald_cynic_bias_threshold", 0.15);
    expect(cynicVal).toBe(0.18);
  });
});
