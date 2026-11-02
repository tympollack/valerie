/**
 * Project Valerie: The Votary Weekly Civic Ledger Email Template
 * File: emails/WeeklyLedgerEmail.tsx
 * Work Item: [TASK-VAL-REACT-EMAIL-SUITE]
 *
 * Renders production React Email digests for The Votary dark cyan design system.
 * Built using @react-email/components for cross-client compatibility
 * (Apple Mail, Gmail Desktop/Mobile, Outlook).
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

export interface DocketItem {
  poll_id: string;
  question_text: string;
  category: "PERSONA_MATCH" | "CIVIC_ANCHOR" | "BLINDSPOT_BRIDGE" | string;
  category_ratio?: string;
  scope_tier?: string;
  deepLink: string;
}

export interface WeeklyLedgerEmailProps {
  recipientName?: string;
  items?: DocketItem[];
  unsubscribeUrl: string;
  preferencesUrl?: string;
  generatedDate?: string;
  previewText?: string;
}

const CATEGORY_STYLES: Record<
  string,
  { label: string; ratio: string; bg: string; text: string; border: string; desc: string }
> = {
  PERSONA_MATCH: {
    label: "Persona Match",
    ratio: "60%",
    bg: "#083344", // dark cyan-950
    text: "#22d3ee", // cyan-400
    border: "#0e7490", // cyan-700
    desc: "Calibrated to your latent civic worldview",
  },
  CIVIC_ANCHOR: {
    label: "Civic Anchor",
    ratio: "30%",
    bg: "#064e3b", // emerald-950
    text: "#34d399", // emerald-400
    border: "#047857", // emerald-700
    desc: "Direct local, state, or structural jurisdiction",
  },
  BLINDSPOT_BRIDGE: {
    label: "Blindspot Bridge",
    ratio: "10%",
    bg: "#451a03", // amber-950
    text: "#fb923c", // amber-400
    border: "#b45309", // amber-700
    desc: "Divergent ideological cluster with active deliberation",
  },
};

export const WeeklyLedgerEmail: React.FC<WeeklyLedgerEmailProps> = ({
  recipientName,
  items = [],
  unsubscribeUrl,
  preferencesUrl,
  generatedDate,
  previewText,
}) => {
  const displayDate =
    generatedDate ||
    new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const preview =
    previewText ||
    `The Votary Civic Ledger for ${displayDate} · ${items.length} deliberations awaiting your voice`;

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
              backgroundColor: "#082f49", // sky-950 / deep cyan
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
              THE VOTARY // CIVIC LEDGER
            </Text>
            <Heading
              as="h1"
              style={{
                margin: "0 0 4px 0",
                fontSize: "24px",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-0.02em",
              }}
            >
              The Civic Docket
            </Heading>
            <Text
              style={{
                margin: 0,
                fontSize: "12px",
                color: "#94a3b8",
              }}
            >
              {`Dispatched for ${displayDate}${recipientName ? ` · Prepared for ${recipientName}` : ""}`}
            </Text>
          </Section>

          {/* Subheader Intro */}
          <Section style={{ padding: "20px 24px 8px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "14px",
                lineHeight: "1.6",
                color: "#cbd5e1",
              }}
            >
              Here are your active deliberation items curated under the 60/30/10 protocol.
              Click any decision below for instant 1-click verified voting with 24-hour commit
              privacy.
            </Text>
          </Section>

          {/* Deliberation Cards */}
          <Section style={{ padding: "12px 24px" }}>
            {items.length === 0 ? (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  backgroundColor: "#0b1220",
                  borderRadius: "8px",
                  border: "1px dashed #1e293b",
                  color: "#94a3b8",
                  fontSize: "13px",
                }}
              >
                No active deliberations pending for your current cohort.
              </div>
            ) : (
              items.map((item, idx) => {
                const meta = CATEGORY_STYLES[item.category] || {
                  label: item.category,
                  ratio: item.category_ratio || "",
                  bg: "#0f172a",
                  text: "#94a3b8",
                  border: "#334155",
                  desc: "",
                };
                const ratioDisplay = item.category_ratio || meta.ratio;

                return (
                  <div
                    key={item.poll_id || idx}
                    style={{
                      backgroundColor: "#0b1220",
                      border: "1px solid #1e293b",
                      borderRadius: "8px",
                      padding: "20px",
                      marginBottom: "16px",
                    }}
                  >
                    {/* Badge Row */}
                    <div style={{ marginBottom: "12px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          backgroundColor: meta.bg,
                          color: meta.text,
                          border: `1px solid ${meta.border}`,
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "3px 8px",
                          borderRadius: "4px",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {ratioDisplay ? `${ratioDisplay} ` : ""}
                        {meta.label}
                      </span>
                      {item.scope_tier && (
                        <span
                          style={{
                            marginLeft: "8px",
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#64748b",
                            textTransform: "uppercase",
                          }}
                        >
                          · {item.scope_tier}
                        </span>
                      )}
                    </div>

                    {/* Question Title */}
                    <Heading
                      as="h3"
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: "16px",
                        fontWeight: 600,
                        lineHeight: "1.4",
                        color: "#f8fafc",
                      }}
                    >
                      {item.question_text}
                    </Heading>

                    {/* CTA Button */}
                    <div>
                      <Button
                        href={item.deepLink}
                        style={{
                          display: "inline-block",
                          backgroundColor: "#06b6d4", // cyan-500
                          color: "#020617",
                          fontSize: "13px",
                          fontWeight: 700,
                          padding: "10px 20px",
                          borderRadius: "6px",
                          textDecoration: "none",
                          letterSpacing: "0.02em",
                        }}
                      >
                        Cast Deliberation &rarr;
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
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
              You are receiving this digest based on your cadence preferences.{" "}
              {preferencesUrl && (
                <>
                  <Link
                    href={preferencesUrl}
                    style={{ color: "#22d3ee", textDecoration: "underline" }}
                  >
                    Manage Cadence
                  </Link>
                  {" | "}
                </>
              )}
              <Link
                href={unsubscribeUrl}
                style={{ color: "#22d3ee", textDecoration: "underline" }}
              >
                1-Click Unsubscribe
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
export async function renderWeeklyLedgerEmail(props: WeeklyLedgerEmailProps): Promise<string> {
  return await render(<WeeklyLedgerEmail {...props} />);
}

export default WeeklyLedgerEmail;
