import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { BivariatePollCard } from "./BivariatePollCard";

const mockCastVote = vi.fn();
const mockSubmitVote = vi.fn();
const mockFlagPollWithCommitGate = vi.fn();

// Mock server actions
vi.mock("@/app/actions/vote", () => ({
  castVote: (...args: any[]) => mockCastVote(...args),
  submitVote: (...args: any[]) => mockSubmitVote(...args),
}));

vi.mock("@/app/actions/valerieFlagActions", () => ({
  flagPollWithCommitGate: (...args: any[]) => mockFlagPollWithCommitGate(...args),
  VALID_FLAG_REASONS: ["LOADED_FRAMING", "FALSE_DICHOTOMY", "DISPUTED_PREMISE", "LOCALE_MISMATCH"],
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
    mockFlagPollWithCommitGate.mockResolvedValue({
      success: true,
      lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      flagId: "flag-abc-123",
    });
  });

  it("renders poll category, interactive question, bivariate controls, and Challenge button", () => {
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
    expect(screen.getByText(/Challenge Premise \/ Framing/i)).toBeInTheDocument();
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

  it("toggles PremiseChallengeDrawer and renders 4 diagnostic pills", async () => {
    render(
      <BivariatePollCard
        pollId="poll-flag-test"
        questionText="Controversial Civic Proposal"
      />
    );

    // Drawer should initially not be visible
    expect(screen.queryByText(/Loaded Framing/i)).not.toBeInTheDocument();

    // Click Challenge Premise / Framing button
    const challengeBtn = screen.getByText(/Challenge Premise \/ Framing/i);
    fireEvent.click(challengeBtn);

    // 4 diagnostic pills should now be visible
    expect(screen.getByText(/Loaded Framing/i)).toBeInTheDocument();
    expect(screen.getByText(/Loaded or emotionally manipulative wording/i)).toBeInTheDocument();

    expect(screen.getByText(/False Dichotomy/i)).toBeInTheDocument();
    expect(screen.getByText(/Forces a binary choice \/ misses a key perspective/i)).toBeInTheDocument();

    expect(screen.getByText(/Disputed Premise/i)).toBeInTheDocument();
    expect(screen.getByText(/Underlying factual premise is disputed/i)).toBeInTheDocument();

    expect(screen.getByText(/Locale Mismatch/i)).toBeInTheDocument();
    expect(screen.getByText(/Not applicable to this geographic scope/i)).toBeInTheDocument();
  });

  it("reveals missing perspective textarea when FALSE_DICHOTOMY is selected", async () => {
    render(
      <BivariatePollCard
        pollId="poll-flag-test"
        questionText="Controversial Civic Proposal"
      />
    );

    // Open drawer
    fireEvent.click(screen.getByText(/Challenge Premise \/ Framing/i));

    // Textarea should not be visible before selecting FALSE_DICHOTOMY
    expect(screen.queryByLabelText(/What perspective or axis is missing\?/i)).not.toBeInTheDocument();

    // Click False Dichotomy pill
    fireEvent.click(screen.getByText(/False Dichotomy/i));

    // Textarea must now be visible with 240 char limit
    const axisInput = screen.getByLabelText(/What perspective or axis is missing\?/i);
    expect(axisInput).toBeInTheDocument();
    expect(axisInput).toHaveAttribute("maxLength", "240");
  });

  it("submits premise challenge via flagPollWithCommitGate and transitions directly to RevealGate with badge", async () => {
    const onFlagSuccess = vi.fn();

    render(
      <BivariatePollCard
        pollId="poll-flag-123"
        questionText="Civic Proposition"
        onFlagSuccess={onFlagSuccess}
      />
    );

    // Open challenge drawer
    fireEvent.click(screen.getByText(/Challenge Premise \/ Framing/i));

    // Select False Dichotomy
    fireEvent.click(screen.getByText(/False Dichotomy/i));

    // Fill missing perspective
    const axisInput = screen.getByLabelText(/What perspective or axis is missing\?/i);
    fireEvent.change(axisInput, { target: { value: "A hybrid zoning approach is needed" } });

    // Submit challenge
    const recordBtn = screen.getByText(/Record Premise Challenge/i);
    await act(async () => {
      fireEvent.click(recordBtn);
    });

    // Verify flagPollWithCommitGate was called with structured arguments
    expect(mockFlagPollWithCommitGate).toHaveBeenCalledWith(
      expect.objectContaining({
        pollId: "poll-flag-123",
        flagReason: "FALSE_DICHOTOMY",
        suggestedAxisComment: "A hybrid zoning approach is needed",
      })
    );

    // Transitions card smoothly into RevealGate locked state with required badge
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Premise Challenge Recorded/i })).toBeInTheDocument();
      expect(
        screen.getByText(/Premise Challenge Recorded — Community Results & Flag Telemetry Unlock in 24h/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/A hybrid zoning approach is needed/i)).toBeInTheDocument();
      expect(screen.getByText(/Full Community Bivariate Matrix Unlocks In:/i)).toBeInTheDocument();
    });

    expect(onFlagSuccess).toHaveBeenCalledWith({
      flagReason: "FALSE_DICHOTOMY",
      suggestedAxisComment: "A hybrid zoning approach is needed",
    });
  });

  it("renders dynamic Civic Stance Archetype pill and updates to Bedrock Conviction when Likert is +2 and Confidence is 85%", async () => {
    render(
      <BivariatePollCard
        pollId="test-poll-stance"
        questionText="Civic Stance Test"
      />
    );

    // Initial state: likert = 0, confidence = 75% -> Deliberate Equilibrium
    const stancePill = screen.getByTestId("stance-archetype-pill");
    expect(stancePill).toHaveTextContent("Deliberate Equilibrium");

    // Move Likert to Strongly Agree (+2)
    const stronglyAgreeBtn = screen.getByRole("radio", { name: "Strongly Agree" });
    fireEvent.click(stronglyAgreeBtn);

    // Move Confidence to 85%
    const slider = screen.getByLabelText(/Confidence gauge slider/i);
    act(() => {
      fireEvent.change(slider, { target: { value: "85" } });
    });

    // Acceptance criterion: dynamically displays 'Bedrock Conviction'
    expect(screen.getByTestId("stance-archetype-pill")).toHaveTextContent("Bedrock Conviction");

    // Contextual weight profile readout
    expect(screen.getByTestId("stance-relative-weight")).toHaveTextContent("Primary Personal Anchor");
  });

  it("dynamically displays Principled Dissent and Grounded Skepticism across confidence changes for negative likert", async () => {
    render(
      <BivariatePollCard
        pollId="test-poll-dissent"
        questionText="Dissent Stance Test"
      />
    );

    // Click Disagree (-1)
    const disagreeBtn = screen.getByRole("radio", { name: "Disagree" });
    fireEvent.click(disagreeBtn);

    // Confidence 75% -> High confidence negative -> Principled Dissent
    expect(screen.getByTestId("stance-archetype-pill")).toHaveTextContent("Principled Dissent");

    // Change confidence to 50% -> Mid confidence negative -> Grounded Skepticism
    const slider = screen.getByLabelText(/Confidence gauge slider/i);
    act(() => {
      fireEvent.change(slider, { target: { value: "50" } });
    });

    expect(screen.getByTestId("stance-archetype-pill")).toHaveTextContent("Grounded Skepticism");
    expect(screen.getByTestId("stance-relative-weight")).toHaveTextContent("Standard Civic Stance");
  });
});
