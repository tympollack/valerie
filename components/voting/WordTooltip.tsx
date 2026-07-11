/**
 * Project Valerie: Educational Incubator — WordTooltip Component
 * File: components/voting/WordTooltip.tsx
 *
 * Renders an inline "glossary" trigger for complex civic terms.
 * On first click, it calls the simplify-word Edge Function (which either
 * hits the valerie.content_cache or calls OpenAI). The result is stored
 * in a useRef so subsequent opens of the same popover are instant.
 *
 * Data flow:
 *   User clicks word → popover opens → fetchDefinition() called (once)
 *     → POST /functions/v1/simplify-word with JWT + { word, language, readingLevel }
 *     → Edge Function checks cache → (HIT) return cached_translation
 *                                  → (MISS) call OpenAI, write cache, return definition
 *   → Render definition in Popover with source attribution
 *
 * Usage:
 *   <WordTooltip word="gerrymandering">gerrymandering</WordTooltip>
 *   <WordTooltip word="Likert scale" language="es" readingLevel="elementary">
 *     escala Likert
 *   </WordTooltip>
 */

"use client";

import { useState, useRef, useCallback } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BookOpen, Loader2, AlertTriangle, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FetchStatus = "idle" | "loading" | "success" | "error";

interface TooltipState {
  status:     FetchStatus;
  definition: string | null;
  source:     "cache" | "openai" | null;
  errorMsg:   string | null;
}

interface WordTooltipProps {
  word:          string;               // The term to define (sent to Edge Function)
  children:      React.ReactNode;      // Display content (may differ from 'word')
  language?:     string;               // BCP 47, e.g. 'en', 'es' — defaults to 'en'
  readingLevel?: string;               // 'elementary' | 'general' | 'advanced'
  className?:    string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WordTooltip({
  word,
  children,
  language     = "en",
  readingLevel = "general",
  className,
}: WordTooltipProps) {
  const [isOpen, setIsOpen]   = useState(false);
  const [state, setState]     = useState<TooltipState>({
    status:     "idle",
    definition: null,
    source:     null,
    errorMsg:   null,
  });

  // Guard against fetching more than once per component mount.
  // Using a ref (not state) so it doesn't trigger re-renders.
  const hasFetched = useRef(false);

  // ---------------------------------------------------------------------------
  // Fetch — only runs on first popover open; subsequent opens use cached state
  // ---------------------------------------------------------------------------
  const fetchDefinition = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    setState({ status: "loading", definition: null, source: null, errorMsg: null });

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/simplify-word`,
        {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            // The anon key is included so Supabase routes the request;
            // the actual auth check in the Edge Function uses the user's JWT
            // injected by the Supabase client (see note below).
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            word,
            targetLanguage:     language,
            targetReadingLevel: readingLevel,
          }),
        },
      );

      // NOTE: In a production app, replace the raw fetch above with:
      //   const supabase = createBrowserClient(...)
      //   const { data, error } = await supabase.functions.invoke('simplify-word', { body: {...} })
      // This automatically injects the user's session JWT, which the Edge
      // Function uses to verify authentication server-side.

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setState({
        status:     "success",
        definition: data.definition,
        source:     data.source,
        errorMsg:   null,
      });
    } catch (err) {
      // Allow retry on error by resetting the guard
      hasFetched.current = false;
      setState({
        status:     "error",
        definition: null,
        source:     null,
        errorMsg:   err instanceof Error ? err.message : "Failed to load definition.",
      });
    }
  }, [word, language, readingLevel]);

  // ---------------------------------------------------------------------------
  // Popover open/close handler
  // ---------------------------------------------------------------------------
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) fetchDefinition();
    },
    [fetchDefinition],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {/* Render as an inline <span> so it doesn't break prose flow */}
        <span
          role="button"
          tabIndex={0}
          aria-label={`Learn what "${word}" means`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleOpenChange(!isOpen);
            }
          }}
          className={cn(
            // Styling: dotted underline signals "clickable glossary term"
            // Primary color tint makes it subtle but distinct from regular links
            "inline-flex cursor-pointer items-baseline gap-[2px]",
            "text-primary underline decoration-dotted decoration-primary/50",
            "underline-offset-2 transition-colors hover:decoration-primary",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "rounded-sm",
            className,
          )}
        >
          {children}
          {/* Superscript "?" badge — signals interactivity without cluttering prose */}
          <sup
            aria-hidden="true"
            className="text-[9px] font-bold text-primary/60 leading-none"
          >
            ?
          </sup>
        </span>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-72 p-0 shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-2.5 bg-muted/40">
          <BookOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground truncate">
            {word}
          </span>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          {/* Loading */}
          {state.status === "loading" && (
            <div className="flex items-center gap-2 text-muted-foreground py-1">
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
              <span className="text-sm">Looking that up…</span>
            </div>
          )}

          {/* Idle (shouldn't render, but safe fallback) */}
          {state.status === "idle" && (
            <p className="text-sm text-muted-foreground">
              Click to load definition.
            </p>
          )}

          {/* Success */}
          {state.status === "success" && state.definition && (
            <div className="space-y-2.5">
              <p className="text-sm text-foreground leading-relaxed">
                {state.definition}
              </p>
              <div className="flex items-center gap-1.5 border-t pt-2">
                {state.source === "openai" ? (
                  <>
                    <Sparkles className="h-3 w-3 text-violet-500 flex-shrink-0" />
                    <span className="text-[10px] text-muted-foreground">
                      AI-generated · saved to cache
                    </span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3 text-amber-500 flex-shrink-0" />
                    <span className="text-[10px] text-muted-foreground">
                      From cache
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {state.status === "error" && (
            <div className="flex items-start gap-2 text-destructive py-1">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Couldn't load definition</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {state.errorMsg ?? "Click the term again to retry."}
                </p>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
