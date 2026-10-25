import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminSettingsView } from "@/components/valerie/AdminSettingsView";
import * as settingsActions from "@/app/actions/valerieSettingsActions";
import { UserContext } from "@/app/actions/auth";

vi.mock("@/app/actions/valerieSettingsActions", () => ({
  updateSystemSetting: vi.fn(),
}));

describe("AdminSettingsView Component", () => {
  const mockSettings: settingsActions.SystemSettingItem[] = [
    {
      key: "voting_lock_hours",
      value: 24,
      description: "Commit-and-reveal lock window in hours",
      category: "VOTING",
      is_secret: false,
      updated_at: "2026-10-24T12:00:00Z",
    },
    {
      key: "advocate_hard_cap_hours",
      value: 20,
      description: "Advocate weekly hard ceiling in hours",
      category: "LABOR",
      is_secret: false,
      updated_at: "2026-10-24T12:00:00Z",
    },
    {
      key: "decree_supermajority_threshold",
      value: 0.70,
      description: "Supermajority threshold",
      category: "DECREE",
      is_secret: false,
      updated_at: "2026-10-24T12:00:00Z",
    },
  ];

  const adminUser: UserContext = {
    authenticated: true,
    userId: "admin-1",
    email: "admin@sunshade.icu",
    displayName: "Admin",
    isHumanVerified: true,
    verificationTier: "TIER_3_SOVEREIGN",
    trustState: "active",
  };

  const regularUser: UserContext = {
    authenticated: true,
    userId: "voter-1",
    email: "voter@sunshade.icu",
    displayName: "Voter",
    isHumanVerified: true,
    verificationTier: "TIER_1_REGISTERED",
    trustState: "active",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders category sections and setting cards", () => {
    render(<AdminSettingsView initialSettings={mockSettings} userContext={adminUser} />);

    expect(screen.getByTestId("settings-category-voting")).toBeInTheDocument();
    expect(screen.getByTestId("settings-category-labor")).toBeInTheDocument();
    expect(screen.getByTestId("settings-category-decree")).toBeInTheDocument();

    expect(screen.getByText("voting_lock_hours")).toBeInTheDocument();
    expect(screen.getByText("advocate_hard_cap_hours")).toBeInTheDocument();
    expect(screen.getByText("decree_supermajority_threshold")).toBeInTheDocument();
  });

  it("shows read-only banner and disables inputs when user lacks sovereign tier", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(<AdminSettingsView initialSettings={mockSettings} userContext={regularUser} />);

    expect(screen.getByTestId("admin-guard-warning")).toBeInTheDocument();
    const input = screen.getByLabelText(/Setting voting_lock_hours/i);
    expect(input).toBeDisabled();
  });

  it("allows editing values, shows Unsaved badge and Save button, and saves change", async () => {
    vi.mocked(settingsActions.updateSystemSetting).mockResolvedValueOnce({
      success: true,
      data: {
        key: "voting_lock_hours",
        value: 48,
        description: "Commit-and-reveal lock window in hours",
        category: "VOTING",
        is_secret: false,
        updated_at: new Date().toISOString(),
      },
    });

    render(<AdminSettingsView initialSettings={mockSettings} userContext={adminUser} />);

    const input = screen.getByLabelText(/Setting voting_lock_hours/i);
    fireEvent.change(input, { target: { value: "48" } });

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    const saveBtn = screen.getByLabelText(/Save voting_lock_hours/i);
    expect(saveBtn).toBeInTheDocument();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(settingsActions.updateSystemSetting).toHaveBeenCalledWith("voting_lock_hours", 48);
      expect(screen.getByTestId("settings-status-banner")).toHaveTextContent(/successfully saved/i);
    });
  });

  it("allows resetting edited values back to initial", () => {
    render(<AdminSettingsView initialSettings={mockSettings} userContext={adminUser} />);

    const input = screen.getByLabelText(/Setting voting_lock_hours/i);
    fireEvent.change(input, { target: { value: "72" } });

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    const resetBtn = screen.getByLabelText(/Reset voting_lock_hours/i);
    fireEvent.click(resetBtn);

    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("disables save button when a numeric input is cleared", () => {
    render(<AdminSettingsView initialSettings={mockSettings} userContext={adminUser} />);

    const input = screen.getByLabelText(/Setting voting_lock_hours/i);
    fireEvent.change(input, { target: { value: "" } });

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    const saveBtn = screen.getByLabelText(/Save voting_lock_hours/i);
    expect(saveBtn).toBeDisabled();
  });
});
