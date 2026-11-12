import { describe, it, expect, vi } from "vitest";
import {
  generateDecreeDossierService,
  compileDecreeDossierData,
  STANDARD_LEASE_NUISANCE_CLAUSE,
} from "@/lib/services/decreeDossierService";
import { SovereignDecreeDossierInput } from "@/lib/types/decreeDossier";

describe("Sovereign Citizen Decree Dossier Service (TASK-VAL-DOSSIER-SERVICE)", () => {
  const mockDossierInput: SovereignDecreeDossierInput = {
    decreeId: "d0000000-0000-0000-0000-000000000001",
    decreeTitle: "Decree on High-Luminance Transit Corridor Advertising Abatement",
    mandateText: "Commercial advertisers on Parcel 44-A must cease digital flashing displays between 10 PM and 6 AM.",
    merkleRootHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    createdAt: "2026-11-09T12:00:00.000Z",
    deedInfo: {
      parcelId: "PARCEL-44-A",
      ownerName: "Apex Holdings LLC",
      propertyAddress: "100 Grand Avenue, District 4",
      zoningClassification: "C-2 Highway Commercial",
      deedBookPage: "Book 412, Page 88",
    },
    mrpMetrics: {
      sampleSize: 1250,
      supermajorityScore: 0.785,
      marginOfError: 0.028,
      confidenceInterval: 0.95,
      turnoutWeight: 1.15,
      demographicCoverageScore: 0.94,
    },
    gisProofs: [
      {
        facilityName: "Lincoln Elementary School",
        facilityType: "SCHOOL",
        bufferRequirementFeet: 1000,
        measuredDistanceFeet: 340,
        violationDistanceFeet: 660,
        isBreach: true,
      },
    ],
    photos: [
      {
        photoUrl: "https://photos.patchwork.icu/attestation/photo-1.jpg",
        sha256Hash: "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
        capturedAt: "2026-11-08T22:15:00.000Z",
        deviceAttestationId: "TPM-HARDWARE-SEC-8821",
        locationCoordinates: { lat: 42.3601, lng: -71.0589 },
      },
    ],
    leaseTerminationNotice: STANDARD_LEASE_NUISANCE_CLAUSE,
    verificationUrl: "https://valerie.sunshade.icu/decree/d0000000-0000-0000-0000-000000000001",
  };

  it("generates a certified PDF 1.4 document in under 1500ms SLA", async () => {
    const result = await generateDecreeDossierService(mockDossierInput);

    expect(result.generationDurationMs).toBeLessThan(1500);
    expect(result.pdfBuffer).toBeInstanceOf(Uint8Array);
    expect(result.pdfBuffer.length).toBeGreaterThan(100);

    // Verify PDF header and trailer
    const pdfString = Buffer.from(result.pdfBuffer).toString("utf-8");
    expect(pdfString.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfString).toContain("%%EOF");
    expect(pdfString).toContain("startxref");
  });

  it("embeds SHA-256 Merkle root hash in the document header for tamper verification", async () => {
    const result = await generateDecreeDossierService(mockDossierInput);
    const pdfString = Buffer.from(result.pdfBuffer).toString("utf-8");

    expect(pdfString).toContain(mockDossierInput.merkleRootHash);
    expect(result.sha256MerkleRoot).toBe(mockDossierInput.merkleRootHash);
  });

  it("includes legal notification referencing commercial lease public nuisance termination provisions", async () => {
    const result = await generateDecreeDossierService(mockDossierInput);
    const pdfString = Buffer.from(result.pdfBuffer).toString("utf-8");

    expect(pdfString).toContain("PUBLIC NUISANCE & LEASE INDEMNIFICATION TRIGGER");
    expect(pdfString).toContain("Section 14.3");
  });

  it("includes PostGIS setback proof and hardware-attested photo evidence", async () => {
    const result = await generateDecreeDossierService(mockDossierInput);
    const pdfString = Buffer.from(result.pdfBuffer).toString("utf-8");

    expect(pdfString).toContain("Lincoln Elementary School");
    expect(pdfString).toContain("[BREACH CONFIRMED]");
    expect(pdfString).toContain("TPM-HARDWARE-SEC-8821");
    expect(pdfString).toContain("a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e");
  });

  it("compiles decree dossier data from database client safely", async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "sovereign_decrees") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "dec-123",
                poll_id: "poll-456",
                decree_title: "Corridor Ad Decoupling",
                mandateText: "Mandate",
                calibrated_consensus_share: 0.81,
                verified_citizen_count: 500,
                merkle_root_hash: "hash123",
                created_at: "2026-11-09T00:00:00Z",
              },
              error: null,
            }),
          };
        }
        if (table === "polls") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "poll-456", target_locale_code: "US-MA" },
              error: null,
            }),
          };
        }
        if (table === "ad_compliance_audits") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    } as any;

    const data = await compileDecreeDossierData(mockSupabase, "dec-123");
    expect(data).not.toBeNull();
    expect(data?.decreeId).toBe("dec-123");
    expect(data?.mrpMetrics.supermajorityScore).toBe(0.81);
    expect(data?.mrpMetrics.sampleSize).toBe(500);
    // Verifies BUG_0004 fix: unstored statistical metrics are null instead of fabricated defaults
    expect(data?.mrpMetrics.marginOfError).toBeNull();
    expect(data?.mrpMetrics.confidenceInterval).toBeNull();
    expect(data?.mrpMetrics.turnoutWeight).toBeNull();
    expect(data?.mrpMetrics.demographicCoverageScore).toBeNull();
    expect(data?.merkleRootHash).toBe("hash123");
    // Verifies production data hygiene: unrecorded parcel when audit is absent
    expect(data?.deedInfo.parcelId).toBe("UNRECORDED");
    expect(data?.deedInfo.ownerName).toBe("Unrecorded");
    expect(data?.deedInfo.zoningClassification).toBe("Unclassified");
    expect(data?.deedInfo.isVerifiedParcelRecord).toBe(false);
    // Verifies conditional breach notice: no breach proofs -> no termination clause
    expect(data?.leaseTerminationNotice).toBeUndefined();
  });

  it("loads stored MRP statistical metrics when present without fabricating absent values", async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "sovereign_decrees") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "dec-mrp",
                poll_id: "poll-mrp",
                decree_title: "Calibrated Decree",
                mandate_text: "Mandate",
                calibrated_consensus_share: null,
                verified_citizen_count: 400,
                merkle_root_hash: "hashmrp",
                created_at: "2026-11-09T00:00:00Z",
                metadata: {
                  mrp_metrics: {
                    margin_of_error: 0.031,
                    confidence_interval: 0.99,
                  },
                },
              },
              error: null,
            }),
          };
        }
        if (table === "polls") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "poll-mrp" }, error: null }),
          };
        }
        if (table === "ad_compliance_audits") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    } as any;

    const data = await compileDecreeDossierData(mockSupabase, "dec-mrp");
    expect(data?.mrpMetrics.supermajorityScore).toBeNull();
    expect(data?.mrpMetrics.marginOfError).toBe(0.031);
    expect(data?.mrpMetrics.confidenceInterval).toBe(0.99);
    expect(data?.mrpMetrics.turnoutWeight).toBeNull();
  });

  it("skips boolean and array values without converting them to zero (BUG_0002)", async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "sovereign_decrees") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "dec-bool",
                poll_id: "poll-bool",
                decree_title: "Bool Skip Decree",
                mandate_text: "Mandate",
                calibrated_consensus_share: null,
                verified_citizen_count: 500,
                merkle_root_hash: "hashbool",
                created_at: "2026-11-09T00:00:00Z",
                metadata: {
                  mrp_metrics: {
                    margin_of_error: false, // boolean must be skipped, not coerced to 0
                    confidence_interval: [], // array must be skipped, not coerced to 0
                    supermajority_score: "", // empty string must be skipped
                  },
                },
              },
              error: null,
            }),
          };
        }
        if (table === "polls") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "poll-bool",
                metadata: {
                  mrp_metrics: {
                    margin_of_error: 0.024,
                    confidence_interval: 0.95,
                    supermajority_score: 0.82,
                  },
                },
              },
              error: null,
            }),
          };
        }
        if (table === "ad_compliance_audits") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    } as any;

    const data = await compileDecreeDossierData(mockSupabase, "dec-bool");
    expect(data?.mrpMetrics.supermajorityScore).toBe(0.82);
    expect(data?.mrpMetrics.marginOfError).toBe(0.024);
    expect(data?.mrpMetrics.confidenceInterval).toBe(0.95);
  });

  it("attaches statutory lease termination notice when active breach exists and keeps unverified parcel_id unverified", async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "sovereign_decrees") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "dec-breach",
                poll_id: "poll-breach",
                decree_title: "Breach Decree",
                mandate_text: "Mandate",
                calibrated_consensus_share: 0.85,
                verified_citizen_count: 600,
                merkle_root_hash: "hashbreach",
                created_at: "2026-11-09T00:00:00Z",
              },
              error: null,
            }),
          };
        }
        if (table === "polls") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "poll-breach", target_locale_code: "US-MA" },
              error: null,
            }),
          };
        }
        if (table === "ad_compliance_audits") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  parcel_id: "PARCEL-REAL-99",
                  metadata: {
                    owner_name: "Apex Properties Inc",
                    zoning_classification: "C-1",
                    gis_proofs: [
                      {
                        facilityName: "Civic Playground",
                        facilityType: "PARK",
                        bufferRequirementFeet: 500,
                        measuredDistanceFeet: 120,
                        violationDistanceFeet: 380,
                        isBreach: true,
                      },
                    ],
                  },
                },
              ],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    } as any;

    const data = await compileDecreeDossierData(mockSupabase, "dec-breach");
    expect(data).not.toBeNull();
    expect(data?.deedInfo.parcelId).toBe("PARCEL-REAL-99");
    // Reported parcel_id without recorded deed provenance must not be marked verified
    expect(data?.deedInfo.isVerifiedParcelRecord).toBe(false);
    expect(data?.leaseTerminationNotice).toBeDefined();
    expect(data?.leaseTerminationNotice?.clauseTitle).toContain("Section 14.3");
  });

  it("marks parcel as verified only when deed provenance and recorded deed details exist", async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "sovereign_decrees") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "dec-verified",
                poll_id: "poll-verified",
                decree_title: "Verified Deed Decree",
                mandate_text: "Mandate",
                calibrated_consensus_share: 0.85,
                verified_citizen_count: 600,
                merkle_root_hash: "hashverified",
                created_at: "2026-11-09T00:00:00Z",
              },
              error: null,
            }),
          };
        }
        if (table === "polls") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "poll-verified", target_locale_code: "US-MA" },
              error: null,
            }),
          };
        }
        if (table === "ad_compliance_audits") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  parcel_id: "PARCEL-DEED-42",
                  metadata: {
                    deed_verified: true,
                    owner_name: "Apex Properties Inc",
                    property_address: "42 Harbor Way, Boston, MA",
                    deed_book_page: "Book 104, Page 12",
                    zoning_classification: "C-1",
                  },
                },
              ],
              error: null,
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    } as any;

    const data = await compileDecreeDossierData(mockSupabase, "dec-verified");
    expect(data?.deedInfo.parcelId).toBe("PARCEL-DEED-42");
    expect(data?.deedInfo.isVerifiedParcelRecord).toBe(true);
  });

  it("throws error disclosing database failures when audits or polls queries fail", async () => {
    const mockSupabaseAuditFail = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "sovereign_decrees") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "dec-fail", poll_id: "poll-fail" },
              error: null,
            }),
          };
        }
        if (table === "polls") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: "poll-fail" }, error: null }),
          };
        }
        if (table === "ad_compliance_audits") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: { message: "connection timeout" } }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    } as any;

    await expect(compileDecreeDossierData(mockSupabaseAuditFail, "dec-fail")).rejects.toThrow(
      "Database error fetching ad compliance audits: connection timeout"
    );
  });

  it("generates valid multi-page PDF documents when evidence exceeds one page", async () => {
    const longDossierInput: SovereignDecreeDossierInput = {
      ...mockDossierInput,
      photos: Array.from({ length: 30 }, (_, i) => ({
        photoUrl: `https://photos.patchwork.icu/attestation/photo-${i}.jpg`,
        sha256Hash: `hash-${i.toString().padStart(64, "0")}`,
        capturedAt: "2026-11-08T22:15:00.000Z",
        deviceAttestationId: `TPM-DEVICE-${i}`,
        locationCoordinates: { lat: 42.3601, lng: -71.0589 },
      })),
    };

    const result = await generateDecreeDossierService(longDossierInput);
    const pdfBuf = Buffer.from(result.pdfBuffer);
    const pdfText = pdfBuf.toString("latin1");

    expect(pdfText).toContain("/Count 2");
    expect(pdfText).toContain("SOVEREIGN DECREE DOSSIER - PAGE 2");
    expect(pdfText).toContain("TPM-DEVICE-29");

    // Verify WinAnsiEncoding and octal-escaped legal symbols (no UTF-8 mojibake)
    expect(pdfText).toContain("/Encoding /WinAnsiEncoding");
    expect(pdfText).toContain("\\261"); // ± in WinAnsi
    expect(pdfText).not.toContain("Â±");

    // Verify XRef table offsets resolve strictly in object-number order (1..N)
    const startxrefMatch = pdfText.match(/startxref\s+(\d+)\s+%%EOF/);
    expect(startxrefMatch).not.toBeNull();
    const xrefOffset = Number(startxrefMatch![1]);
    const xrefSection = pdfText.slice(xrefOffset);
    const entryMatches = [...xrefSection.matchAll(/^(\d{10}) (\d{5}) ([nf]) /gm)];
    // Object 0 (free) + 8 objects (Catalog, Pages, 2 Pages, 2 Streams, 2 Fonts)
    expect(entryMatches.length).toBe(9);

    for (let objNum = 1; objNum <= 8; objNum++) {
      const off = Number(entryMatches[objNum][1]);
      expect(pdfBuf.subarray(off, off + 10).toString("latin1").startsWith(`${objNum} 0 obj`)).toBe(true);
    }

    // Verify /Kids references in /Pages point to /Type /Page objects, not streams
    const pageKids = [3, 4];
    for (const pageObjNum of pageKids) {
      const pageOffset = Number(entryMatches[pageObjNum][1]);
      const pageObjSlice = pdfBuf.subarray(pageOffset, pageOffset + 180).toString("latin1");
      expect(pageObjSlice).toContain("/Type /Page");
    }
  });

  it("renders Unavailable instead of fabricated numbers when MRP metrics are null", async () => {
    const unavailableInput: SovereignDecreeDossierInput = {
      ...mockDossierInput,
      mrpMetrics: {
        sampleSize: 100,
        supermajorityScore: null,
        marginOfError: null,
        confidenceInterval: null,
        turnoutWeight: null,
      },
    };
    const result = await generateDecreeDossierService(unavailableInput);
    const pdfText = Buffer.from(result.pdfBuffer).toString("latin1");
    expect(pdfText).toContain("Supermajority Conviction: Unavailable");
    expect(pdfText).toContain("Margin of Error: Unavailable \\(CI: Unavailable\\)");
    expect(pdfText).toContain("Turnout Weight: Unavailable");
  });

  it("returns null when decree is not found", async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
      }),
    } as any;

    const data = await compileDecreeDossierData(mockSupabase, "non-existent");
    expect(data).toBeNull();
  });
});
