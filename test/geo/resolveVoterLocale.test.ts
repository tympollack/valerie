import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveVoterLocale } from "@/lib/geo/resolveVoterLocale";
import { latLngToCell } from "h3-js";

// Mock next/headers
let mockHeadersRecord: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(mockHeadersRecord)) {
        if (k.toLowerCase() === lower) return v;
      }
      return null;
    },
  })),
}));

describe("lib/geo/resolveVoterLocale", () => {
  beforeEach(() => {
    mockHeadersRecord = {};
  });

  it("resolves ISO country, admin1, and admin2 codes from standard edge headers", async () => {
    mockHeadersRecord = {
      "x-country-iso": "US",
      "x-admin1-code": "US-OH",
      "x-admin2-code": "Franklin County",
    };

    const result = await resolveVoterLocale();

    expect(result.country_iso).toBe("US");
    expect(result.admin1_code).toBe("US-OH");
    expect(result.admin2_code).toBe("Franklin County");
    expect(result.h3_res7).toBeNull();
  });

  it("transforms edge header coarse coordinates into H3 resolution-7 without storing raw coordinates", async () => {
    // Columbus, Ohio coarse coordinates
    const lat = 39.9612;
    const lng = -82.9988;
    const expectedH3 = latLngToCell(lat, lng, 7);

    mockHeadersRecord = {
      "x-country-iso": "US",
      "x-admin1-code": "US-OH",
      "x-vercel-ip-latitude": lat.toString(),
      "x-vercel-ip-longitude": lng.toString(),
    };

    const result = await resolveVoterLocale();

    // H3 res-7 cell is correctly stamped
    expect(result.h3_res7).toBe(expectedH3);
    expect(result.country_iso).toBe("US");
    expect(result.admin1_code).toBe("US-OH");

    // Zero Raw Coordinate Hygiene: ensure no coordinate fields leak into returned object
    expect((result as any).latitude).toBeUndefined();
    expect((result as any).longitude).toBeUndefined();
    expect((result as any).lat).toBeUndefined();
    expect((result as any).lng).toBeUndefined();
    expect((result as any).coordinates).toBeUndefined();
  });

  it("resolves coarse coordinates from user profile metadata when headers are absent", async () => {
    // Toronto, Canada coordinates
    const lat = 43.6532;
    const lng = -79.3832;
    const expectedH3 = latLngToCell(lat, lng, 7);

    const userProfile = {
      id: "usr-toronto-1",
      user_metadata: {
        country_iso: "ca",
        admin1_code: "ON",
        admin2_code: "Toronto",
        lat: lat,
        lng: lng,
      },
    };

    const result = await resolveVoterLocale(undefined, userProfile);

    expect(result.country_iso).toBe("CA"); // Sanitized to uppercase 2-letter ISO
    expect(result.admin1_code).toBe("ON");
    expect(result.admin2_code).toBe("Toronto");
    expect(result.h3_res7).toBe(expectedH3);

    // Verify zero raw coordinate leakage
    expect((result as any).lat).toBeUndefined();
    expect((result as any).lng).toBeUndefined();
    expect((result as any).latitude).toBeUndefined();
    expect((result as any).longitude).toBeUndefined();
  });

  it("prefers explicit H3 index header over computing from coordinates if present", async () => {
    mockHeadersRecord = {
      "x-country-iso": "GB",
      "x-h3-res7": "87195da49ffffff",
      "x-vercel-ip-latitude": "51.5074",
      "x-vercel-ip-longitude": "-0.1278",
    };

    const result = await resolveVoterLocale();

    expect(result.country_iso).toBe("GB");
    expect(result.h3_res7).toBe("87195da49ffffff");
  });

  it("gracefully discards out-of-bounds coordinates without crashing", async () => {
    mockHeadersRecord = {
      "x-country-iso": "US",
      "x-latitude": "120.5", // invalid latitude > 90
      "x-longitude": "-80.0",
    };

    const result = await resolveVoterLocale();

    expect(result.country_iso).toBe("US");
    expect(result.h3_res7).toBeNull();
    expect((result as any).latitude).toBeUndefined();
  });

  it("handles dictionary / map headers object directly passed as first argument", async () => {
    const customHeaders = {
      "x-country-iso": "FR",
      "x-admin1-code": "IDF",
      "x-admin2-code": "Paris",
    };

    const result = await resolveVoterLocale(customHeaders);

    expect(result.country_iso).toBe("FR");
    expect(result.admin1_code).toBe("IDF");
    expect(result.admin2_code).toBe("Paris");
  });
});
