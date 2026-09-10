import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { BivariatePollCard } from "./BivariatePollCard";

const mockCastVote = vi.fn();
const mockSubmitVote = vi.fn();

// Mock submitVote and castVote server actions
vi.mock("@/app/actions/vote", () => ({
  castVote: (...args: any[]) => mockCastVote(...args),
  submitVote: (...args: any[]) => mockSubmitVote(...args),
}));

describe("BivariatePollCard Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCastVote.mockResolvedValue({
      success: true,
      lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    mockSubmitVote.mockResolvedValue({
      success: true,
      lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  it("renders poll category, interactive question, and bivariate controls", () => {
    render(
      <BivariatePollCard
        pollId="test-poll-1"
        questionText="Should the city implement [[congestion pricing]]?"
        category="Urban Transportation"
      />
    );

    expect(screen.getByText(/Urban Transportation/i)).toBeInTheDocument();
    expect(screen.getByText(/congestion pricing/i)).toBeInTheDocument();
    expect(screen.getByText(/1\. Sentiment Direction/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Certainty & Importance/i)).toBeInTheDocument();
    expect(screen.getByText(/Commit & Seal Bivariate Vote/i)).toBeInTheDocument();
  });

  it("completely omits community vote results from DOM prior to submission", () => {
    render(
      <BivariatePollCard
        pollId="test-poll-1"
        questionText="Should the downtown transit core be pedestrianized?"
      />
    );

    // Verify community aggregate distribution and matrix are absent from the DOM
    expect(screen.queryByText(/Aggregated Bivariate Distribution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Marginal Sentiment Distribution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2D Sentiment × Conviction Density Matrix/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Blind Voting/i)).toBeInTheDocument();
  });

  it("updates Likert scale selection when clicking step buttons", () => {
    render(
      <BivariatePollCard
        pollId="test-poll-1"
        questionText="Test Question"
      />
    );

    // Find and click Strongly Agree (+2) button
    const stronglyAgreeBtn = screen.getByRole("radio", { name: "Strongly Agree" });
    fireEvent.click(stronglyAgreeBtn);

    expect(stronglyAgreeBtn).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/\+2 : SA/i)).toBeInTheDocument();
  });

  it("updates confidence slider value and tier descriptor", () => {
    render(
      <BivariatePollCard
        pollId="test-poll-1"
        questionText="Test Question"
      />
    );

    const slider = screen.getByLabelText(/Confidence gauge slider/i);
    act(() => {
      fireEvent.change(slider, { target: { value: "90" } });
    });

    expect(screen.getAllByText(/90%/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Absolute Conviction/i).length).toBeGreaterThanOrEqual(1);
  });

  it("dispatches vote through Server Action castVote and renders locked countdown", async () => {
    const onVoteSuccess = vi.fn();

    render(
      <BivariatePollCard
        pollId="poll-abc-123"
        questionText="Test Civic Question"
        onVoteSuccess={onVoteSuccess}
      />
    );

    // Select Agree (+1)
    const agreeBtn = screen.getByRole("radio", { name: "Agree" });
    fireEvent.click(agreeBtn);

    // Set Confidence to 80%
    const slider = screen.getByLabelText(/Confidence gauge slider/i);
    fireEvent.change(slider, { target: { value: "80" } });

    // Submit vote
    const submitBtn = screen.getByText(/Commit & Seal Bivariate Vote/i);
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify castVote was invoked with correct arguments
    expect(mockCastVote).toHaveBeenCalledWith(
      expect.objectContaining({
        pollId: "poll-abc-123",
        likertScore: 1,
        confidenceScore: 80,
      })
    );

    // Post-submission, render locked countdown timer
    await waitFor(() => {
      expect(screen.getByText(/Bivariate Vote Sealed/i)).toBeInTheDocument();
      expect(screen.getByText(/Full Community Bivariate Matrix Unlocks In:/i)).toBeInTheDocument();
    });

    expect(onVoteSuccess).toHaveBeenCalled();
  });

  it("does not bypass commit gate on failed vote submission and displays error", async () => {
    mockCastVote.mockResolvedValueOnce({
      success: false,
      error: "You must be signed in to vote.",
    });

    render(
      <BivariatePollCard
        pollId="poll-failed-test"
        questionText="Protected Gate Question"
      />
    );

    const submitBtn = screen.getByText(/Commit & Seal Bivariate Vote/i);
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Error must be displayed and locked countdown/reveal must NOT be shown
    expect(screen.getByText(/You must be signed in to vote/i)).toBeInTheDocument();
    expect(screen.queryByText(/Bivariate Vote Sealed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Commit & Seal Bivariate Vote/i)).toBeInTheDocument();
  });
});
