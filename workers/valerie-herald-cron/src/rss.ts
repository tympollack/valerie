/**
 * Multi-Spectrum RSS Feed Ingestion Module
 * Work Item: TASK-VAL-HERALD-CRON-WORKER
 *
 * Ingests live news items across high-credibility RSS feeds (AP, NPR, BBC, Reuters)
 * to provide resilient coverage and diverse editorial perspectives.
 */

import type { NewsArticle } from "./types";

export const DEFAULT_RSS_FEEDS = [
  "https://feeds.npr.org/1001/rss.xml",
  "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
];

const POSITIVE_MARKERS = [
  "approve", "success", "advance", "support", "benefit", "boost", "praise", "agreement",
  "win", "protect", "relief", "gain", "strengthen", "progress", "pass", "triumph", "clean", "reform"
];

const NEGATIVE_MARKERS = [
  "crisis", "fail", "protest", "strike", "criticize", "block", "oppose", "threat", "danger",
  "harm", "cut", "loss", "decline", "condemn", "scandal", "lawsuit", "warn", "violate", "dispute"
];

/**
 * Estimates civic/policy sentiment score from title and description on [-1.0, 1.0] scale.
 */
export function estimateTextSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const pos of POSITIVE_MARKERS) {
    if (lower.includes(pos)) score += 0.3;
  }
  for (const neg of NEGATIVE_MARKERS) {
    if (lower.includes(neg)) score -= 0.3;
  }
  return Math.max(-1.0, Math.min(1.0, parseFloat(score.toFixed(2))));
}

/**
 * Extracts tag content from an XML snippet without requiring external DOM libraries.
 */
function extractTagContent(xml: string, tag: string): string {
  // Support standard tags and CDATA: <tag><![CDATA[...]]></tag> or <tag>...</tag>
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  const standardRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(standardRegex);
  if (match) return match[1].replace(/<[^>]*>/g, "").trim();

  return "";
}

/**
 * Parses RSS 2.0 or Atom XML content into structured NewsArticle objects.
 */
export function parseRssXml(xml: string, defaultSource: string): NewsArticle[] {
  const articles: NewsArticle[] = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi);

  if (!itemMatches) return articles;

  for (const itemXml of itemMatches) {
    const title = extractTagContent(itemXml, "title");
    let url = extractTagContent(itemXml, "link");
    if (!url) {
      // Check for <link href="..." /> format (Atom)
      const linkHrefMatch = itemXml.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (linkHrefMatch) url = linkHrefMatch[1];
    }
    const description = extractTagContent(itemXml, "description") || extractTagContent(itemXml, "summary");
    const pubDate = extractTagContent(itemXml, "pubDate") || extractTagContent(itemXml, "published");

    if (title && url) {
      const fullText = `${title}. ${description}`;
      articles.push({
        title,
        source: defaultSource,
        url,
        snippet: description.slice(0, 300),
        sentiment_score: estimateTextSentiment(fullText),
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      });
    }
  }

  return articles;
}

/**
 * Fetches and parses an RSS feed with a bounded timeout.
 */
export async function fetchRssFeed(url: string, timeoutMs = 6000): Promise<NewsArticle[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    const res = await fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "Valerie-Herald-Cron-Worker/1.0",
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const text = await res.text();
    return parseRssXml(text, domain);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[RSS] Failed fetching ${url}: ${msg}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
