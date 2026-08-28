import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RevealGate } from "./RevealGate";

describe("RevealGate Component", () => {
  it("renders blind voting commitment banner before submission without revealing community data", () => {
    render(<RevealGate isSubmitted={false} />);

    expect(screen.getByText(/Commit-and-Reveal Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Blind Voting/i)).toBeInTheDocument();
    expect(screen.getByText(/Global vote tallies are sealed to eliminate/i)).toBeInTheDocument();

    // Ensure results and matrices are completely hidden before voting
    expect(screen.queryByText(/Aggregated Bivariate Distribution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Marginal Sentiment Distribution/i)).not.toBeInTheDocument();
  });

  it("renders locked countdown timer after submission", () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    render(
      <RevealGate
        isSubmitted={true}
        lockedUntil={futureDate}
        userVote={{ likertScore: 2, confidenceScore: 85 }}
      />
    );

    expect(screen.getByText(/Bivariate Vote Sealed/i)).toBeInTheDocument();
    expect(screen.getByText(/Strongly Agree/i)).toBeInTheDocument();
    expect(screen.getByText(/85%/i)).toBeInTheDocument();
    expect(screen.getByText(/Full Community Bivariate Matrix Unlocks In:/i)).toBeInTheDocument();
    expect(screen.getByText(/Simulate 24h Unlock/i)).toBeInTheDocument();
  });

  it("reveals bivariate distribution heatmap matrix when unlocked", async () => {
    render(
      <RevealGate
        isSubmitted={true}
        userVote={{ likertScore: 1, confidenceScore: 70 }}
      />
    );

    // Click simulate unlock
    const unlockBtn = screen.getByText(/Simulate 24h Unlock/i);
    fireEvent.click(unlockBtn);

    // Should transition to revealed state
    expect(await screen.findByText(/Aggregated Bivariate Distribution/i)).toBeInTheDocument();
    expect(screen.getByText(/2D Sentiment × Conviction Density Matrix/i)).toBeInTheDocument();
    expect(screen.getByText(/Marginal Sentiment Distribution/i)).toBeInTheDocument();
    expect(screen.getByText(/Consensus Index:/i)).toBeInTheDocument();
  });
});
