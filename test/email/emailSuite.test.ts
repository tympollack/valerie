/**
 * Project Valerie: React Email Suite Tests
 * File: test/email/emailSuite.test.ts
 * Work Item: [TASK-VAL-REACT-EMAIL-SUITE]
 */

import { describe, it, expect } from "vitest";
import React from "react";
import {
  WeeklyLedgerEmail,
  renderWeeklyLedgerEmail,
  type DocketItem,
} from "../../emails/WeeklyLedgerEmail";
import {
  RevealAlertEmail,
  renderRevealAlertEmail,
} from "../../emails/RevealAlertEmail";

describe("The Votary React Email Suite (TASK-VAL-REACT-EMAIL-SUITE)", () => {
  describe("WeeklyLedgerEmail Component", () => {
    const mockItems: DocketItem[] = [
      {
        poll_id: "poll-uuid-1",
        question_text: "Should municipal fiber internet be expanded to all wards?",
        category: "PERSONA_MATCH",
        category_ratio: "60%",
        scope_tier: "LOCAL",
        deepLink: "https://votary.app/poll/poll-uuid-1?action=vote",
      },
      {
        poll_id: "poll-uuid-2",
        question_text: "Should zoning bylaws be amended for four-plex residential lots?",
        category: "CIVIC_ANCHOR",
        category_ratio: "30%",
        scope_tier: "MUNICIPAL",
        deepLink: "https://votary.app/poll/poll-uuid-2?action=vote",
      },
      {
        poll_id: "poll-uuid-3",
        question_text: "Should high-speed rail corridor funding be prioritized over highway expansion?",
        category: "BLINDSPOT_BRIDGE",
        category_ratio: "10%",
        scope_tier: "STATE",
        deepLink: "https://votary.app/poll/poll-uuid-3?action=vote",
      },
    ];

    it("renders the monospace kicker and heading", async () => {
      const html = await renderWeeklyLedgerEmail({
        recipientName: "Dr. Evelyn Reed",
        items: mockItems,
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub123",
        preferencesUrl: "https://votary.app/account/cadence",
        generatedDate: "Oct 31, 2026",
      });

      expect(html).toContain("THE VOTARY // CIVIC LEDGER");
      expect(html).toContain("The Civic Docket");
      expect(html).toContain("Prepared for Dr. Evelyn Reed");
      expect(html).toContain("Dispatched for Oct 31, 2026");
    });

    it("displays all 60/30/10 category badges and cards", async () => {
      const html = await renderWeeklyLedgerEmail({
        items: mockItems,
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub123",
      });

      // Persona Match badge
      expect(html).toContain("Persona Match");
      expect(html).toContain("60%");

      // Civic Anchor badge
      expect(html).toContain("Civic Anchor");
      expect(html).toContain("30%");

      // Blindspot Bridge badge
      expect(html).toContain("Blindspot Bridge");
      expect(html).toContain("10%");

      // Questions
      expect(html).toContain("Should municipal fiber internet be expanded to all wards?");
      expect(html).toContain("Should zoning bylaws be amended for four-plex residential lots?");
      expect(html).toContain("Should high-speed rail corridor funding be prioritized over highway expansion?");
    });

    it("renders call-to-action buttons deep-linking to voting actions", async () => {
      const html = await renderWeeklyLedgerEmail({
        items: mockItems,
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub123",
      });

      expect(html).toContain("Cast Deliberation");
      expect(html).toContain("https://votary.app/poll/poll-uuid-1?action=vote");
      expect(html).toContain("https://votary.app/poll/poll-uuid-2?action=vote");
      expect(html).toContain("https://votary.app/poll/poll-uuid-3?action=vote");
    });

    it("renders clean empty state when no items are available", async () => {
      const html = await renderWeeklyLedgerEmail({
        items: [],
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub123",
      });

      expect(html).toContain("No active deliberations pending for your current cohort");
    });

    it("renders valid HTML with doctype, meta tags, and footer links", async () => {
      const html = await renderWeeklyLedgerEmail({
        items: mockItems,
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub123",
        preferencesUrl: "https://votary.app/account/cadence",
      });

      expect(html).toMatch(/<!DOCTYPE html/i);
      expect(html).toContain("1-Click Unsubscribe");
      expect(html).toContain("Manage Cadence");
      expect(html).toContain("The Votary");
    });
  });

  describe("RevealAlertEmail Component", () => {
    it("renders the monospace commit-lock expired kicker", async () => {
      const html = await renderRevealAlertEmail({
        pollTitle: "Urban Density & Green Space Preservation",
        revealUrl: "https://votary.app/poll/poll-uuid-4?action_token=token-abc",
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe?token=unsub-xyz",
        stanceArchetype: "Bedrock Conviction",
        consensusTrajectory: "Strong Consensus (84% Support)",
        lockedUntil: "2026-10-31T14:00:00.000Z",
      });

      expect(html).toContain("COMMIT LOCK EXPIRED // RESULTS UNLOCKED");
      expect(html).toContain("Deliberation Results Ready");
      expect(html).toContain("Urban Density &amp; Green Space Preservation");
    });

    it("displays user's registered stance archetype alongside community consensus trajectory", async () => {
      const html = await renderRevealAlertEmail({
        pollTitle: "Commercial Carbon Offset Mandate",
        revealUrl: "https://votary.app/poll/carbon-offset",
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe",
        stanceArchetype: "Principled Dissent",
        consensusTrajectory: "Bimodal Distribution (Sharp Ideological Polarization)",
        metrics: {
          totalVotes: 342,
          consensusPct: 54,
          controversyScore: 82,
        },
      });

      // User's stance
      expect(html).toContain("Your Registered Stance Archetype");
      expect(html).toContain("Principled Dissent");

      // Community consensus trajectory
      expect(html).toContain("Community Consensus Trajectory");
      expect(html).toContain("Bimodal Distribution (Sharp Ideological Polarization)");

      // Deliberation metrics
      expect(html).toContain("342");
      expect(html).toContain("54%");
      expect(html).toContain("82");
    });

    it("renders high-contrast button linking directly to bivariate reveal heatmap", async () => {
      const html = await renderRevealAlertEmail({
        pollTitle: "Local Water Shed Protection Act",
        revealUrl: "https://votary.app/poll/watershed-poll?reveal=true",
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe",
        stanceArchetype: "Deliberate Equilibrium",
      });

      expect(html).toContain("View Bivariate Reveal Heatmap");
      expect(html).toContain("https://votary.app/poll/watershed-poll?reveal=true");
      expect(html).toContain("Deliberate Equilibrium");
    });

    it("renders valid XHTML markup and footer links", async () => {
      const html = await renderRevealAlertEmail({
        pollTitle: "Test Poll",
        revealUrl: "https://votary.app/poll/test",
        unsubscribeUrl: "https://votary.app/api/digest/unsubscribe",
      });

      expect(html).toMatch(/<!DOCTYPE html/i);
      expect(html).toContain("The Votary");
      expect(html).toContain("Unsubscribe from reveal alerts");
    });
  });
});
