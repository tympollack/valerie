/**
 * Project Valerie: Anonymized Voter Locale Resolution
 * File: lib/geo/resolveVoterLocale.ts
 * Work Item: TASK-VAL-LOCALE-INGEST-STAMP / STORY-VAL-LOCALE-HEATMAP-UI
 *
 * Resolves coarse geographic hierarchy tiers (country_iso, admin1_code,
 * admin2_code, h3_res7) from edge headers and user profile metadata.
 *
 * ZERO RAW COORDINATE STORAGE LAW:
 * If coarse coordinates (lat, lng) are provided in edge headers or profile,
 * they are transformed into discrete H3 resolution-7 cell indices in ephemeral
 * memory and immediately discarded. Raw latitude/longitude are NEVER persisted
 * to PostgreSQL or exposed to application logs.
 */

import { latLngToCell } from "h3-js";
import { headers } from "next/headers";

export interface ResolvedVoterLocale {
  country_iso: string | null;
  admin1_code: string | null;
  admin2_code: string | null;
  h3_res7: string | null;
}

/**
 * Safely extracts a named header value across Next.js ReadonlyHeaders,
 * standard Fetch Headers, Maps, or plain Record dictionaries.
 */
function extractHeader(
  headersSource: unknown,
  headerName: string
): string | null {
  if (!headersSource) return null;

  if (typeof (headersSource as { get?: unknown }).get === "function") {
    const val = (headersSource as { get: (name: string) => string | null }).get(headerName);
    return val != null ? String(val) : null;
  }

  if (typeof headersSource === "object") {
    const target = headerName.toLowerCase();
    for (const [key, val] of Object.entries(headersSource as Record<string, unknown>)) {
      if (key.toLowerCase() === target && val != null) {
        return Array.isArray(val) ? String(val[0]) : String(val);
      }
    }
  }

  return null;
}

/**
 * Determines whether a given object is likely a user profile / user session
 * rather than a headers collection.
 */
function isUserObject(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === "string" ||
    o.user_metadata != null ||
    o.app_metadata != null ||
    typeof o.email === "string" ||
    typeof o.aud === "string"
  );
}

/**
 * Resolves coarse-to-fine locale buckets for vote and flag submissions.
 *
 * @param reqHeaders Optional request headers or dictionary (falls back to next/headers if omitted)
 * @param userProfile Optional user profile, Supabase User object, or metadata object
 */
export async function resolveVoterLocale(
  reqHeaders?: unknown,
  userProfile?: unknown
): Promise<ResolvedVoterLocale> {
  // Support flexible signatures: resolveVoterLocale(userProfile)
  let effectiveHeaders = reqHeaders;
  let effectiveProfile = userProfile;

  if (reqHeaders && !userProfile && isUserObject(reqHeaders)) {
    effectiveProfile = reqHeaders;
    effectiveHeaders = undefined;
  }

  // Fallback to Next.js headers() inside Server Component / Action execution context
  if (!effectiveHeaders) {
    try {
      effectiveHeaders = await headers();
    } catch {
      effectiveHeaders = null;
    }
  }

  const getHeader = (name: string): string | null =>
    extractHeader(effectiveHeaders, name);

  // Extract nested profile metadata
  const profileRecord = (effectiveProfile as Record<string, unknown>) || {};
  const userMeta = (profileRecord.user_metadata as Record<string, unknown>) || {};
  const appMeta = (profileRecord.app_metadata as Record<string, unknown>) || {};

  // 1. Resolve Country ISO (ISO 3166-1 alpha-2)
  let country_iso: string | null =
    getHeader("x-country-iso") ||
    getHeader("cf-ipcountry") ||
    getHeader("x-vercel-ip-country") ||
    getHeader("x-geo-country") ||
    null;

  if (!country_iso) {
    country_iso =
      (profileRecord.country_iso as string) ||
      (userMeta.country_iso as string) ||
      (appMeta.country_iso as string) ||
      (profileRecord.country as string) ||
      (userMeta.country as string) ||
      null;
  }

  if (country_iso) {
    const trimmed = country_iso.trim().toUpperCase();
    country_iso = trimmed.length >= 2 ? trimmed.slice(0, 2) : null;
  }

  // 2. Resolve Admin1 Code (State / Province, e.g. US-OH, ON, TX)
  let admin1_code: string | null =
    getHeader("x-admin1-code") ||
    getHeader("x-vercel-ip-country-region") ||
    getHeader("cf-region-code") ||
    getHeader("x-geo-region") ||
    getHeader("x-region-code") ||
    null;

  if (!admin1_code) {
    admin1_code =
      (profileRecord.admin1_code as string) ||
      (userMeta.admin1_code as string) ||
      (appMeta.admin1_code as string) ||
      (profileRecord.state as string) ||
      (userMeta.state as string) ||
      (profileRecord.region as string) ||
      null;
  }

  // 3. Resolve Admin2 Code (County / Municipality / Borough)
  let admin2_code: string | null =
    getHeader("x-admin2-code") ||
    getHeader("x-geo-admin2") ||
    getHeader("x-geo-county") ||
    getHeader("x-vercel-ip-city") ||
    getHeader("x-geo-city") ||
    getHeader("cf-ipcity") ||
    null;

  if (!admin2_code) {
    admin2_code =
      (profileRecord.admin2_code as string) ||
      (userMeta.admin2_code as string) ||
      (appMeta.admin2_code as string) ||
      (profileRecord.county as string) ||
      (userMeta.county as string) ||
      (profileRecord.municipality as string) ||
      (profileRecord.city as string) ||
      null;
  }

  // 4. Resolve H3 Resolution-7 Hex Index
  let h3_res7: string | null =
    getHeader("x-h3-res7") ||
    getHeader("x-geo-h3-res7") ||
    getHeader("x-h3-index") ||
    null;

  // Ephemeral coordinate handling (never persisted to return payload)
  let ephemeralLat: number | null = null;
  let ephemeralLng: number | null = null;

  const latHeader =
    getHeader("x-vercel-ip-latitude") ||
    getHeader("cf-iplatitude") ||
    getHeader("x-geo-latitude") ||
    getHeader("x-latitude") ||
    getHeader("geo-latitude");

  const lngHeader =
    getHeader("x-vercel-ip-longitude") ||
    getHeader("cf-iplongitude") ||
    getHeader("x-geo-longitude") ||
    getHeader("x-longitude") ||
    getHeader("geo-longitude");

  if (latHeader && lngHeader) {
    const parsedLat = parseFloat(latHeader);
    const parsedLng = parseFloat(lngHeader);
    if (
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLng) &&
      parsedLat >= -90 &&
      parsedLat <= 90 &&
      parsedLng >= -180 &&
      parsedLng <= 180
    ) {
      ephemeralLat = parsedLat;
      ephemeralLng = parsedLng;
    }
  }

  if (ephemeralLat === null || ephemeralLng === null) {
    const rawLat =
      profileRecord.latitude ??
      profileRecord.lat ??
      userMeta.latitude ??
      userMeta.lat ??
      appMeta.latitude ??
      appMeta.lat;
    const rawLng =
      profileRecord.longitude ??
      profileRecord.lng ??
      userMeta.longitude ??
      userMeta.lng ??
      appMeta.longitude ??
      appMeta.lng;

    if (rawLat != null && rawLng != null) {
      const parsedLat = typeof rawLat === "string" ? parseFloat(rawLat) : Number(rawLat);
      const parsedLng = typeof rawLng === "string" ? parseFloat(rawLng) : Number(rawLng);
      if (
        Number.isFinite(parsedLat) &&
        Number.isFinite(parsedLng) &&
        parsedLat >= -90 &&
        parsedLat <= 90 &&
        parsedLng >= -180 &&
        parsedLng <= 180
      ) {
        ephemeralLat = parsedLat;
        ephemeralLng = parsedLng;
      }
    }
  }

  // Compute H3 res-7 cell if coarse coordinates were detected
  if (!h3_res7 && ephemeralLat !== null && ephemeralLng !== null) {
    try {
      h3_res7 = latLngToCell(ephemeralLat, ephemeralLng, 7);
    } catch {
      h3_res7 = null;
    }
  }

  // Direct profile H3 fallback
  if (!h3_res7) {
    h3_res7 =
      (profileRecord.h3_res7 as string) ||
      (userMeta.h3_res7 as string) ||
      (appMeta.h3_res7 as string) ||
      (profileRecord.h3_hex_index as string) ||
      (userMeta.h3_hex_index as string) ||
      null;
  }

  // Ephemeral coordinates are now discarded out of scope
  return {
    country_iso: country_iso || null,
    admin1_code: admin1_code?.trim() || null,
    admin2_code: admin2_code?.trim() || null,
    h3_res7: h3_res7?.trim() || null,
  };
}
