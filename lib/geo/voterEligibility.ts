/**
 * Project Valerie: Anonymized Voter Locale Eligibility & Ballot Filtering
 * File: lib/geo/voterEligibility.ts
 * Work Item: [TASK-VAL-SURGE-PACKET-RPC] / [BUG-VAL-LOCALE-TIERING]
 *
 * Evaluates whether a candidate poll is eligible for a voter given coarse geographic locale tiers.
 * Prevents presenting out-of-district or out-of-state ballots in fallback packet queries.
 */

export interface VoterLocaleContext {
  country_iso?: string | null;
  admin1_code?: string | null;
  admin2_code?: string | null;
  h3_res7?: string | null;
}

export interface PollLocaleTarget {
  h3_res7?: string | null;
  target_locale_code?: string | null;
  detected_locales?: string[] | null;
}

/**
 * Evaluates whether a candidate poll is eligible for a voter given coarse geographic locale tiers.
 * Prevents presenting out-of-district or out-of-state ballots in fallback packet queries (BUG_0003).
 */
export function isPollEligibleForVoterLocale(
  poll: PollLocaleTarget,
  locale?: VoterLocaleContext | null
): boolean {
  // If poll has an H3 cell, it must match the voter's H3 cell
  if (poll.h3_res7) {
    return Boolean(locale?.h3_res7 && poll.h3_res7 === locale.h3_res7);
  }

  // Poll has no H3 cell (higher-tier or global)
  const targetCode = poll.target_locale_code?.trim().toUpperCase();
  if (!targetCode || targetCode === "GLOBAL" || targetCode === "ALL") {
    return true;
  }

  // If voter has no locale info, cannot confirm match for region-targeted ballot
  if (!locale) {
    return false;
  }

  const voterCountry = locale.country_iso?.trim().toUpperCase() || null;
  const voterAdmin1 = locale.admin1_code?.trim().toUpperCase() || null;

  if (voterAdmin1 && (targetCode === voterAdmin1 || targetCode.endsWith(`-${voterAdmin1}`))) {
    return true;
  }

  if (voterCountry && targetCode === voterCountry) {
    return true;
  }

  if (Array.isArray(poll.detected_locales) && poll.detected_locales.length > 0) {
    const normLocales = poll.detected_locales.map((l) => String(l).trim().toUpperCase());
    if (voterAdmin1 && normLocales.some((l) => l === voterAdmin1 || l.endsWith(`-${voterAdmin1}`))) {
      return true;
    }
    if (voterCountry && normLocales.includes(voterCountry)) {
      return true;
    }
    if (normLocales.includes("GLOBAL")) {
      return true;
    }
  }

  return false;
}
