import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { BivariatePollCard } from "@/components/valerie/BivariatePollCard";

const mockCastVote = vi.fn();
const mockSubmitVote = vi.fn();
const mockFlagPollWithCommitGate = vi.fn();

vi.mock("@/app/actions/vote", () => ({
  castVote: (...args: any[]) => mockCastVote(...args),
  submitVote: (...args: any[]) => mockSubmitVote(...args),
}));

vi.mock("@/app/actions/valerieFlagActions", () => ({
  flagPollWithCommitGate: (...args: any[]) => mockFlagPollWithCommitGate(...args),
  VALID_FLAG_REASONS: ["LOADED_FRAMING", "FALSE_DICHOTOMY", "DISPUTED_PREMISE", "LOCALE_MISMATCH"],
}));

describe("BivariatePollCard Sequential Packet Flow & Cadence Off-Ramp", () => {
  const companionPolls = [
    {
      id: "poll-companion-1",
      question_text: "Should municipal bus lanes be expanded on Main St?",
      axis_category: "Public Infrastructure",
    },
    {
      id: "poll-companion-2",
      question_text: "Should congestion fees apply to commercial delivery vans?",
      axis_category: "Commercial Policy",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockCastVote.mockResolvedValue({
      success: true,
      lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    mockFlagPollWithCommitGate.mockResolvedValue({
      success: true,
      lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      flagId: "flag-test-1",
    });
  });

  it("renders anchor poll with Step 1 of 3 badge and emergency surge badge", () => {
    render(
      <BivariatePollCard
        pollId="poll-anchor-1"
        questionText="Should the city fund 24/7 subway frequency?"
        category="Transit Funding"
        companionPolls={companionPolls}
        isSurge={true}
      />
    );

    expect(screen.getByText(/Transit Funding/i)).toBeInTheDocument();
    expect(screen.getByTestId("packet-step-badge")).toHaveTextContent("Step 1 of 3");
    expect(screen.getByTestId("packet-surge-badge")).toHaveTextContent("District Emergency Surge");
    expect(screen.getByText(/Should the city fund 24\/7 subway frequency\?/i)).toBeInTheDocument();
  });

  it("progresses sequentially through 3 packet measures and triggers ChapterEndCard off-ramp", async () => {
    const onPacketComplete = vi.fn();

    render(
      <BivariatePollCard
        pollId="poll-anchor-1"
        questionText="Should the city fund 24/7 subway frequency?"
        category="Transit Funding"
        companionPolls={companionPolls}
        onPacketComplete={onPacketComplete}
      />
    );

    // --- STEP 1 (Anchor Poll)
    expect(screen.getByTestId("packet-step-badge")).toHaveTextContent("Step 1 of 3");
    expect(screen.getByText(/Should the city fund 24\/7 subway frequency\?/i)).toBeInTheDocument();

    // Commit vote on Step 1
    const commitBtn1 = screen.getByRole("button", { name: /Commit & Seal Bivariate Vote/i });
    await act(async () => {
      fireEvent.click(commitBtn1);
    });

    // Verify PacketProgressBanner is displayed for Step 2
    await waitFor(() => {
      expect(screen.getByTestId("packet-progress-banner")).toBeInTheDocument();
    });
    expect(screen.getByText(/Should municipal bus lanes be expanded on Main St\?/i)).toBeInTheDocument();

    // Click Continue to advance to Step 2
    const advanceBtn1 = screen.getByRole("button", { name: /Continue/i });
    act(() => {
      fireEvent.click(advanceBtn1);
    });

    // --- STEP 2 (Companion 1)
    await waitFor(() => {
      expect(screen.getByTestId("packet-step-badge")).toHaveTextContent("Step 2 of 3");
    });
    expect(screen.getByText(/Should municipal bus lanes be expanded on Main St\?/i)).toBeInTheDocument();

    // Commit vote on Step 2
    const commitBtn2 = screen.getByRole("button", { name: /Commit & Seal Bivariate Vote/i });
    await act(async () => {
      fireEvent.click(commitBtn2);
    });

    // Verify PacketProgressBanner is displayed for Step 3
    await waitFor(() => {
      expect(screen.getByTestId("packet-progress-banner")).toBeInTheDocument();
    });
    expect(screen.getByText(/Should congestion fees apply to commercial delivery vans\?/i)).toBeInTheDocument();

    // Click Continue to advance to Step 3
    const advanceBtn2 = screen.getByRole("button", { name: /Continue/i });
    act(() => {
      fireEvent.click(advanceBtn2);
    });

    // --- STEP 3 (Companion 2 - Final Measure)
    await waitFor(() => {
      expect(screen.getByTestId("packet-step-badge")).toHaveTextContent("Step 3 of 3");
    });
    expect(screen.getByText(/Should congestion fees apply to commercial delivery vans\?/i)).toBeInTheDocument();

    // Commit vote on Step 3
    const commitBtn3 = screen.getByRole("button", { name: /Commit & Seal Bivariate Vote/i });
    await act(async () => {
      fireEvent.click(commitBtn3);
    });

    // Verify ChapterEndCard is mounted and onPacketComplete callback is triggered
    await waitFor(() => {
      expect(screen.getByTestId("chapter-end-card")).toBeInTheDocument();
    });

    expect(onPacketComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/District Deliberation Complete/i)).toBeInTheDocument();
    expect(
      screen.getByText(/You have weighed in on all active measures in this district today\. Your voice is sealed\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Civic Packet Complete • 3 Measures Sealed/i)).toBeInTheDocument();

    // Verify "Review Packet" button resets session to Step 1
    const reviewBtn = screen.getByRole("button", { name: /Review Packet/i });
    act(() => {
      fireEvent.click(reviewBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("packet-step-badge")).toHaveTextContent("Step 1 of 3");
      expect(screen.getByText(/Should the city fund 24\/7 subway frequency\?/i)).toBeInTheDocument();
    });
  });

  it("completes packet when challenging premise on the final companion measure", async () => {
    const onPacketComplete = vi.fn();

    render(
      <BivariatePollCard
        pollId="poll-anchor-1"
        questionText="Anchor Measure"
        companionPolls={[companionPolls[0]]} // 2 total measures
        onPacketComplete={onPacketComplete}
      />
    );

    // Vote on step 1
    const commitBtn = screen.getByRole("button", { name: /Commit & Seal Bivariate Vote/i });
    await act(async () => {
      fireEvent.click(commitBtn);
    });

    // Advance to step 2
    const advanceBtn = await screen.findByRole("button", { name: /Continue/i });
    act(() => {
      fireEvent.click(advanceBtn);
    });

    // Open challenge drawer on step 2
    const challengeBtn = await screen.findByRole("button", { name: /Challenge Premise/i });
    act(() => {
      fireEvent.click(challengeBtn);
    });

    // Select diagnostic reason pill
    const reasonPill = screen.getByRole("radio", { name: /Loaded Framing/i });
    act(() => {
      fireEvent.click(reasonPill);
    });

    // Submit challenge
    const confirmChallengeBtn = screen.getByRole("button", { name: /Record Premise Challenge/i });
    await act(async () => {
      fireEvent.click(confirmChallengeBtn);
    });

    // Verify chapter end card is mounted
    await waitFor(() => {
      expect(screen.getByTestId("chapter-end-card")).toBeInTheDocument();
    });
    expect(onPacketComplete).toHaveBeenCalledTimes(1);
  });
});
