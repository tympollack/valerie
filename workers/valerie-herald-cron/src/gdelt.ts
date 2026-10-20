/**
 * GDELT 2.0 Global Event & News Ingestion Engine
 * Work Item: TASK-VAL-HERALD-CRON-WORKER
 *
 * Connects to GDELT Project 2.0 API to harvest real-time breaking events,
 * policy initiatives, civic controversies, and legislative coverage.
 */

import type { NewsArticle } from "./types";

export interface GdeltDocArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
  tone?: number | string;
}

export interface GdeltDocResponse {
  articles?: GdeltDocArticle[];
}

const GDELT_API_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

/**
 * Normalizes GDELT raw tone score (-100 to +100) to standard [-1.0, 1.0] sentiment scale.
 */
export function normalizeGdeltTone(rawTone: number | string | undefined): number {
  if (rawTone === undefined || rawTone === null) return 0.0;
  const num = typeof rawTone === "number" ? rawTone : parseFloat(String(rawTone));
  if (Number.isNaN(num)) return 0.0;
  // GDELT typical range is -15 to +15 (capped at -100 to +100)
  const clamped = Math.max(-20, Math.min(20, num));
  return parseFloat((clamped / 20).toFixed(3));
}

/**
 * Parses GDELT date format (YYYYMMDDTHHMMSSZ) to standard ISO string.
 */
export function parseGdeltDate(dateStr?: string): string {
  if (!dateStr || dateStr.length < 15) return new Date().toISOString();
  try {
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = dateStr.slice(9, 11);
    const min = dateStr.slice(11, 13);
    const sec = dateStr.slice(13, 15);
    return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Fetches recent breaking political and civic events from GDELT 2.0.
 */
export async function fetchGdeltNews(
  query = "civic OR policy OR legislation OR congress OR court OR election",
  maxRecords = 30,
  timeoutMs = 8000
): Promise<NewsArticle[]> {
  const url = new URL(GDELT_API_BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("maxrecords", String(Math.min(maxRecords, 50)));
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "DateDesc");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "Valerie-Herald-Cron-Worker/1.0 (Civic Intelligence; https://valerie.sunshade.icu)",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[GDELT] Request returned HTTP ${res.status}`);
      return [];
    }

    const data = (await res.json()) as GdeltDocResponse;
    if (!data || !Array.isArray(data.articles)) {
      return [];
    }

    const articles: NewsArticle[] = [];
    for (const art of data.articles) {
      if (!art.title || !art.url) continue;

      const title = art.title.replace(/<[^>]*>/g, "").trim();
      const domain = art.domain || new URL(art.url).hostname.replace(/^www\./, "");

      articles.push({
        title,
        source: domain,
        url: art.url,
        domain,
        sentiment_score: normalizeGdeltTone(art.tone),
        published_at: parseGdeltDate(art.seendate),
      });
    }

    return articles;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GDELT] Ingestion failed: ${msg}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
