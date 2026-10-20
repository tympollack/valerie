"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  MapPin,
  Building2,
  Compass,
  AlertTriangle,
  Clock,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Activity,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  fetchPollResultsByLocale,
  type LocaleGranularity,
  type LocaleSentimentRecord,
} from "@/app/actions/valerieLocaleActions";
import { cn } from "@/lib/utils";

export interface EcosystemRef {
  source: "patchwork" | "speak_for_the_dead";
  id: string;
  url: string;
  label: string;
}

export interface LocaleSentimentExplorerProps {
  pollId?: string;
  initialGranularity?: LocaleGranularity;
  initialRecords?: LocaleSentimentRecord[];
  relatedEcosystemRefs?: Record<string, unknown> | null;
  className?: string;
}

const GRANULARITY_OPTIONS = [
  { id: "LOCAL" as const, label: "Local (H3 / County)", icon: MapPin },
  { id: "STATE" as const, label: "State / Province", icon: Building2 },
  { id: "NATIONAL" as const, label: "National", icon: Compass },
  { id: "GLOBAL" as const, label: "Global", icon: Globe },
];

const formatLikert = (s: number | null) => (s == null ? "—" : s > 0 ? `+${s.toFixed(2)}` : s.toFixed(2));

function parseEcosystemRefs(raw: unknown): EcosystemRef[] {
  if (!raw || typeof raw !== "object") return [];
  const refs: EcosystemRef[] = [];
  const record = raw as Record<string, unknown>;

  const addIds = (source: "patchwork" | "speak_for_the_dead", val: unknown) => {
    const items = Array.isArray(val) ? val : typeof val === "string" ? [val] : [];
    for (const item of items) {
      if (typeof item === "string" && item.trim()) {
        const id = item.trim();
        const isPw = source === "patchwork";
        refs.push({
          source,
          id,
          label: isPw ? `PatchWork #${id}` : `Speak for the Dead #${id}`,
          url: isPw ? `https://patchwork.sunshade.icu/records/${id}` : `https://sftd.sunshade.icu/records/${id}`,
        });
      }
    }
  };

  addIds("patchwork", record.patchwork || record.patchwork_id || record.pw);
  addIds("speak_for_the_dead", record.speak_for_the_dead || record.sftd_id || record.sftd);
  return refs;
}

export function LocaleSentimentExplorer({
  pollId,
  initialGranularity = "NATIONAL",
  initialRecords = [],
  relatedEcosystemRefs,
  className,
}: LocaleSentimentExplorerProps) {
  const [granularity, setGranularity] = useState<LocaleGranularity>(initialGranularity);
  const [records, setRecords] = useState<LocaleSentimentRecord[]>(initialRecords);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [temporalMode, setTemporalMode] = useState<"side-by-side" | "shockwave" | "settled">("side-by-side");

  // Automatically fetch initial records if none were supplied
  useEffect(() => {
    if (pollId && initialRecords.length === 0) {
      startTransition(async () => {
        const result = await fetchPollResultsByLocale(pollId, granularity);
        if (result.success) {
          setRecords(result.data);
          if (result.fallbackApplied && result.fallbackReason) {
            setFallbackMessage(result.fallbackReason);
            setGranularity(result.granularity);
          }
        }
      });
    }
  }, [pollId]);

  const ecosystemRefs = useMemo(
    () => parseEcosystemRefs(relatedEcosystemRefs),
    [relatedEcosystemRefs]
  );

  // Compute blast-radius divergence
  const divergenceMetrics = useMemo(() => {
    const inside = records.filter((r) => r.is_inside_blast_radius);
    const outside = records.filter((r) => !r.is_inside_blast_radius);
    const insideCount = inside.reduce((sum, r) => sum + r.participant_count, 0);
    const outsideCount = outside.reduce((sum, r) => sum + r.participant_count, 0);

    const calcSalience = (list: typeof inside, total: number) =>
      list.length > 0 && total > 0
        ? list.reduce((sum, r) => sum + (r.weighted_salience ?? 0) * r.participant_count, 0) / total
        : null;

    const insideSalience = calcSalience(inside, insideCount);
    const outsideSalience = calcSalience(outside, outsideCount);
    const delta = insideSalience != null && outsideSalience != null ? insideSalience - outsideSalience : null;

    return {
      insideCount,
      outsideCount,
      insideSalience,
      outsideSalience,
      delta,
      isHighDivergence: delta != null && Math.abs(delta) > 0.5,
    };
  }, [records]);

  const handleGranularitySelect = (newGranularity: LocaleGranularity) => {
    if (newGranularity === granularity && records.length > 0) return;
    setGranularity(newGranularity);
    setFallbackMessage(null);

    if (!pollId) return;

    startTransition(async () => {
      const result = await fetchPollResultsByLocale(pollId, newGranularity);
      if (result.success) {
        setRecords(result.data);
        if (result.fallbackApplied && result.fallbackReason) {
          setFallbackMessage(result.fallbackReason);
          setGranularity(result.granularity);
        }
      } else {
        setFallbackMessage(result.error || "Unable to retrieve locale metrics.");
      }
    });
  };

  return (
    <div className={cn("space-y-5 rounded-2xl border border-slate-800 bg-slate-950/80 p-5 backdrop-blur-xl", className)}>
      {/* Header & Granularity Segmented Pill Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-400" />
            <h4 className="text-sm font-bold text-slate-100">Multi-Scale Locale Sentiment Rollup</h4>
            <Badge variant="outline" className="border-cyan-500/30 text-[10px] text-cyan-400">
              K-Anonymous (N≥10)
            </Badge>
          </div>
          <p className="text-[11px] text-slate-400">
            Centroid aggregation comparing directly impacted locales with broader consensus.
          </p>
        </div>

        {/* Tier Selector Pills */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
          {GRANULARITY_OPTIONS.map((tier) => {
            const Icon = tier.icon;
            const isActive = granularity === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => handleGranularitySelect(tier.id)}
                disabled={isPending}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all duration-200 cursor-pointer",
                  isActive
                    ? "bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tier.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* K-Anonymity Privacy Fallback Tooltip / Banner */}
      {fallbackMessage && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-950/40 p-3 text-xs text-amber-300"
        >
          <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">Privacy Threshold Active: </span>
            <span>{fallbackMessage}</span>
          </div>
        </motion.div>
      )}

      {/* Proximity Blast-Radius Divergence Callout */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Blast-Radius Proximity Divergence
            </span>
          </div>

          {/* Divergence Callout Badge */}
          {divergenceMetrics.delta != null ? (
            <div
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold border transition-all",
                divergenceMetrics.isHighDivergence
                  ? "border-amber-400/80 bg-amber-950/70 text-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.35)] animate-pulse"
                  : "border-cyan-500/40 bg-cyan-950/40 text-cyan-300"
              )}
            >
              {divergenceMetrics.isHighDivergence ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              )}
              <span>
                Divergence: {divergenceMetrics.delta > 0 ? `+${divergenceMetrics.delta.toFixed(2)}` : divergenceMetrics.delta.toFixed(2)}
              </span>
              {divergenceMetrics.isHighDivergence && (
                <span className="text-[10px] font-extrabold uppercase tracking-tight text-amber-200">
                  (High Divergence &gt;0.50)
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">Insufficient dual-group observers</span>
          )}
        </div>

        {/* Side-by-side metric comparison cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { title: "Directly Impacted Locales", color: "text-cyan-400", border: "border-cyan-500/20", count: divergenceMetrics.insideCount, salience: divergenceMetrics.insideSalience },
            { title: "External Observers", color: "text-slate-300", border: "border-slate-800", count: divergenceMetrics.outsideCount, salience: divergenceMetrics.outsideSalience },
          ].map((grp) => (
            <div key={grp.title} className={cn("rounded-lg border bg-slate-950/60 p-3 space-y-1", grp.border)}>
              <div className="flex items-center justify-between text-[11px]">
                <span className={cn("font-semibold", grp.color)}>{grp.title}</span>
                <span className="font-mono text-slate-400">{grp.count} verified</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xl font-bold text-slate-100">{formatLikert(grp.salience)}</span>
                <span className="text-[10px] text-slate-400">Weighted Salience</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Temporal Velocity Toggle & Comparison */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Temporal Velocity (24h Shockwave vs. Deliberative Settled)
            </span>
          </div>

          {/* Toggle pill buttons */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-0.5 text-[11px]">
            {(["side-by-side", "shockwave", "settled"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTemporalMode(mode)}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium capitalize transition-colors",
                  temporalMode === mode
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                {mode === "side-by-side" ? "Both" : mode}
              </button>
            ))}
          </div>
        </div>

        {/* Bucket-by-Bucket Display */}
        {records.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            No geographic clusters with ≥10 participants available at this scale tier.
          </div>
        ) : (
          <div className="space-y-2.5">
            {records.map((r) => {
              const shock = r.shockwave_24h_likert;
              const settled = r.settled_likert;
              const hasTemporalDrift = shock != null && settled != null;
              const temporalDrift = hasTemporalDrift ? settled! - shock! : null;

              return (
                <div
                  key={r.locale_bucket}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    r.is_inside_blast_radius
                      ? "border-cyan-500/30 bg-cyan-950/10 hover:border-cyan-500/50"
                      : "border-slate-800/80 bg-slate-950/40 hover:border-slate-700"
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-100">
                        {r.locale_bucket}
                      </span>
                      {r.is_inside_blast_radius && (
                        <Badge className="bg-cyan-500/20 border-cyan-500/40 text-cyan-300 text-[9px] uppercase">
                          Directly Impacted
                        </Badge>
                      )}
                      <span className="text-[11px] text-slate-400">
                        ({r.participant_count} participants)
                      </span>
                    </div>

                    {/* Temporal Metrics */}
                    <div className="flex items-center gap-3 text-xs font-mono">
                      {(temporalMode === "side-by-side" || temporalMode === "shockwave") && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] uppercase text-amber-400/90 font-sans">24h Shock:</span>
                          <span className="text-slate-200 font-bold">{formatLikert(shock)}</span>
                        </div>
                      )}
                      {(temporalMode === "side-by-side" || temporalMode === "settled") && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] uppercase text-cyan-400/90 font-sans">Settled:</span>
                          <span className="text-slate-200 font-bold">{formatLikert(settled)}</span>
                        </div>
                      )}
                      {temporalMode === "side-by-side" && temporalDrift != null && (
                        <span
                          className={cn(
                            "text-[10px] font-sans font-semibold",
                            temporalDrift > 0 ? "text-emerald-400" : temporalDrift < 0 ? "text-rose-400" : "text-slate-400"
                          )}
                        >
                          (Δ {temporalDrift > 0 ? `+${temporalDrift.toFixed(2)}` : temporalDrift.toFixed(2)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ecosystem Ground-Truth Deep-Link Badges */}
      {ecosystemRefs.length > 0 && (
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <ExternalLink className="h-3.5 w-3.5 text-cyan-400" />
            <span>Connected Ecosystem Ground-Truth Evidence</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ecosystemRefs.map((ref) => (
              <a
                key={ref.id}
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300 transition-all hover:border-cyan-400 hover:bg-slate-800 hover:text-cyan-200"
              >
                <span className="font-semibold">{ref.label}</span>
                <ExternalLink className="h-3 w-3 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-300" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
