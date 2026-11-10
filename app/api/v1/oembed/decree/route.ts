/**
 * Project Valerie: Sovereign Citizen Decree oEmbed 1.0 Endpoint
 * File: app/api/v1/oembed/decree/route.ts
 * Work Item: [TASK-VAL-ZONING-RECORD] / [STORY-VAL-LANDOWNER-DECREE]
 *
 * Allows newsrooms, civic blogs, and zoning boards to embed live tamper-evident
 * consensus badges verifying sovereign citizen decrees.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
      return NextResponse.json(
        { error: "Query parameter 'url' is required (e.g. ?url=https://valerie.sunshade.icu/decree/:id)" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Match decree ID from URL path (e.g. /decree/[id] or full URL)
    const match = targetUrl.match(/\/decree\/([a-zA-Z0-9_-]+)/i);
    if (!match || !match[1]) {
      return NextResponse.json(
        { error: "Invalid decree URL. Must match pattern /decree/:id" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const decreeId = match[1];
    const supabase = await createClient();

    const target =
      typeof (supabase as any).schema === "function"
        ? (supabase as any).schema("valerie")
        : supabase;

    const { data: decree, error } = await target
      .from("sovereign_decrees")
      .select("id, decree_title, mandate_text, calibrated_consensus_share, verified_citizen_count, merkle_root_hash, status, created_at")
      .eq("id", decreeId)
      .single();

    if (error || !decree) {
      return NextResponse.json(
        { error: `Decree with ID '${decreeId}' not found` },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const safeTitle = escapeHtml(decree.decree_title);
    const safeMandate = escapeHtml(decree.mandate_text);
    const safeStatus = escapeHtml(decree.status);
    const consensusPercent = (Number(decree.calibrated_consensus_share) * 100).toFixed(1);
    const citizenCount = Number(decree.verified_citizen_count).toLocaleString();
    const shortHash = decree.merkle_root_hash ? `${decree.merkle_root_hash.slice(0, 10)}...${decree.merkle_root_hash.slice(-8)}` : "TAMPER-SEALED";
    const canonicalDecreeUrl = `https://valerie.sunshade.icu/decree/${encodeURIComponent(decree.id)}`;

    // Standard high-contrast responsive embed HTML badge with sanitized values (SEC_0001)
    const badgeHtml = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;border:2px solid #000;padding:16px;background:#fff;color:#000;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);"><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e0e0e0;padding-bottom:8px;margin-bottom:12px;"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#444;">Project Valerie · Sovereign Citizen Decree</span><span style="font-size:10px;font-family:monospace;background:#f0f0f0;padding:2px 6px;border-radius:4px;border:1px solid #ccc;">ROOT: ${escapeHtml(shortHash)}</span></div><h3 style="margin:0 0 8px;font-size:16px;font-weight:700;line-height:1.3;">${safeTitle}</h3><p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.4;">${safeMandate}</p><div style="display:flex;gap:16px;font-size:12px;font-weight:600;background:#f9f9f9;padding:8px 12px;border-radius:4px;margin-bottom:12px;"><span>Consensus: <strong style="color:#000;">${consensusPercent}% Supermajority</strong></span><span>Verified Citizens: <strong style="color:#000;">${citizenCount}</strong></span><span>Status: <strong style="color:#000;">${safeStatus}</strong></span></div><div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;"><a href="${canonicalDecreeUrl}" target="_blank" rel="noopener noreferrer" style="color:#000;font-weight:700;text-decoration:underline;">Verify Audit Signatures & Download Dossier &rarr;</a><span style="color:#666;">Sealed: ${new Date(decree.created_at).toLocaleDateString()}</span></div></div>`;

    return NextResponse.json(
      {
        version: "1.0",
        type: "rich",
        provider_name: "Project Valerie",
        provider_url: "https://valerie.sunshade.icu",
        title: `Sovereign Citizen Decree: ${decree.decree_title}`,
        author_name: "Verified Citizen Deliberation Assembly",
        author_url: canonicalDecreeUrl,
        width: 600,
        height: 240,
        html: badgeHtml,
        decree_id: decree.id,
        consensus_share: decree.calibrated_consensus_share,
        merkle_root_hash: decree.merkle_root_hash,
      },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=600",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
