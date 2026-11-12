/**
 * Project Valerie: Sovereign Citizen Decree & Landowner Dossier Types
 * Work Item: [TASK-VAL-DOSSIER-SERVICE] / [STORY-VAL-LANDOWNER-DECREE]
 */

export interface LandownerDeedInfo {
  parcelId: string;
  ownerName: string;
  propertyAddress: string;
  zoningClassification: string;
  deedBookPage?: string;
  recordingDate?: string;
  boundaryPolygonGeoJson?: Record<string, unknown>;
  isVerifiedParcelRecord?: boolean;
}

export interface GisBufferProof {
  facilityName: string;
  facilityType: "SCHOOL" | "PARK" | "HOSPITAL" | "RESIDENTIAL_ZONE";
  bufferRequirementFeet: number;
  measuredDistanceFeet: number;
  violationDistanceFeet: number;
  isBreach: boolean;
  geometryGeoJson?: Record<string, unknown>;
}

export interface HardwarePhotoAttestation {
  photoUrl: string;
  sha256Hash: string;
  capturedAt: string;
  deviceAttestationId: string;
  locationCoordinates: { lat: number; lng: number };
}

export interface MrpConsensusMetrics {
  sampleSize: number;
  supermajorityScore: number | null; // e.g. 0.78 (78%), or null if unavailable
  marginOfError?: number | null; // e.g. 0.021 (+/- 2.1%), only when measured
  confidenceInterval?: number | null; // e.g. 0.95, only when measured
  turnoutWeight?: number | null; // only when measured
  demographicCoverageScore?: number | null; // only when measured
}

export interface LeaseTerminationNotice {
  clauseTitle: string;
  statutoryCovenant: string;
  curePeriodDays: number;
  legalNoticeBody: string;
}

export interface SovereignDecreeDossierInput {
  decreeId: string;
  decreeTitle: string;
  mandateText: string;
  merkleRootHash: string;
  createdAt: string;
  deedInfo: LandownerDeedInfo;
  mrpMetrics: MrpConsensusMetrics;
  gisProofs: GisBufferProof[];
  photos: HardwarePhotoAttestation[];
  leaseTerminationNotice?: LeaseTerminationNotice;
  verificationUrl?: string;
}

export interface DecreeDossierCompiledResult {
  dossierJson: SovereignDecreeDossierInput;
  pdfBuffer: Uint8Array;
  sha256MerkleRoot: string;
  generationDurationMs: number;
}
