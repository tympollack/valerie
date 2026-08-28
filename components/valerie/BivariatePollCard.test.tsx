import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BivariatePollCard } from "./BivariatePollCard";

// Mock submitVote server action
vi.mock("@/app/actions/vote", () => ({
  submitVote: vi.fn().mockResolvedValue({
    success: true,
    lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }),
}));

describe("BivariatePollCard Component", () => {
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
});
