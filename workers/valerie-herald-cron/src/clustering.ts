/**
 * Topic Clustering, Controversy Variance & Locale Detection Engine
 * Work Item: TASK-VAL-HERALD-CRON-WORKER
 *
 * Clusters multi-source news coverage into semantic story clusters,
 * detects geographic scope tiers (LOCAL / STATE / NATIONAL / GLOBAL),
 * and calculates cross-source controversy variance (dispersion).
 */

import type { NewsArticle, NewsCluster } from "./types";

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "did", "do", "does", "doing", "don", "down", "during", "each", "few", "for",
  "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself",
  "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
  "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once",
  "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "s", "same", "she",
  "should", "so", "some", "such", "t", "than", "that", "the", "their", "theirs", "them",
  "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too",
  "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "would", "you", "your", "yours", "yourself",
  "yourselves", "says", "new", "report", "first", "update", "latest", "breaking"
]);

const US_STATES: Record<string, string> = {
  california: "US-CA", texas: "US-TX", florida: "US-FL", newyork: "US-NY",
  illinois: "US-IL", pennsylvania: "US-PA", ohio: "US-OH", georgia: "US-GA",
  michigan: "US-MI", virginia: "US-VA", washington: "US-WA", arizona: "US-AZ",
  colorado: "US-CO", massachusetts: "US-MA", tennessee: "US-TN", missouri: "US-MO",
  indiana: "US-IN", maryland: "US-MD", wisconsin: "US-WI", minnesota: "US-MN",
};

/**
 * Tokenizes text into normalized keywords.
 */
export function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Computes Jaccard keyword similarity between two text strings.
 */
export function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Calculates cross-source sentiment variance (dispersion) across multi-source coverage perspectives.
 * Must match the herald agent formulation: min(1.0, sqrt(variance) * 1.5).
 */
export function calculateControversyDispersion(articles: NewsArticle[]): number {
  if (articles.length < 2) return 0.0;
  const scores = articles.map((a) => (typeof a.sentiment_score === "number" ? a.sentiment_score : 0.0));
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / (scores.length - 1);
  return Math.min(1.0, Math.sqrt(variance) * 1.5);
}

/**
 * Detects geographic locales and scope tier from headline and body text.
 */
export function detectLocalesAndScope(text: string): {
  detected_locales: string[];
  scope_tier: "LOCAL" | "STATE" | "NATIONAL" | "GLOBAL";
} {
  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const detected = new Set<string>();

  // Check US States
  for (const [stateName, stateCode] of Object.entries(US_STATES)) {
    if (clean.includes(stateName)) {
      detected.add(stateCode);
    }
  }

  // Check Municipal / Local keywords
  const isLocal = /city council|mayor|county board|school district|sheriff|subway|metro|zoning/i.test(text);

  if (isLocal) {
    return {
      detected_locales: detected.size > 0 ? Array.from(detected) : ["US"],
      scope_tier: "LOCAL",
    };
  }

  if (detected.size > 0) {
    return {
      detected_locales: Array.from(detected),
      scope_tier: "STATE",
    };
  }

  // International keywords
  if (/global|united nations|un security council|nato|treaty|climate summit|g7|g20/i.test(text)) {
    return {
      detected_locales: ["GLOBAL"],
      scope_tier: "GLOBAL",
    };
  }

  // Default national civic tier
  return {
    detected_locales: ["US"],
    scope_tier: "NATIONAL",
  };
}

/**
 * Clusters a stream of news articles into multi-source story clusters.
 */
export function clusterNewsArticles(
  articles: NewsArticle[],
  similarityThreshold = 0.1,
  minClusterSize = 2,
  maxArticlesPerCluster = 8
): NewsCluster[] {
  const clusters: {
    articles: NewsArticle[];
    keywords: Set<string>;
    leadHeadline: string;
  }[] = [];

  for (const article of articles) {
    const artKeywords = extractKeywords(`${article.title} ${article.snippet || ""}`);
    if (artKeywords.size === 0) continue;

    let bestClusterIdx = -1;
    let highestSim = 0;

    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].articles.length >= maxArticlesPerCluster) continue;
      const sim = computeJaccardSimilarity(artKeywords, clusters[i].keywords);
      if (sim > highestSim && sim >= similarityThreshold) {
        highestSim = sim;
        bestClusterIdx = i;
      }
    }

    if (bestClusterIdx >= 0) {
      clusters[bestClusterIdx].articles.push(article);
      // Union keywords
      for (const kw of artKeywords) {
        clusters[bestClusterIdx].keywords.add(kw);
      }
    } else {
      clusters.push({
        articles: [article],
        keywords: new Set(artKeywords),
        leadHeadline: article.title,
      });
    }
  }

  const result: NewsCluster[] = [];

  for (const cl of clusters) {
    if (cl.articles.length < minClusterSize) continue;

    // Filter unique sources
    const uniqueSourceArticles: NewsArticle[] = [];
    const seenDomains = new Set<string>();

    for (const art of cl.articles) {
      const src = art.domain || art.source;
      if (!seenDomains.has(src)) {
        seenDomains.add(src);
        uniqueSourceArticles.push(art);
      }
    }

    if (uniqueSourceArticles.length < minClusterSize) continue;

    // Pick clearest headline (longest or most descriptive title)
    const lead = uniqueSourceArticles.reduce((longest, curr) =>
      curr.title.length > longest.title.length ? curr : longest
    );

    const fullText = uniqueSourceArticles.map((a) => `${a.title}. ${a.snippet || ""}`).join(" ");
    const { detected_locales, scope_tier } = detectLocalesAndScope(fullText);
    const controversy = calculateControversyDispersion(uniqueSourceArticles);

    result.push({
      headline: lead.title,
      summary: fullText.slice(0, 800),
      sources: uniqueSourceArticles,
      controversy_dispersion: controversy,
      detected_locales,
      scope_tier,
    });
  }

  // Sort clusters by controversy dispersion descending
  return result.sort((a, b) => b.controversy_dispersion - a.controversy_dispersion);
}
