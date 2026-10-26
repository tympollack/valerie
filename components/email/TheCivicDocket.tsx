/**
 * Project Valerie: The Civic Docket / Weekly Ledger React Email Template
 * File: components/email/TheCivicDocket.tsx
 * Work Item: [TASK-VAL-CRON-DISPATCH] / [STORY-VAL-EMAIL-NOTIF-INFRA]
 *
 * Renders high-fidelity, accessible, inline-styled email digests for The Votary.
 * Supported categories:
 *   - 60% Persona Match (Worldview resonance)
 *   - 30% Civic Anchor (Local & structural salience)
 *   - 10% Blindspot Bridge (Cross-spectrum deliberation)
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

export interface DocketItem {
  poll_id: string;
  question_text: string;
  category: "PERSONA_MATCH" | "CIVIC_ANCHOR" | "BLINDSPOT_BRIDGE" | string;
  category_ratio?: string;
  scope_tier?: string;
  deepLink: string;
}

export interface TheCivicDocketProps {
  recipientName?: string;
  items: DocketItem[];
  unsubscribeUrl: string;
  preferencesUrl?: string;
  generatedDate?: string;
}

const CATEGORY_META: Record<
  string,
  { label: string; bg: string; text: string; border: string; desc: string }
> = {
  PERSONA_MATCH: {
    label: "Persona Match (60%)",
    bg: "#1e1b4b",
    text: "#818cf8",
    border: "#312e81",
    desc: "Calibrated to your latent civic worldview",
  },
  CIVIC_ANCHOR: {
    label: "Civic Anchor (30%)",
    bg: "#064e3b",
    text: "#34d399",
    border: "#065f46",
    desc: "Direct local, state, or structural jurisdiction",
  },
  BLINDSPOT_BRIDGE: {
    label: "Blindspot Bridge (10%)",
    bg: "#451a03",
    text: "#fb923c",
    border: "#78350f",
    desc: "Divergent ideological cluster with active deliberation",
  },
};

export const TheCivicDocket: React.FC<TheCivicDocketProps> = ({
  recipientName,
  items,
  unsubscribeUrl,
  preferencesUrl,
  generatedDate,
}) => {
  const displayDate =
    generatedDate ||
    new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <div
      style={{
        backgroundColor: "#09090b",
        color: "#f4f4f5",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        margin: 0,
        padding: "32px 16px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "600px",
          margin: "0 auto",
          backgroundColor: "#121215",
          border: "1px solid #27272a",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "28px 24px 20px",
            borderBottom: "1px solid #27272a",
            backgroundColor: "#18181b",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              color: "#a1a1aa",
              textTransform: "uppercase",
              marginBottom: "6px",
            }}
          >
            The Votary &bull; Civic Notification Pipeline
          </div>
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 800,
              color: "#fafafa",
              margin: "0 0 4px",
              letterSpacing: "-0.02em",
            }}
          >
            The Civic Docket
          </h1>
          <div
            style={{
              fontSize: "12px",
              color: "#71717a",
            }}
          >
            Dispatched for {displayDate}
            {recipientName ? ` &bull; Prepared for ${recipientName}` : ""}
          </div>
        </div>

        {/* Introduction */}
        <div style={{ padding: "20px 24px 8px" }}>
          <p
            style={{
              fontSize: "14px",
              lineHeight: "1.5",
              color: "#d4d4d8",
              margin: 0,
            }}
          >
            Here are your active deliberation items curated under the 60/30/10 protocol.
            Click any decision below for instant 1-click verified voting.
          </p>
        </div>

        {/* Poll Items */}
        <div style={{ padding: "12px 24px" }}>
          {items.length === 0 ? (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                backgroundColor: "#18181b",
                borderRadius: "6px",
                border: "1px dashed #3f3f46",
                color: "#a1a1aa",
                fontSize: "13px",
              }}
            >
              No active polls pending deliberation for your current cohort.
            </div>
          ) : (
            items.map((item, idx) => {
              const meta = CATEGORY_META[item.category] || {
                label: item.category,
                bg: "#27272a",
                text: "#e4e4e7",
                border: "#3f3f46",
                desc: "",
              };

              return (
                <div
                  key={item.poll_id || idx}
                  style={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "6px",
                    padding: "18px 20px",
                    marginBottom: "16px",
                  }}
                >
                  {/* Category Pill */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "10px",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        backgroundColor: meta.bg,
                        color: meta.text,
                        border: `1px solid ${meta.border}`,
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: "4px",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {item.category_ratio ? `${item.category_ratio} ` : ""}
                      {meta.label}
                    </span>
                    {item.scope_tier && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 500,
                          color: "#71717a",
                          textTransform: "uppercase",
                        }}
                      >
                        &bull; {item.scope_tier}
                      </span>
                    )}
                  </div>

                  {/* Question */}
                  <h3
                    style={{
                      fontSize: "16px",
                      fontWeight: 600,
                      lineHeight: "1.4",
                      color: "#f4f4f5",
                      margin: "0 0 14px",
                    }}
                  >
                    {item.question_text}
                  </h3>

                  {/* Deep-link Action Button */}
                  <div>
                    <a
                      href={item.deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        backgroundColor: "#dc2626",
                        color: "#ffffff",
                        fontSize: "13px",
                        fontWeight: 600,
                        padding: "8px 16px",
                        borderRadius: "4px",
                        textDecoration: "none",
                        letterSpacing: "0.02em",
                      }}
                    >
                      Cast Deliberation &rarr;
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer & Unsubscribe */}
        <div
          style={{
            padding: "20px 24px",
            borderTop: "1px solid #27272a",
            backgroundColor: "#0d0d10",
            fontSize: "12px",
            lineHeight: "1.5",
            color: "#71717a",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            The Votary &bull; Autonomous Civic Deliberation across SunShade Systems
          </div>
          <div>
            You are receiving this digest based on your cadence preferences.{" "}
            {preferencesUrl && (
              <>
                <a
                  href={preferencesUrl}
                  style={{ color: "#a1a1aa", textDecoration: "underline" }}
                >
                  Manage Cadence
                </a>
                {" | "}
              </>
            )}
            <a
              href={unsubscribeUrl}
              style={{ color: "#a1a1aa", textDecoration: "underline" }}
            >
              1-Click Unsubscribe
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Compiles TheCivicDocket component into full static HTML suitable for Resend delivery.
 */
export function renderCivicDocketHtml(props: TheCivicDocketProps): string {
  const doctype = "<!DOCTYPE html>";
  const htmlMarkup = renderToStaticMarkup(<TheCivicDocket {...props} />);
  return `${doctype}\n${htmlMarkup}`;
}

export const WeeklyLedgerEmail = TheCivicDocket;
export const renderWeeklyLedgerEmailHtml = renderCivicDocketHtml;
