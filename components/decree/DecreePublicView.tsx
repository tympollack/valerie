"use client";

/**
 * Project Valerie: Public Sovereign Decree Audit Verification Component
 * File: components/decree/DecreePublicView.tsx
 * Work Item: [TASK-VAL-ZONING-RECORD] / [STORY-VAL-LANDOWNER-DECREE]
 */

import React, { useState } from "react";
import { SovereignDecreeDossierInput } from "@/lib/types/decreeDossier";
import { ShieldCheck, Download, MapPin, Copy, Check, FileText, AlertTriangle } from "lucide-react";

interface DecreePublicViewProps {
  dossier: SovereignDecreeDossierInput;
}

export function DecreePublicView({ dossier }: DecreePublicViewProps) {
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  const consensusPct = (dossier.mrpMetrics.supermajorityScore * 100).toFixed(1);
  const moePct = (dossier.mrpMetrics.marginOfError * 100).toFixed(1);
  const pdfDownloadUrl = `/api/decree/${dossier.decreeId}/pdf`;
  const oembedUrl = `https://valerie.sunshade.icu/api/v1/oembed/decree?url=https://valerie.sunshade.icu/decree/${dossier.decreeId}`;

  const copyEmbedCode = () => {
    const embedHtml = `<iframe src="${dossier.verificationUrl || `https://valerie.sunshade.icu/decree/${dossier.decreeId}`}" width="100%" height="320" frameborder="0"></iframe>`;
    navigator.clipboard.writeText(embedHtml);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2500);
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 py-6 px-4">
      {/* 1. Tamper-Evident Header Banner */}
      <div className="border-2 border-black dark:border-white p-6 rounded-lg bg-white dark:bg-zinc-950 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4 mb-4 border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-600 dark:text-zinc-400">
              Certified Sovereign Citizen Decree
            </span>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded text-xs font-mono">
            <span className="text-zinc-500">MERKLE ROOT:</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate max-w-[200px] md:max-w-[320px]">
              {dossier.merkleRootHash}
            </span>
          </div>
        </div>

        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-900 dark:text-zinc-100 mb-3">
          {dossier.decreeTitle}
        </h1>
        <p className="text-base text-zinc-700 dark:text-zinc-300 leading-relaxed mb-6 font-medium">
          {dossier.mandateText}
        </p>

        {/* 1-Click Certified Legal PDF Download */}
        <div className="flex flex-wrap items-center gap-4">
          <a
            href={pdfDownloadUrl}
            download={`sovereign-decree-${dossier.decreeId}.pdf`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-black hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black font-semibold text-sm rounded-md transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            Download Certified Legal Dossier (PDF)
          </a>
          <button
            onClick={copyEmbedCode}
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-200 font-medium text-sm rounded-md border border-zinc-300 dark:border-zinc-700 transition-colors"
          >
            {copiedEmbed ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {copiedEmbed ? "Embed Snippet Copied" : "Copy Newsroom Embed"}
          </button>
        </div>
      </div>

      {/* 2. Grid: Consensus Metrics & Parcel Deed Record */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Consensus Metrics */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 bg-white dark:bg-zinc-950 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            MRP-Calibrated Consensus
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Supermajority Conviction</span>
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{consensusPct}%</span>
            </div>
            <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-2">
              <div
                className="bg-emerald-600 dark:bg-emerald-500 h-2 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, dossier.mrpMetrics.supermajorityScore * 100))}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-400 pt-1">
              <span>Verified Sample: <strong>{dossier.mrpMetrics.sampleSize.toLocaleString()}</strong></span>
              <span>Margin of Error: <strong>±{moePct}%</strong></span>
              <span>Confidence: <strong>{(dossier.mrpMetrics.confidenceInterval * 100).toFixed(0)}%</strong></span>
            </div>
          </div>
        </div>

        {/* Parcel Deed Information */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 bg-white dark:bg-zinc-950 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Parcel & Zoning Record
            </h2>
            {dossier.deedInfo.isVerifiedParcelRecord ? (
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Verified Parcel Record
              </span>
            ) : (
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                Unrecorded Parcel
              </span>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Parcel ID:</span>
              <span className="font-mono font-semibold">{dossier.deedInfo.parcelId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Owner of Record:</span>
              <span className="font-semibold">{dossier.deedInfo.ownerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Address:</span>
              <span className="font-medium text-right">{dossier.deedInfo.propertyAddress}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Zoning Class:</span>
              <span className="font-mono text-xs px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
                {dossier.deedInfo.zoningClassification}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Geographic Boundary Polygon & Spatial Verification */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 bg-white dark:bg-zinc-950 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            Geographic Boundary & Setback Proofs
          </h2>
        </div>

        {dossier.gisProofs.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">No buffer violations logged for this parcel.</p>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {dossier.gisProofs.map((proof, idx) => (
              <div key={idx} className="py-2.5 flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="font-semibold">{proof.facilityName}</span>
                  <span className="text-xs text-zinc-500">({proof.facilityType})</span>
                </div>
                <div className="text-xs font-mono">
                  <span>Measured: <strong>{proof.measuredDistanceFeet}ft</strong></span>
                  <span className="text-zinc-400 mx-1">/</span>
                  <span>Required: <strong>{proof.bufferRequirementFeet}ft</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}

        {dossier.leaseTerminationNotice && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded text-xs text-red-800 dark:text-red-300 space-y-1">
            <span className="font-bold uppercase tracking-wider block text-[10px] text-red-600 dark:text-red-400">
              Statutory Notice Triggered
            </span>
            <p className="font-semibold">{dossier.leaseTerminationNotice.clauseTitle}</p>
            <p className="text-red-700 dark:text-red-300 text-[11px] leading-relaxed">
              {dossier.leaseTerminationNotice.legalNoticeBody}
            </p>
          </div>
        )}
      </div>

      {/* 4. Newsrooms & Bloggers oEmbed Verification */}
      <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-4 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4" />
          <span>oEmbed 1.0 Live Badge Endpoint: <code className="font-mono text-zinc-900 dark:text-zinc-100">{oembedUrl}</code></span>
        </div>
        <span className="text-zinc-400">Compliant with standard oEmbed aggregators</span>
      </div>
    </div>
  );
}
