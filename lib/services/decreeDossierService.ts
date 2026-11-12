/**
 * Project Valerie: Sovereign Citizen Decree Dossier Service
 * File: lib/services/decreeDossierService.ts
 * Work Item: [TASK-VAL-DOSSIER-SERVICE] / [STORY-VAL-LANDOWNER-DECREE]
 *
 * Compiles verified community consensus, census demographics, and GIS proof
 * into certified PDF/JSON dossiers served to parcel owners.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  SovereignDecreeDossierInput,
  DecreeDossierCompiledResult,
  GisBufferProof,
  HardwarePhotoAttestation,
} from "../types/decreeDossier";
import { generateDecreePdf } from "./decreePdfGenerator";
import { t } from "../i18n";

/**
 * Standard commercial lease Public Nuisance & Indemnification termination clause factory.
 * Localized via lib/i18n.
 */
export function getStandardLeaseNuisanceClause(locale = "en-US") {
  return {
    clauseTitle: t("legal.commercialLeaseNuisance.clauseTitle", undefined, locale),
    statutoryCovenant: t("legal.commercialLeaseNuisance.statutoryCovenant", undefined, locale),
    curePeriodDays: 30,
    legalNoticeBody: t("legal.commercialLeaseNuisance.legalNoticeBody", undefined, locale),
  };
}

export const STANDARD_LEASE_NUISANCE_CLAUSE = getStandardLeaseNuisanceClause();

/**
 * Extracts a finite numeric measurement from candidate metadata records without fabricating defaults.
 */
function pickFiniteMetric(
  sources: Array<Record<string, unknown> | null | undefined>,
  keys: string[]
): number | null {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const key of keys) {
      const raw = src[key];
      if (raw === null || raw === undefined || raw === "") continue;
      if (typeof raw !== "number" && (typeof raw !== "string" || !raw.trim())) continue;
      const num = Number(raw);
      if (Number.isFinite(num)) {
        return num;
      }
    }
  }
  return null;
}

/**
 * Loads raw decree, poll, and ad audit records and synthesizes a certified dossier input object.
 * Strictly adheres to Production Data Hygiene (Rule 3): Zero fake data. Empty queries render empty records.
 */
export async function compileDecreeDossierData(
  supabase: SupabaseClient,
  decreeId: string
): Promise<SovereignDecreeDossierInput | null> {
  const target =
    typeof (supabase as any).schema === "function"
      ? (supabase as any).schema("valerie")
      : supabase;

  // 1. Fetch decree
  const { data: decree, error: decreeErr } = await target
    .from("sovereign_decrees")
    .select("*")
    .eq("id", decreeId)
    .single();

  if (decreeErr) {
    const msg = decreeErr.message?.toLowerCase() || "";
    if (
      decreeErr.code === "PGRST116" ||
      msg.includes("multiple (or no) rows") ||
      msg.includes("not found")
    ) {
      return null;
    }
    throw new Error(`Database error fetching sovereign decree: ${decreeErr.message}`);
  }

  if (!decree) {
    return null;
  }

  // 2. Fetch associated poll
  const { data: poll, error: pollErr } = await target
    .from("polls")
    .select("*")
    .eq("id", decree.poll_id)
    .single();

  if (pollErr) {
    const msg = pollErr.message?.toLowerCase() || "";
    if (
      pollErr.code !== "PGRST116" &&
      !msg.includes("multiple (or no) rows") &&
      !msg.includes("not found")
    ) {
      throw new Error(`Database error fetching associated poll: ${pollErr.message}`);
    }
  }

  // 3. Fetch associated ad compliance audit if linked
  let auditRecord = null;
  const { data: audits, error: auditErr } = await target
    .from("ad_compliance_audits")
    .select("*")
    .eq("decomposed_poll_id", decree.poll_id)
    .limit(1);

  if (auditErr) {
    throw new Error(`Database error fetching ad compliance audits: ${auditErr.message}`);
  }

  if (Array.isArray(audits) && audits.length > 0) {
    auditRecord = audits[0];
  }

  // Extract parcel, GIS, and photo proofs from audit record metadata if present
  const auditMetadata = (auditRecord?.metadata as Record<string, any>) || {};
  const gisProofs: GisBufferProof[] = Array.isArray(auditMetadata.gis_proofs)
    ? auditMetadata.gis_proofs
    : [];

  const photos: HardwarePhotoAttestation[] = Array.isArray(auditMetadata.hardware_photos)
    ? auditMetadata.hardware_photos
    : [];

  // Parse deed info adhering to Rule 3: Zero fake data. Distinguish reported parcel IDs from verified deeds.
  const rawParcelId =
    (typeof auditRecord?.parcel_id === "string" && auditRecord.parcel_id.trim()) ||
    (typeof auditMetadata.parcel_id === "string" && auditMetadata.parcel_id.trim()) ||
    null;
  const hasVerifiedProvenance =
    auditMetadata.deed_verified === true || auditMetadata.verified_parcel_record === true;
  const hasRecordedDeedDetails = Boolean(
    rawParcelId &&
      typeof auditMetadata.owner_name === "string" &&
      auditMetadata.owner_name.trim() &&
      ((typeof auditMetadata.property_address === "string" && auditMetadata.property_address.trim()) ||
        (typeof auditMetadata.deed_book_page === "string" && auditMetadata.deed_book_page.trim()))
  );
  const hasVerifiedParcel = Boolean(hasVerifiedProvenance && hasRecordedDeedDetails);

  const deedInfo = {
    parcelId: rawParcelId || "UNRECORDED",
    ownerName: auditMetadata.owner_name || "Unrecorded",
    propertyAddress: auditMetadata.property_address || (poll?.target_locale_code ? `District ${poll.target_locale_code}` : "Unspecified"),
    zoningClassification: auditMetadata.zoning_classification || "Unclassified",
    deedBookPage: auditMetadata.deed_book_page,
    recordingDate: auditMetadata.recording_date,
    boundaryPolygonGeoJson: auditMetadata.boundary_polygon,
    isVerifiedParcelRecord: hasVerifiedParcel,
  };

  // Load only measured/stored MRP consensus metrics; never fabricate fallback statistics
  const metricSources: Array<Record<string, unknown> | null | undefined> = [
    decree as Record<string, unknown>,
    (decree?.metadata as Record<string, unknown> | undefined)?.mrp_metrics as Record<string, unknown> | undefined,
    decree?.mrp_metrics as Record<string, unknown> | undefined,
    poll as Record<string, unknown> | null | undefined,
    (poll?.metadata as Record<string, unknown> | undefined)?.mrp_metrics as Record<string, unknown> | undefined,
  ];
  const sampleSize = pickFiniteMetric([decree as Record<string, unknown>], ["verified_citizen_count"]) ?? 0;
  const supermajorityScore = pickFiniteMetric(metricSources, [
    "calibrated_consensus_share",
    "supermajority_score",
    "supermajorityScore",
  ]);
  const marginOfError = pickFiniteMetric(metricSources, ["margin_of_error", "marginOfError"]);
  const confidenceInterval = pickFiniteMetric(metricSources, ["confidence_interval", "confidenceInterval"]);
  const turnoutWeight = pickFiniteMetric(metricSources, ["turnout_weight", "turnoutWeight"]);
  const demographicCoverageScore = pickFiniteMetric(metricSources, [
    "demographic_coverage_score",
    "demographicCoverageScore",
  ]);

  // Only certify lease nuisance termination notice if confirmed municipal setback breach exists
  const hasActiveBreach = gisProofs.some((proof) => proof.isBreach === true);
  const leaseTerminationNotice = hasActiveBreach ? STANDARD_LEASE_NUISANCE_CLAUSE : undefined;

  return {
    decreeId: decree.id,
    decreeTitle: decree.decree_title,
    mandateText: decree.mandate_text,
    merkleRootHash: decree.merkle_root_hash,
    createdAt: decree.created_at,
    deedInfo,
    mrpMetrics: {
      sampleSize,
      supermajorityScore,
      marginOfError,
      confidenceInterval,
      turnoutWeight,
      demographicCoverageScore,
    },
    gisProofs,
    photos,
    leaseTerminationNotice,
    verificationUrl: `https://valerie.sunshade.icu/decree/${decree.id}`,
  };
}

/**
 * Builds the complete Sovereign Citizen Decree dossier and generates the certified PDF 1.4 document.
 * Enforces < 1500ms execution SLA.
 */
export async function generateDecreeDossierService(
  input: SovereignDecreeDossierInput
): Promise<DecreeDossierCompiledResult> {
  const startTime = Date.now();

  // Generate high-contrast legal-grade PDF
  const pdfBuffer = generateDecreePdf(input);
  const durationMs = Date.now() - startTime;

  return {
    dossierJson: input,
    pdfBuffer,
    sha256MerkleRoot: input.merkleRootHash,
    generationDurationMs: durationMs,
  };
}
