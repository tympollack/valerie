import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleSentimentExplorer } from "./LocaleSentimentExplorer";
import * as localeActions from "@/app/actions/valerieLocaleActions";

describe("LocaleSentimentExplorer Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRecords: localeActions.LocaleSentimentRecord[] = [
    {
      locale_bucket: "US-OH",
      participant_count: 32,
      vote_count: 28,
      flag_count: 4,
      mean_likert: 1.45,
      mean_confidence: 82.0,
      weighted_salience: 1.55,
      is_inside_blast_radius: true,
      shockwave_24h_likert: 1.80,
      settled_likert: 1.20,
    },
    {
      locale_bucket: "US-CA",
      participant_count: 50,
      vote_count: 46,
      flag_count: 4,
      mean_likert: 0.65,
      mean_confidence: 70.0,
      weighted_salience: 0.70,
      is_inside_blast_radius: false,
      shockwave_24h_likert: 0.90,
      settled_likert: 0.55,
    },
  ];

  it("renders the multi-scale segmented pill selector", () => {
    render(<LocaleSentimentExplorer pollId="poll-test-1" initialRecords={mockRecords} />);

    expect(screen.getByText("Multi-Scale Locale Sentiment Rollup")).toBeInTheDocument();
    expect(screen.getByText("Local (H3 / County)")).toBeInTheDocument();
    expect(screen.getByText("State / Province")).toBeInTheDocument();
    expect(screen.getByText("National")).toBeInTheDocument();
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("calculates and highlights Proximity Divergence delta > 0.50 with alert badge", () => {
    // inside: 1.55, outside: 0.70 -> delta = 0.85 (> 0.50)
    render(<LocaleSentimentExplorer pollId="poll-test-2" initialRecords={mockRecords} />);

    expect(screen.getByText("Blast-Radius Proximity Divergence")).toBeInTheDocument();
    expect(screen.getByText(/Divergence: \+0\.85/i)).toBeInTheDocument();
    expect(screen.getByText("(High Divergence >0.50)")).toBeInTheDocument();
    expect(screen.getByText("Directly Impacted Locales")).toBeInTheDocument();
    expect(screen.getByText("External Observers")).toBeInTheDocument();
  });

  it("renders temporal velocity metrics (24h Shockwave vs. Deliberative Settled)", () => {
    render(<LocaleSentimentExplorer pollId="poll-test-3" initialRecords={mockRecords} />);

    expect(screen.getByText(/Temporal Velocity/i)).toBeInTheDocument();
    expect(screen.getByText("US-OH")).toBeInTheDocument();
    expect(screen.getByText("+1.80")).toBeInTheDocument(); // Shockwave
    expect(screen.getByText("+1.20")).toBeInTheDocument(); // Settled
  });

  it("renders connected ecosystem ground-truth evidence deep links", () => {
    const ecosystemRefs = {
      patchwork: "PW-AFFIDAVIT-901",
      speak_for_the_dead: "SFTD-TRANSCRIPT-42",
    };

    render(
      <LocaleSentimentExplorer
        pollId="poll-test-4"
        initialRecords={mockRecords}
        relatedEcosystemRefs={ecosystemRefs}
      />
    );

    expect(screen.getByText("Connected Ecosystem Ground-Truth Evidence")).toBeInTheDocument();
    expect(screen.getByText("PatchWork #PW-AFFIDAVIT-901")).toBeInTheDocument();
    expect(screen.getByText("Speak for the Dead #SFTD-TRANSCRIPT-42")).toBeInTheDocument();
  });

  it("triggers fetchPollResultsByLocale on granularity switch and handles K-anonymity fallback", async () => {
    const spy = vi.spyOn(localeActions, "fetchPollResultsByLocale").mockImplementation(async (_id, gran = "NATIONAL") => {
      const effectiveGran: localeActions.LocaleGranularity = gran ?? "NATIONAL";
      if (effectiveGran === "LOCAL") {
        return {
          success: true,
          granularity: "STATE",
          fallbackApplied: true,
          fallbackReason: "Local participation (<10 responses) is omitted by K-anonymity privacy rules. Rolled up to State / Province tier.",
          data: mockRecords,
        };
      }
      return {
        success: true,
        granularity: effectiveGran,
        fallbackApplied: false,
        data: [],
      };
    });

    render(<LocaleSentimentExplorer pollId="poll-test-5" initialGranularity="NATIONAL" initialRecords={[]} />);

    const localBtn = screen.getByText("Local (H3 / County)").closest("button")!;

    // Wait for initial mount fetch to complete and button to be enabled
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("poll-test-5", "NATIONAL");
      expect(localBtn).not.toBeDisabled();
    });

    fireEvent.click(localBtn);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("poll-test-5", "LOCAL");
      expect(screen.getByText(/Privacy Threshold Active:/i)).toBeInTheDocument();
      expect(screen.getByText(/Local participation \(<10 responses\) is omitted/i)).toBeInTheDocument();
    });
  });

  it("renders clean empty state when no records exist", () => {
    render(<LocaleSentimentExplorer pollId="poll-empty" initialRecords={[]} />);

    expect(screen.getByText("No geographic clusters with ≥10 participants available at this scale tier.")).toBeInTheDocument();
    expect(screen.getByText("Insufficient dual-group observers")).toBeInTheDocument();
  });
});
