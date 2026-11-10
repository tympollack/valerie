/**
 * Project Valerie: Sovereign Citizen Decree Dossier PDF Export Route
 * File: app/api/decree/[id]/pdf/route.ts
 * Work Item: [TASK-VAL-ZONING-RECORD] / [STORY-VAL-LANDOWNER-DECREE]
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { compileDecreeDossierData } from "@/lib/services/decreeDossierService";
import { generateDecreePdf } from "@/lib/services/decreePdfGenerator";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Decree ID parameter is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const dossierData = await compileDecreeDossierData(supabase, id);

    if (!dossierData) {
      return NextResponse.json({ error: `Decree '${id}' not found` }, { status: 404 });
    }

    const pdfBytes = generateDecreePdf(dossierData);

    return new Response(pdfBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="sovereign-decree-${id}.pdf"`,
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Tamper-Evidence-Merkle-Root": dossierData.merkleRootHash,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
