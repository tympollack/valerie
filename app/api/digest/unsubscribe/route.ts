import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Handles database update for CAN-SPAM unsubscribe token.
 */
export async function handleUnsubscribeToken(
  token: string,
  adminClient: SupabaseClient
): Promise<{ success: boolean; status: number; message: string }> {
  const target =
    typeof (adminClient as any).schema === "function"
      ? (adminClient as any).schema("valerie").from("user_digest_preferences")
      : adminClient.from("user_digest_preferences");

  const { data, error } = await target
    .update({ email_cadence: "off" })
    .eq("unsubscribe_token", token)
    .select("user_id");

  if (error || !data || data.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Invalid or expired unsubscribe link.",
    };
  }

  return {
    success: true,
    status: 200,
    message: "You have been unsubscribed from The Votary civic digest and alert emails.",
  };
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#09090b;color:#f4f4f5;">
        <h2>Invalid Request</h2><p>Missing unsubscribe token.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#09090b;color:#f4f4f5;">
        <h2>Service Configuration Error</h2><p>Unable to process unsubscribe at this time.</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const result = await handleUnsubscribeToken(token, adminClient);

  if (!result.success) {
    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#09090b;color:#f4f4f5;">
        <h2>Unsubscribe Failed</h2><p>${result.message}</p></body></html>`,
      { status: result.status, headers: { "Content-Type": "text/html" } }
    );
  }

  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#09090b;color:#f4f4f5;text-align:center;">
      <h2 style="color:#fafafa;">Unsubscribed Successfully</h2>
      <p style="color:#a1a1aa;">${result.message}</p>
      <p style="margin-top:24px;"><a href="https://valerie.sunshade.icu/settings" style="color:#818cf8;text-decoration:none;">Manage Notification Preferences</a></p>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
