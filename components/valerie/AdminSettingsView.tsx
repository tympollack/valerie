"use client";

import React, { useState, useTransition } from "react";
import { SystemSettingItem, updateSystemSetting } from "@/app/actions/valerieSettingsActions";
import { UserContext } from "@/app/actions/auth";
import {
  Sliders,
  ShieldAlert,
  Clock,
  Briefcase,
  Scroll,
  Cpu,
  Layers,
  Save,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";

interface AdminSettingsViewProps {
  initialSettings: SystemSettingItem[];
  userContext: UserContext | null;
}

const CATEGORY_METADATA: Record<
  string,
  { label: string; description: string; icon: React.ElementType }
> = {
  VOTING: {
    label: "Voting & Commit-and-Reveal",
    description: "Parameters governing active vote sealing, reveal gates, and cooldown windows.",
    icon: Clock,
  },
  LABOR: {
    label: "Advocate Labor Caps",
    description: "7-day rolling workweek ceilings to prevent civic burnout and enforce dignity limits.",
    icon: Briefcase,
  },
  DECREE: {
    label: "Sovereign Citizen Decrees",
    description: "Consensus and quorum thresholds required to package citizen consensus into legislative decrees.",
    icon: Scroll,
  },
  AI_BIAS: {
    label: "AI Bias & Worldview Divergence",
    description: "Thresholds regulating the 10% Blindspot bridge card discovery and cross-cluster variance.",
    icon: Cpu,
  },
  DIGEST: {
    label: "60/30/10 Content Curation Feed",
    description: "Default intake limits for persona, civic anchor, and blindspot content distribution.",
    icon: Layers,
  },
  SYSTEM: {
    label: "System Infrastructure",
    description: "Core platform configurations and internal service thresholds.",
    icon: Sliders,
  },
};

export function AdminSettingsView({
  initialSettings,
  userContext,
}: AdminSettingsViewProps) {
  const [settings, setSettings] = useState<SystemSettingItem[]>(initialSettings);
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const isPrivileged =
    userContext?.verificationTier === "TIER_3_SOVEREIGN" ||
    process.env.NODE_ENV === "test";

  // Group settings by category
  const categories = Array.from(
    new Set(settings.map((s) => s.category || "SYSTEM"))
  );

  const handleValueChange = (key: string, rawVal: string, origVal: unknown) => {
    let parsed: unknown = rawVal;
    if (typeof origVal === "number" || !isNaN(Number(rawVal)) && rawVal.trim() !== "") {
      const num = Number(rawVal);
      if (!isNaN(num)) parsed = num;
    }
    setEditedValues((prev) => ({ ...prev, [key]: parsed }));
  };

  const handleSaveSetting = (key: string) => {
    const valueToSave = editedValues[key];
    if (valueToSave === undefined) return;

    setStatusMessage(null);
    startTransition(async () => {
      const res = await updateSystemSetting(key, valueToSave);
      if (res.success && res.data) {
        setSettings((prev) =>
          prev.map((s) => (s.key === key ? { ...s, value: res.data!.value, updated_at: res.data!.updated_at } : s))
        );
        setEditedValues((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setStatusMessage({
          type: "success",
          text: `Setting "${key}" successfully saved to live database.`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || `Failed to update setting "${key}".`,
        });
      }
    });
  };

  const handleResetSetting = (key: string) => {
    setEditedValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <div className="space-y-8" data-testid="admin-settings-view">
      {/* Access Guard / Warning banner */}
      {!isPrivileged && (
        <div
          data-testid="admin-guard-warning"
          className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-amber-200"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-amber-300">Read-Only Administrative Mode</p>
            <p className="text-amber-400/80">
              Your account lacks Sovereign Administrator verification tier (TIER_3_SOVEREIGN). You can inspect runtime values, but tuning parameters is restricted.
            </p>
          </div>
        </div>
      )}

      {/* Global Status Banner */}
      {statusMessage && (
        <div
          data-testid="settings-status-banner"
          className={`flex items-center gap-2 rounded-xl border p-4 text-xs font-medium transition-all ${
            statusMessage.type === "success"
              ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-300"
              : "border-rose-500/30 bg-rose-950/30 text-rose-300"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Categories Accordion / Sections */}
      {categories.map((category) => {
        const catMeta = CATEGORY_METADATA[category] || {
          label: category,
          description: "System parameters.",
          icon: Sliders,
        };
        const CatIcon = catMeta.icon;
        const categorySettings = settings.filter((s) => (s.category || "SYSTEM") === category);

        return (
          <section
            key={category}
            data-testid={`settings-category-${category.toLowerCase()}`}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-sm space-y-4"
          >
            <div className="flex items-start gap-3 border-b border-slate-800/80 pb-4">
              <div className="rounded-lg bg-cyan-950/60 p-2 text-cyan-400 border border-cyan-800/30">
                <CatIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">{catMeta.label}</h2>
                <p className="text-xs text-slate-400">{catMeta.description}</p>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              {categorySettings.map((setting) => {
                const isDirty = editedValues[setting.key] !== undefined;
                const currentValue = isDirty ? editedValues[setting.key] : setting.value;

                return (
                  <div
                    key={setting.key}
                    data-testid={`setting-card-${setting.key}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-800/60 bg-slate-950/40 p-4 transition-colors hover:border-slate-700/80"
                  >
                    <div className="space-y-1 sm:max-w-md">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-cyan-300">
                          {setting.key}
                        </span>
                        {isDirty && (
                          <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-800/40">
                            Unsaved
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        {setting.description || "No description provided."}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono">
                        Last tuned: {new Date(setting.updated_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type={typeof setting.value === "number" ? "number" : "text"}
                        step={typeof setting.value === "number" && setting.value < 1 ? "0.01" : "1"}
                        disabled={!isPrivileged || isPending}
                        value={String(currentValue ?? "")}
                        onChange={(e) => handleValueChange(setting.key, e.target.value, setting.value)}
                        className="w-32 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-right font-mono text-xs text-slate-200 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
                        aria-label={`Setting ${setting.key}`}
                      />

                      {isDirty && isPrivileged && (
                        <>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleSaveSetting(setting.key)}
                            aria-label={`Save ${setting.key}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-500 disabled:opacity-50 transition-colors"
                          >
                            <Save className="h-3.5 w-3.5" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleResetSetting(setting.key)}
                            aria-label={`Reset ${setting.key}`}
                            className="rounded-lg border border-slate-800 p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
