/**
 * Project Valerie: Scheduled Sovereign Decree Compilation Route Handler (Vercel Cron Worker)
 * File: app/api/cron/decree/route.ts
 * Work Item: [TASK-VAL-DECREE-COMPILER-RUNNER] / [STORY-VAL-DECREE-INACTION]
 *
 * Scans unlocked active deliberation polls on an hourly schedule to seal cross-spectrum
 * supermajorities (>=70%) into cryptographically immutable sovereign decrees.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processDecreeCompiler } from "@/lib/valerie/decreeCompilerRunner";

export async function POST(request: NextRequest) {
  // 1. Guard route with CRON_SECRET authorization header
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing CRON_SECRET." },
      { status: 401 }
    );
  }

  // 2. Verify platform secrets
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase service role configuration." },
      { status: 500 }
    );
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
    const targetPollId = request.nextUrl.searchParams.get("pollId") || undefined;

    const result = await processDecreeCompiler(adminClient, {
      dryRun,
      targetPollId,
    });

    if (result.status === "paused_by_admin") {
      return NextResponse.json({
        success: true,
        status: "paused_by_admin",
        message: "Decree compilation is currently paused by administrator setting (decree.cron_enabled).",
        data: result,
      });
    }

    if (result.status === "error") {
      return NextResponse.json(
        { error: result.error || "Decree compilation failed." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Decree cron dispatcher execution failed: ${msg}` },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
