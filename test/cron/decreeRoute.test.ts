/**
 * Project Valerie: Scheduled Sovereign Decree Compilation Route Handler Tests
 * File: test/cron/decreeRoute.test.ts
 * Work Item: [TASK-VAL-DECREE-COMPILER-RUNNER] / [STORY-VAL-DECREE-INACTION]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/cron/decree/route";
import * as compilerModule from "@/lib/valerie/decreeCompilerRunner";

describe("Decree Cron API Route (/api/cron/decree)", () => {
  const originalEnv = { ...process.env };
  const CRON_SECRET = "test-decree-cron-secret-123";

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("Authentication & Authorization", () => {
    it("rejects request without authorization header with 401", async () => {
      const req = new NextRequest("https://votary.app/api/cron/decree", {
        method: "POST",
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });

    it("rejects request with invalid bearer secret with 401", async () => {
      const req = new NextRequest("https://votary.app/api/cron/decree", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-secret",
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });

    it("rejects request when CRON_SECRET is not configured on server", async () => {
      delete process.env.CRON_SECRET;
      const req = new NextRequest("https://votary.app/api/cron/decree", {
        method: "POST",
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  describe("Successful Execution & Delegation", () => {
    it("delegates to processDecreeCompiler and returns summary", async () => {
      vi.spyOn(compilerModule, "processDecreeCompiler").mockResolvedValue({
        status: "success",
        eligiblePolls: 2,
        evaluatedPolls: 2,
        compiledDecrees: 1,
        results: [
          {
            pollId: "poll-1",
            success: true,
            decreeId: "decree-1",
            consensusShare: 0.78,
          },
        ],
      });

      const req = new NextRequest("https://votary.app/api/cron/decree", {
        method: "POST",
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.compiledDecrees).toBe(1);
    });

    it("returns paused_by_admin status when cron is disabled by setting", async () => {
      vi.spyOn(compilerModule, "processDecreeCompiler").mockResolvedValue({
        status: "paused_by_admin",
        eligiblePolls: 0,
        evaluatedPolls: 0,
        compiledDecrees: 0,
        results: [],
        message: "Decree compilation cron halted: decree.cron_enabled is false.",
      });

      const req = new NextRequest("https://votary.app/api/cron/decree", {
        method: "POST",
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("paused_by_admin");
      expect(body.message).toContain("paused by administrator setting");
    });

    it("supports GET request by delegating to POST", async () => {
      vi.spyOn(compilerModule, "processDecreeCompiler").mockResolvedValue({
        status: "success",
        eligiblePolls: 0,
        evaluatedPolls: 0,
        compiledDecrees: 0,
        results: [],
      });

      const req = new NextRequest("https://votary.app/api/cron/decree", {
        method: "GET",
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });
});
