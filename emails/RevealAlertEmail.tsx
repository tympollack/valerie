/**
 * Project Valerie: Commit-Lock Expiration & Reveal Alert Email Template
 * File: emails/RevealAlertEmail.tsx
 * Work Item: [TASK-VAL-REACT-EMAIL-SUITE]
 *
 * Dispatched when a citizen's 24-hour commit-lock elapses, unlocking
 * community bivariate heatmaps, consensus trajectories, and premise challenges.
 */

import React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Link,
  Button,
  Hr,
  Preview,
} from "@react-email/components";
import { render } from "@react-email/render";
import {
  getStanceArchetypeMeta,
  type StanceArchetype,
} from "../lib/valerie/stanceNomenclature";

export interface RevealAlertEmailProps {
  pollTitle: string;
  revealUrl: string;
  unsubscribeUrl: string;
  stanceArchetype?: StanceArchetype | string;
  consensusTrajectory?: string;
  recipientName?: string;
  lockedUntil?: string;
  deliberationSummary?: string;
  metrics?: {
    totalVotes?: number;
    consensusPct?: number;
    controversyScore?: number;
  };
  previewText?: string;
}

// Design tokens for stance archetypes in email (inline HEX styles for email client compatibility)
const STANCE_EMAIL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Bedrock Conviction": { bg: "#083344", text: "#22d3ee", border: "#06b6d4" },
  "Deliberate Equilibrium": { bg: "#2e1065", text: "#c084fc", border: "#8b5cf6" },
  "Principled Dissent": { bg: "#450a0a", text: "#f87171", border: "#ef4444" },
  "Grounded Support": { bg: "#064e3b", text: "#34d399", border: "#10b981" },
  "Balanced Inquiry": { bg: "#1e1b4b", text: "#818cf8", border: "#6366f1" },
  "Grounded Skepticism": { bg: "#451a03", text: "#fb923c", border: "#f59e0b" },
  "Provisional Curiosity": { bg: "#042f2e", text: "#2dd4bf", border: "#14b8a6" },
  "Agnostic Observer": { bg: "#0f172a", text: "#94a3b8", border: "#475569" },
  "Provisional Concern": { bg: "#451a03", text: "#fcd34d", border: "#d97706" },
};

export const RevealAlertEmail: React.FC<RevealAlertEmailProps> = ({
  pollTitle,
  revealUrl,
  unsubscribeUrl,
  stanceArchetype,
  consensusTrajectory = "Deliberation Synthesized · Bivariate Distribution Ready",
  recipientName,
  lockedUntil,
  deliberationSummary,
  metrics,
  previewText,
}) => {
  const preview =
    previewText ||
    `Results Unlocked: 24h Commit-Lock has expired for "${pollTitle}"`;

  const stanceKey = (stanceArchetype || "Agnostic Observer") as StanceArchetype;
  const stanceStyle =
    STANCE_EMAIL_COLORS[stanceKey] || {
      bg: "#083344",
      text: "#22d3ee",
      border: "#0e7490",
    };

  let stanceDescription = "";
  try {
    const meta = getStanceArchetypeMeta(stanceKey);
    stanceDescription = meta.description;
  } catch {
    stanceDescription = "Civic stance recorded during commit-lock window";
  }

  const formattedLockedUntil = lockedUntil
    ? new Date(lockedUntil).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "24h Window Concluded";

  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "32px 16px",
          backgroundColor: "#020617",
          color: "#f8fafc",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <Container
          style={{
            maxWidth: "600px",
            margin: "0 auto",
            backgroundColor: "#090d16",
            border: "1px solid #164e63", // cyan-900
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          {/* Header Banner */}
          <Section
            style={{
              padding: "28px 24px 20px",
              borderBottom: "1px solid #164e63",
              backgroundColor: "#082f49", // deep cyan
            }}
          >
            {/* Monospace Kicker */}
            <Text
              style={{
                margin: "0 0 6px 0",
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.15em",
                color: "#22d3ee", // cyan-400
                textTransform: "uppercase",
              }}
            >
              COMMIT LOCK EXPIRED // RESULTS UNLOCKED
            </Text>
            <Heading
              as="h1"
              style={{
                margin: "0 0 4px 0",
                fontSize: "22px",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-0.02em",
                lineHeight: "1.3",
              }}
            >
              Deliberation Results Ready
            </Heading>
            <Text
              style={{
                margin: 0,
                fontSize: "12px",
                color: "#94a3b8",
              }}
            >
              {recipientName ? `Prepared for ${recipientName} · ` : ""}
              Commit Gate Opened: {formattedLockedUntil}
            </Text>
          </Section>

          {/* Core Content */}
          <Section style={{ padding: "24px 24px 16px" }}>
            <Text
              style={{
                margin: "0 0 8px 0",
                fontSize: "12px",
                fontWeight: 600,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Concluded Deliberation
            </Text>
            <Heading
              as="h2"
              style={{
                margin: "0 0 16px 0",
                fontSize: "18px",
                fontWeight: 700,
                lineHeight: "1.4",
                color: "#f8fafc",
              }}
            >
              {pollTitle}
            </Heading>
            <Text
              style={{
                margin: "0 0 24px 0",
                fontSize: "14px",
                lineHeight: "1.6",
                color: "#cbd5e1",
              }}
            >
              Your 24-hour blind voting window has elapsed. Early numbers no longer influence
              the deliberation. The complete community bivariate scatter, stance clustering,
              and premise-challenge breakdown are now fully revealed.
            </Text>

            {/* Stance vs Consensus Grid */}
            <div
              style={{
                backgroundColor: "#0b1220",
                border: "1px solid #1e293b",
                borderRadius: "8px",
                padding: "20px",
                marginBottom: "24px",
              }}
            >
              {/* User Registered Stance Archetype */}
              <div style={{ marginBottom: "16px" }}>
                <Text
                  style={{
                    margin: "0 0 6px 0",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                  }}
                >
                  Your Registered Stance Archetype
                </Text>
                <div style={{ display: "inline-block" }}>
                  <span
                    style={{
                      display: "inline-block",
                      backgroundColor: stanceStyle.bg,
                      color: stanceStyle.text,
                      border: `1px solid ${stanceStyle.border}`,
                      fontSize: "13px",
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: "6px",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {stanceKey}
                  </span>
                </div>
                {stanceDescription && (
                  <Text
                    style={{
                      margin: "6px 0 0 0",
                      fontSize: "12px",
                      color: "#64748b",
                      fontStyle: "italic",
                    }}
                  >
                    {stanceDescription}
                  </Text>
                )}
              </div>

              {/* Community Consensus Trajectory */}
              <div style={{ paddingTop: "12px", borderTop: "1px solid #1e293b" }}>
                <Text
                  style={{
                    margin: "0 0 6px 0",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                  }}
                >
                  Community Consensus Trajectory
                </Text>
                <Text
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#38bdf8", // light sky blue
                  }}
                >
                  {consensusTrajectory}
                </Text>
                {metrics && (
                  <div
                    style={{
                      marginTop: "10px",
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      fontSize: "12px",
                      color: "#94a3b8",
                    }}
                  >
                    {metrics.totalVotes !== undefined && (
                      <span style={{ marginRight: "12px" }}>
                        {`Votes: `}<strong>{String(metrics.totalVotes)}</strong>
                      </span>
                    )}
                    {metrics.consensusPct !== undefined && (
                      <span style={{ marginRight: "12px" }}>
                        {`Consensus: `}<strong>{`${metrics.consensusPct}%`}</strong>
                      </span>
                    )}
                    {metrics.controversyScore !== undefined && (
                      <span>
                        {`Dispersion: `}<strong>{String(metrics.controversyScore)}</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* High-Contrast CTA Button */}
            <div style={{ textAlign: "center", marginBottom: "8px" }}>
              <Button
                href={revealUrl}
                style={{
                  display: "inline-block",
                  backgroundColor: "#06b6d4", // high-contrast cyan-500
                  color: "#020617",
                  fontSize: "14px",
                  fontWeight: 800,
                  padding: "14px 28px",
                  borderRadius: "8px",
                  textDecoration: "none",
                  letterSpacing: "0.03em",
                  boxShadow: "0 4px 14px 0 rgba(6, 182, 212, 0.39)",
                }}
              >
                View Bivariate Reveal Heatmap &rarr;
              </Button>
            </div>
          </Section>

          <Hr style={{ borderColor: "#164e63", margin: "16px 0 0" }} />

          {/* Footer */}
          <Section
            style={{
              padding: "20px 24px",
              backgroundColor: "#030712",
              fontSize: "12px",
              lineHeight: "1.6",
              color: "#64748b",
            }}
          >
            <Text style={{ margin: "0 0 8px 0", color: "#64748b" }}>
              <strong>The Votary</strong> · Autonomous Civic Deliberation across SunShade Systems
            </Text>
            <Text style={{ margin: 0, color: "#64748b" }}>
              Commit-and-reveal protocol guarantees zero pre-reveal herd mentality.{" "}
              <Link
                href={unsubscribeUrl}
                style={{ color: "#22d3ee", textDecoration: "underline" }}
              >
                Unsubscribe from reveal alerts
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

/**
 * Async HTML compiler using @react-email/render.
 */
export async function renderRevealAlertEmail(props: RevealAlertEmailProps): Promise<string> {
  return await render(<RevealAlertEmail {...props} />);
}

export default RevealAlertEmail;
