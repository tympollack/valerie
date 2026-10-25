/**
 * Project Valerie: Dynamic Settings Server Actions Test Suite
 * File: test/actions/valerieSettingsActions.test.ts
 * Work Item: [TASK-VAL-DYNAMIC-SETTINGS]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSystemSettings,
  updateSystemSetting,
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

describe("app/actions/valerieSettingsActions", () => {
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getSystemSettings", () => {
    it("returns system settings from RPC when available", async () => {
      vi.mocked(getCurrentUserContext).mockResolvedValue({
        authenticated: true,
        userId: "user-admin",
        email: "admin@sunshade.icu",
        displayName: "Admin",
        isHumanVerified: true,
        verificationTier: "TIER_3_SOVEREIGN",
        trustState: "active",
      });

      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          {
            key: "voting_lock_hours",
            value: 24,
            category: "VOTING",
            description: "Lock window",
            is_secret: false,
            updated_at: "2026-10-24T00:00:00Z",
          },
        ],
        error: null,
      });

      const res = await getSystemSettings();
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].key).toBe("voting_lock_hours");
      expect(res.data[0].value).toBe(24);
    });

    it("falls back to direct table query when RPC is not present", async () => {
      vi.mocked(getCurrentUserContext).mockResolvedValue({
        authenticated: true,
        userId: "user-1",
        email: "user@sunshade.icu",
        displayName: "Voter",
        isHumanVerified: true,
        verificationTier: "TIER_1_REGISTERED",
        trustState: "active",
      });

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: "function valerie.get_all_system_settings does not exist" },
      });

      const tableData = [
        {
          key: "advocate_hard_cap_hours",
          value: 20,
          category: "LABOR",
          description: "Hard cap",
          is_secret: false,
          updated_at: "2026-10-24T00:00:00Z",
        },
      ];

      // Direct query returns tableData on await
      const queryBuilder = Promise.resolve({ data: tableData, error: null });
      mockSupabase.select.mockReturnValue(queryBuilder);
      (queryBuilder as any).order = vi.fn().mockReturnValue(queryBuilder);
      (queryBuilder as any).eq = vi.fn().mockReturnValue(queryBuilder);

      const res = await getSystemSettings();
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].key).toBe("advocate_hard_cap_hours");
    });

    it("returns default fallback constants when both RPC and table fail", async () => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(null as any);

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: "RPC failed" },
      });

      const queryBuilder = Promise.resolve({ data: null, error: { message: "Table failed" } });
      mockSupabase.select.mockReturnValue(queryBuilder);
      (queryBuilder as any).order = vi.fn().mockReturnValue(queryBuilder);
      (queryBuilder as any).eq = vi.fn().mockReturnValue(queryBuilder);

      const res = await getSystemSettings();
      expect(res.success).toBe(true);
      expect(res.data.length).toBeGreaterThanOrEqual(7);
      expect(res.data.some((s) => s.key === "decree_supermajority_threshold")).toBe(true);
    });
  });

  describe("updateSystemSetting", () => {
    it("rejects unauthorized callers when verification tier is below sovereign", async () => {
      vi.stubEnv("NODE_ENV", "production");

      vi.mocked(getCurrentUserContext).mockResolvedValue({
        authenticated: true,
        userId: "user-regular",
        email: "regular@sunshade.icu",
        displayName: "Regular Voter",
        isHumanVerified: true,
        verificationTier: "TIER_1_REGISTERED",
        trustState: "active",
      });

      const res = await updateSystemSetting("voting_lock_hours", 48);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Unauthorized/i);
    });

    it("successfully updates setting via RPC when privileged", async () => {
      vi.mocked(getCurrentUserContext).mockResolvedValue({
        authenticated: true,
        userId: "user-admin",
        email: "admin@sunshade.icu",
        displayName: "Sovereign Admin",
        isHumanVerified: true,
        verificationTier: "TIER_3_SOVEREIGN",
        trustState: "active",
      });

      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          key: "advocate_hard_cap_hours",
          value: 22,
          category: "LABOR",
          updated_at: "2026-10-24T12:00:00Z",
        },
        error: null,
      });

      const res = await updateSystemSetting("advocate_hard_cap_hours", 22);
      expect(res.success).toBe(true);
      expect(res.data?.key).toBe("advocate_hard_cap_hours");
      expect(res.data?.value).toBe(22);
    });

    it("rejects calls with missing key or value", async () => {
      const res = await updateSystemSetting("", undefined);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Missing required/i);
    });
  });
});
