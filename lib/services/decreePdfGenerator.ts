/**
 * Project Valerie: High-Contrast Legal-Grade PDF 1.4 Generator
 * File: lib/services/decreePdfGenerator.ts
 * Work Item: [TASK-VAL-DOSSIER-SERVICE] / [STORY-VAL-LANDOWNER-DECREE]
 */

import { SovereignDecreeDossierInput } from "../types/decreeDossier";
import { t } from "../i18n";

/**
 * Unicode-to-WinAnsi byte mapping for Windows-1252 code points 0x80-0x9F.
 * Code points 0xA0-0xFF map 1:1 to WinAnsi bytes (including § = 0xA7, ± = 0xB1).
 */
const WIN_ANSI_EXTRA_MAP: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

/**
 * Escapes characters and encodes non-ASCII WinAnsi glyphs (such as ± and §)
 * as PDF octal literal escapes so built-in Type 1 fonts render without UTF-8 mojibake.
 */
function escapePdfText(str: string): string {
  const normalized = str.replace(/[\r\n\t]+/g, " ");
  let out = "";

  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (ch === "\\" || ch === "(" || ch === ")") {
      out += `\\${ch}`;
    } else if (code >= 0x20 && code <= 0x7e) {
      out += ch;
    } else if (code >= 0xa0 && code <= 0xff) {
      out += `\\${code.toString(8).padStart(3, "0")}`;
    } else if (code in WIN_ANSI_EXTRA_MAP) {
      out += `\\${WIN_ANSI_EXTRA_MAP[code].toString(8).padStart(3, "0")}`;
    } else {
      out += "?";
    }
  }

  return out;
}

/**
 * Generates a valid PDF 1.4 document byte array in high-contrast legal format.
 * Supports multi-page flow, WinAnsi symbol encoding, and object-ordered cross-references.
 */
export function generateDecreePdf(input: SovereignDecreeDossierInput): Uint8Array {
  // Margins and Dimensions (Standard US Letter: 612 x 792 pt)
  const left = 45;
  const pageHeight = 792;
  const topMargin = 745;
  const bottomMargin = 65;

  const pagesTextStreams: string[][] = [[]];
  let currentPageIndex = 0;
  let y = topMargin;

  const checkPageBreak = (neededHeight: number) => {
    if (y - neededHeight < bottomMargin) {
      pagesTextStreams.push([]);
      currentPageIndex++;
      y = topMargin;
      // Add running header on continuation pages
      const continuationStream = pagesTextStreams[currentPageIndex];
      continuationStream.push(
        `BT /F2 8 Tf 0.2 0.2 0.2 rg 1 0 0 1 ${left} ${y} Tm (${escapePdfText(
          t("decree.pdf.pageHeader", { page: currentPageIndex + 1, decreeId: input.decreeId })
        )}) Tj ET`
      );
      y -= 18;
      continuationStream.push(`0.5 RG 0.5 w ${left} ${y} m ${612 - left} ${y} l S`);
      y -= 14;
    }
  };

  const addText = (
    text: string,
    font = "F1",
    size = 10,
    color = "0 0 0",
    spacing = 14
  ) => {
    checkPageBreak(spacing);
    pagesTextStreams[currentPageIndex].push(
      `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${left} ${y} Tm (${escapePdfText(text)}) Tj ET`
    );
    y -= spacing;
  };

  const addDivider = (thickness = 1, color = "0 0 0") => {
    checkPageBreak(14);
    y -= 4;
    pagesTextStreams[currentPageIndex].push(`${color} RG ${thickness} w ${left} ${y} m ${612 - left} ${y} l S`);
    y -= 10;
  };

  // 1. Document Header & State Hash Verification Bar
  addText(t("decree.pdf.documentHeader"), "F2", 14, "0 0 0", 18);
  addText(t("decree.pdf.merkleRootPrefix", { hash: input.merkleRootHash }), "F2", 8, "0.1 0.1 0.1", 14);
  addDivider(1.5);

  // 2. Metadata Block
  addText(t("decree.pdf.decreeIdPrefix", { id: input.decreeId, date: input.createdAt }), "F1", 9, "0.2 0.2 0.2", 14);
  const parcelStatusLabel = input.deedInfo.isVerifiedParcelRecord
    ? t("decree.pdf.recordedParcel")
    : input.deedInfo.parcelId && input.deedInfo.parcelId !== "UNRECORDED"
      ? t("decree.pdf.reportedUnverifiedParcel")
      : t("decree.pdf.unrecordedParcel");
  addText(
    t("decree.pdf.parcelMeta", {
      parcelId: input.deedInfo.parcelId,
      status: parcelStatusLabel,
      zoning: input.deedInfo.zoningClassification,
    }),
    "F1",
    9,
    "0.2 0.2 0.2",
    14
  );
  addText(t("decree.pdf.addressPrefix", { address: input.deedInfo.propertyAddress }), "F1", 9, "0.2 0.2 0.2", 14);
  addText(t("decree.pdf.ownerPrefix", { owner: input.deedInfo.ownerName }), "F2", 9, "0 0 0", 18);
  addDivider(0.5);

  // 3. Sovereign Mandate
  addText(t("decree.pdf.section1Title"), "F2", 11, "0 0 0", 16);
  addText(t("decree.pdf.mandateTitlePrefix", { title: input.decreeTitle }), "F2", 10, "0 0 0", 14);
  
  const mandateWords = input.mandateText.split(" ");
  let curLine = "";
  for (const w of mandateWords) {
    if ((curLine + " " + w).length > 85) {
      addText(curLine.trim(), "F1", 9, "0.1 0.1 0.1", 12);
      curLine = w;
    } else {
      curLine += " " + w;
    }
  }
  if (curLine.trim()) {
    addText(curLine.trim(), "F1", 9, "0.1 0.1 0.1", 16);
  }
  y -= 4;

  // 4. MRP Neighborhood Consensus Breakdown
  addText(t("decree.pdf.section2Title"), "F2", 11, "0 0 0", 16);
  const unavailableLabel = t("decree.pdf.metricUnavailable");
  const allConsensusMeasured =
    input.mrpMetrics.supermajorityScore != null &&
    input.mrpMetrics.marginOfError != null &&
    input.mrpMetrics.confidenceInterval != null;
  const turnoutText =
    input.mrpMetrics.turnoutWeight != null
      ? String(input.mrpMetrics.turnoutWeight)
      : unavailableLabel;

  if (allConsensusMeasured) {
    addText(
      t("decree.pdf.supermajorityLine", {
        conviction: (input.mrpMetrics.supermajorityScore! * 100).toFixed(1),
        margin: (input.mrpMetrics.marginOfError! * 100).toFixed(1),
        confidence: (input.mrpMetrics.confidenceInterval! * 100).toFixed(0),
      }),
      "F2",
      9,
      "0 0 0",
      14
    );
  } else {
    addText(
      t("decree.pdf.supermajorityLineUnavailable", {
        conviction:
          input.mrpMetrics.supermajorityScore != null
            ? `${(input.mrpMetrics.supermajorityScore * 100).toFixed(1)}%`
            : unavailableLabel,
        margin:
          input.mrpMetrics.marginOfError != null
            ? `±${(input.mrpMetrics.marginOfError * 100).toFixed(1)}%`
            : unavailableLabel,
        confidence:
          input.mrpMetrics.confidenceInterval != null
            ? `${(input.mrpMetrics.confidenceInterval * 100).toFixed(0)}%`
            : unavailableLabel,
      }),
      "F2",
      9,
      "0 0 0",
      14
    );
  }
  addText(
    t("decree.pdf.sampleSizeLine", {
      sampleSize: input.mrpMetrics.sampleSize.toLocaleString(),
      turnoutWeight: turnoutText,
    }),
    "F1",
    9,
    "0.2 0.2 0.2",
    18
  );
  addDivider(0.5);

  // 5. PostGIS Setback & Spatial Audit Evidence
  addText(t("decree.pdf.section3Title"), "F2", 11, "0 0 0", 16);
  if (input.gisProofs.length === 0) {
    addText(t("decree.pdf.noGisBreaches"), "F1", 9, "0.3 0.3 0.3", 14);
  } else {
    for (const proof of input.gisProofs) {
      const status = proof.isBreach
        ? t("decree.pdf.breachConfirmedTag")
        : t("decree.pdf.compliantTag");
      addText(
        t("decree.pdf.proofLine", {
          status,
          facilityType: proof.facilityType,
          facilityName: proof.facilityName,
          measured: proof.measuredDistanceFeet,
          buffer: proof.bufferRequirementFeet,
        }),
        proof.isBreach ? "F2" : "F1",
        9,
        proof.isBreach ? "0 0 0" : "0.3 0.3 0.3",
        13
      );
    }
    y -= 4;
  }

  // 6. Hardware-Attested Photographic Audit Evidence
  addText(t("decree.pdf.section4Title"), "F2", 11, "0 0 0", 16);
  if (input.photos.length === 0) {
    addText(t("decree.pdf.noHardwarePhotos"), "F1", 9, "0.3 0.3 0.3", 14);
  } else {
    for (const photo of input.photos) {
      addText(
        t("decree.pdf.photoAttestationLine", {
          device: photo.deviceAttestationId,
          capturedAt: photo.capturedAt,
        }),
        "F1",
        8,
        "0.2 0.2 0.2",
        11
      );
      addText(t("decree.pdf.photoHashLine", { hash: photo.sha256Hash }), "F1", 8, "0.3 0.3 0.3", 14);
    }
    y -= 4;
  }

  addDivider(0.5);

  // 7. Commercial Lease Public Nuisance & Indemnification Termination Notice
  if (input.leaseTerminationNotice) {
    addText(t("decree.pdf.section5Title"), "F2", 11, "0 0 0", 16);
    addText(t("decree.pdf.clausePrefix", { clause: input.leaseTerminationNotice.clauseTitle }), "F2", 9, "0 0 0", 13);
    const noticeBody = input.leaseTerminationNotice.legalNoticeBody;
    const noticeWords = noticeBody.split(" ");
    let nLine = "";
    for (const w of noticeWords) {
      if ((nLine + " " + w).length > 85) {
        addText(nLine.trim(), "F1", 8, "0.1 0.1 0.1", 11);
        nLine = w;
      } else {
        nLine += " " + w;
      }
    }
    if (nLine.trim()) {
      addText(nLine.trim(), "F1", 8, "0.1 0.1 0.1", 16);
    }
  } else {
    addText(t("decree.pdf.section5StatusTitle"), "F2", 11, "0 0 0", 16);
    addText(t("decree.pdf.noActiveNuisanceBreaches"), "F1", 8, "0.3 0.3 0.3", 16);
  }

  addDivider(1);

  // Footer Verification Link
  const verifyUrl = input.verificationUrl || `https://valerie.sunshade.icu/decree/${input.decreeId}`;
  addText(t("decree.pdf.verificationLinkPrefix", { url: verifyUrl }), "F2", 8, "0 0 0", 12);

  // Assemble Standard Multi-Page PDF 1.4
  const totalPages = pagesTextStreams.length;
  const header = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const headerBytes = Buffer.byteLength(header, "latin1");

  // Object indices:
  // 1: Catalog
  // 2: Pages
  // 3..(2+totalPages): Page objects
  // (3+totalPages)..(2+totalPages*2): Content Stream objects
  // (3+totalPages*2): Font F1
  // (4+totalPages*2): Font F2
  const fontF1Obj = 3 + totalPages * 2;
  const fontF2Obj = 4 + totalPages * 2;

  const pageObjNums: number[] = [];
  const streamObjNums: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    pageObjNums.push(3 + i);
    streamObjNums.push(3 + totalPages + i);
  }

  const objects: Array<{ num: number; raw: string }> = [];

  // Obj 1: Catalog
  objects.push({ num: 1, raw: `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj` });

  // Obj 2: Pages
  const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  objects.push({ num: 2, raw: `2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${totalPages} >>\nendobj` });

  // Emit all Page objects (3 .. 2+totalPages) before Content Stream objects so xref matches object numbers
  for (let i = 0; i < totalPages; i++) {
    const pageNum = pageObjNums[i];
    const streamNum = streamObjNums[i];
    objects.push({
      num: pageNum,
      raw: `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${streamNum} 0 R /Resources << /Font << /F1 ${fontF1Obj} 0 R /F2 ${fontF2Obj} 0 R >> >> >>\nendobj`,
    });
  }

  // Emit all Content Stream objects (3+totalPages .. 2+totalPages*2)
  for (let i = 0; i < totalPages; i++) {
    const streamNum = streamObjNums[i];
    const streamContent = pagesTextStreams[i].join("\n");
    const streamLen = Buffer.byteLength(streamContent, "latin1");
    objects.push({
      num: streamNum,
      raw: `${streamNum} 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj`,
    });
  }

  // Font Objects with WinAnsiEncoding for ±, §, and legal punctuation
  objects.push({
    num: fontF1Obj,
    raw: `${fontF1Obj} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj`,
  });
  objects.push({
    num: fontF2Obj,
    raw: `${fontF2Obj} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj`,
  });

  // Sort strictly by object number so XRef entry i always points to object i
  objects.sort((a, b) => a.num - b.num);

  // Build PDF buffer with XRef table
  const offsets: number[] = [];
  let body = "";
  for (const obj of objects) {
    offsets.push(headerBytes + Buffer.byteLength(body, "latin1"));
    body += obj.raw + "\n";
  }

  const xrefStart = headerBytes + Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  const fullPdf = header + body + xref + trailer;

  return new Uint8Array(Buffer.from(fullPdf, "latin1"));
}
