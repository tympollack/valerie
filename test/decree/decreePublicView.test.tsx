import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecreePublicView } from "@/components/decree/DecreePublicView";
import { SovereignDecreeDossierInput } from "@/lib/types/decreeDossier";

describe("DecreePublicView Component (TASK-VAL-ZONING-RECORD)", () => {
  const mockDossier: SovereignDecreeDossierInput = {
    decreeId: "d0000000-0000-0000-0000-000000000001",
    decreeTitle: "Public Advertising Curfew Decree",
    mandateText: "Commercial advertisers on Parcel 12-B must dim digital billboard illumination between 10 PM and 6 AM.",
    merkleRootHash: "b7e2c9a1d4f6a8b0c2e4f6a8b0c2e4f6a8b0c2e4f6a8b0c2e4f6a8b0c2e4f6a8",
    createdAt: "2026-11-09T08:00:00Z",
    deedInfo: {
      parcelId: "PARCEL-12-B",
      ownerName: "Metropolitan Land Trust",
      propertyAddress: "450 Atlantic Avenue, District 3",
      zoningClassification: "B-2 Commercial Waterfront",
    },
    mrpMetrics: {
      sampleSize: 2450,
      supermajorityScore: 0.842,
      marginOfError: 0.02,
      confidenceInterval: 0.95,
      turnoutWeight: 1.1,
    },
    gisProofs: [
      {
        facilityName: "Waterfront Daycare Center",
        facilityType: "SCHOOL",
        bufferRequirementFeet: 1000,
        measuredDistanceFeet: 280,
        violationDistanceFeet: 720,
        isBreach: true,
      },
    ],
    photos: [],
    verificationUrl: "https://valerie.sunshade.icu/decree/d0000000-0000-0000-0000-000000000001",
  };

  it("renders decree title, mandate text, and tamper-evident Merkle root hash", () => {
    render(<DecreePublicView dossier={mockDossier} />);

    expect(screen.getByText("Public Advertising Curfew Decree")).toBeInTheDocument();
    expect(screen.getByText(mockDossier.mandateText)).toBeInTheDocument();
    expect(screen.getByText(mockDossier.merkleRootHash)).toBeInTheDocument();
  });

  it("renders MRP consensus metrics with supermajority conviction and margin of error", () => {
    render(<DecreePublicView dossier={mockDossier} />);

    expect(screen.getByText("84.2%")).toBeInTheDocument();
    expect(screen.getByText("2,450")).toBeInTheDocument();
    expect(screen.getByText("±2.0%")).toBeInTheDocument();
  });

  it("renders parcel deed record and zoning classification", () => {
    render(<DecreePublicView dossier={mockDossier} />);

    expect(screen.getByText("PARCEL-12-B")).toBeInTheDocument();
    expect(screen.getByText("Metropolitan Land Trust")).toBeInTheDocument();
    expect(screen.getByText("450 Atlantic Avenue, District 3")).toBeInTheDocument();
    expect(screen.getByText("B-2 Commercial Waterfront")).toBeInTheDocument();
  });

  it("renders GIS setback violation proofs with breach indicators", () => {
    render(<DecreePublicView dossier={mockDossier} />);

    expect(screen.getByText("Waterfront Daycare Center")).toBeInTheDocument();
    expect(screen.getByText("280ft")).toBeInTheDocument();
    expect(screen.getByText("1000ft")).toBeInTheDocument();
  });

  it("provides 1-click Download Certified Legal Dossier button pointing to pdf route", () => {
    render(<DecreePublicView dossier={mockDossier} />);

    const downloadLink = screen.getByRole("link", { name: /Download Certified Legal Dossier/i });
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink).toHaveAttribute("href", `/api/decree/${mockDossier.decreeId}/pdf`);
    expect(downloadLink).toHaveAttribute("download", `sovereign-decree-${mockDossier.decreeId}.pdf`);
  });

  it("copies newsroom oEmbed code to clipboard on click", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    render(<DecreePublicView dossier={mockDossier} />);

    const copyBtn = screen.getByRole("button", { name: /Copy Newsroom Embed/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(`<iframe src="${mockDossier.verificationUrl}"`)
    );
    expect(await screen.findByText(/Embed Snippet Copied/i)).toBeInTheDocument();
  });
});
