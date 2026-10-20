/**
 * Valerie Herald Cron Worker Test Suite (Vitest)
 * Work Item: TASK-VAL-HERALD-CRON-WORKER
 *
 * Verifies news aggregation, controversy dispersion filtering,
 * locale resolution, and worker fetch routing.
 */

import { describe, it, expect } from "vitest";
import { normalizeGdeltTone, parseGdeltDate } from "../../workers/valerie-herald-cron/src/gdelt";
import { parseRssXml } from "../../workers/valerie-herald-cron/src/rss";
import {
  calculateControversyDispersion,
  detectLocalesAndScope,
  clusterNewsArticles,
} from "../../workers/valerie-herald-cron/src/clustering";
import { sanitizeLogContent, buildHeraldHeaders } from "../../workers/valerie-herald-cron/src/heraldClient";
import worker from "../../workers/valerie-herald-cron/src/index";

describe("Valerie Herald Cron Worker", () => {
  describe("GDELT Ingestion", () => {
    it("normalizes tone to [-1.0, 1.0]", () => {
      expect(normalizeGdeltTone(0)).toBe(0);
      expect(normalizeGdeltTone(20)).toBe(1.0);
      expect(normalizeGdeltTone(-20)).toBe(-1.0);
      expect(normalizeGdeltTone(10)).toBe(0.5);
      expect(normalizeGdeltTone(undefined)).toBe(0);
    });

    it("parses GDELT compact timestamps into ISO-8601 strings", () => {
      expect(parseGdeltDate("20261020T164500Z")).toBe("2026-10-20T16:45:00Z");
    });
  });

  describe("RSS Parser", () => {
    it("parses RSS 2.0 XML items cleanly", () => {
      const xml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>Supreme Court Review</title>
              <link>https://reuters.com/scotus-case</link>
              <description>Oral arguments underway.</description>
            </item>
          </channel>
        </rss>
      `;
      const articles = parseRssXml(xml, "reuters.com");
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("Supreme Court Review");
      expect(articles[0].source).toBe("reuters.com");
    });
  });

  describe("Clustering & Controversy Variance", () => {
    it("calculates dispersion correctly according to variance formula", () => {
      const consensus = [
        { title: "A", source: "a.com", url: "https://a.com", sentiment_score: 0.5 },
        { title: "B", source: "b.com", url: "https://b.com", sentiment_score: 0.5 },
      ];
      expect(calculateControversyDispersion(consensus)).toBe(0);

      const polarizing = [
        { title: "A", source: "a.com", url: "https://a.com", sentiment_score: -0.9 },
        { title: "B", source: "b.com", url: "https://b.com", sentiment_score: 0.9 },
      ];
      expect(calculateControversyDispersion(polarizing)).toBeGreaterThanOrEqual(0.9);
    });

    it("resolves state, local, and national scope tiers from content", () => {
      expect(detectLocalesAndScope("California passes state budget").scope_tier).toBe("STATE");
      expect(detectLocalesAndScope("Dallas city council approves zoning ordinance").scope_tier).toBe("LOCAL");
      expect(detectLocalesAndScope("Federal reserve announces monetary policy").scope_tier).toBe("NATIONAL");
    });

    it("clusters overlapping articles and filters low-controversy clusters", () => {
      const articles = [
        {
          title: "Controversial zoning reform approved by council",
          source: "times.com",
          url: "https://times.com/zoning",
          sentiment_score: -0.8,
        },
        {
          title: "Zoning reform overhaul sparks heated neighborhood debate",
          source: "herald.com",
          url: "https://herald.com/zoning",
          sentiment_score: 0.8,
        },
      ];

      const clusters = clusterNewsArticles(articles, 0.2, 2);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].controversy_dispersion).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe("Security & Redaction", () => {
    it("redacts sensitive auth tokens and keys from error messages", () => {
      const msg = "Service failed: Authorization: Bearer secret_token_1234567890 with key=super_secret";
      const sanitized = sanitizeLogContent(msg);
      expect(sanitized).not.toContain("secret_token_1234567890");
      expect(sanitized).not.toContain("super_secret");
      expect(sanitized).toContain("[REDACTED]");
    });

    it("constructs correct herald authentication headers", () => {
      const env = {
        CRON_SECRET: "cron_secret_abc",
        SUPABASE_SERVICE_ROLE_KEY: "service_role_xyz",
      };
      const headers = buildHeraldHeaders(env) as Record<string, string>;
      expect(headers["x-cron-secret"]).toBe("cron_secret_abc");
      expect(headers["Authorization"]).toBe("Bearer service_role_xyz");
    });
  });

  describe("Cloudflare Worker HTTP Handler", () => {
    it("returns public service info on GET /health", async () => {
      const res = await worker.fetch(new Request("https://worker.internal/health"), {}, {} as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.service).toBe("valerie-herald-cron");
      expect(data.schedule).toBe("0 */2 * * *");
    });

    it("enforces authentication on /trigger", async () => {
      const env = { TRIGGER_SECRET: "secure-trigger-token" };

      // Unauthenticated
      const unauth = await worker.fetch(new Request("https://worker.internal/trigger"), env, {} as any);
      expect(unauth.status).toBe(401);

      // Authenticated with dryRun
      const authReq = new Request("https://worker.internal/trigger?dryRun=true", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-trigger-secret": "secure-trigger-token",
        },
        body: JSON.stringify({
          dryRun: true,
          articles: [
            {
              title: "Council approves local infrastructure plan",
              source: "localnews.com",
              url: "https://localnews.com/plan",
              sentiment_score: 0.1,
            },
          ],
        }),
      });
      const authRes = await worker.fetch(authReq, env, {} as any);
      expect(authRes.status).toBe(200);
      const body = await authRes.json();
      expect(body.dry_run).toBe(true);
    });
  });
});
