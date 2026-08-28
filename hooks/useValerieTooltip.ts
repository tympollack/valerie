"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export type TooltipSource = "cache" | "gemini" | "openai" | "ai-fallback" | null;

export interface TooltipData {
  definition: string;
  source: TooltipSource;
  hashKey: string;
}

export interface UseValerieTooltipOptions {
  language?: string;
  readingLevel?: string;
}

export interface ValerieTooltipState {
  isLoading: boolean;
  definition: string | null;
  source: TooltipSource;
  hashKey: string | null;
  error: string | null;
}

// In-memory client-side cache across component instances
const CLIENT_MEMORY_CACHE = new Map<string, TooltipData>();

/**
 * Computes client-side SHA-256 hash in hexadecimal.
 */
export async function calculateSha256(text: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    // Basic fallback for non-crypto environments
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(16, "0");
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useValerieTooltip(options: UseValerieTooltipOptions = {}) {
  const { language = "en", readingLevel = "general" } = options;

  const [state, setState] = useState<ValerieTooltipState>({
    isLoading: false,
    definition: null,
    source: null,
    hashKey: null,
    error: null,
  });

  const activeRequestRef = useRef<string | null>(null);

  const fetchTooltip = useCallback(
    async (word: string): Promise<TooltipData | null> => {
      const cleanWord = word.trim();
      if (!cleanWord) return null;

      const cacheKeyInput = `${cleanWord.toLowerCase()}:${language}:${readingLevel}`;
      const hashKey = await calculateSha256(cacheKeyInput);

      // 1. Check in-memory client cache
      if (CLIENT_MEMORY_CACHE.has(hashKey)) {
        const cached = CLIENT_MEMORY_CACHE.get(hashKey)!;
        setState({
          isLoading: false,
          definition: cached.definition,
          source: cached.source,
          hashKey: cached.hashKey,
          error: null,
        });
        return cached;
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        hashKey,
        error: null,
      }));
      activeRequestRef.current = hashKey;

      // 2. Direct Supabase content_cache lookup
      try {
        const supabase = createClient();
        const { data: dbRow } = await supabase
          .schema("valerie")
          .from("content_cache")
          .select("cached_translation")
          .eq("original_text_hash", hashKey)
          .maybeSingle();

        if (dbRow?.cached_translation) {
          const result: TooltipData = {
            definition: dbRow.cached_translation,
            source: "cache",
            hashKey,
          };
          CLIENT_MEMORY_CACHE.set(hashKey, result);

          if (activeRequestRef.current === hashKey) {
            setState({
              isLoading: false,
              definition: result.definition,
              source: "cache",
              hashKey,
              error: null,
            });
          }
          return result;
        }
      } catch {
        // Fall through to API endpoint
      }

      // 3. Fallback to API / Edge Function simplify-word
      try {
        const res = await fetch("/api/simplify-word", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            word: cleanWord,
            targetLanguage: language,
            targetReadingLevel: readingLevel,
          }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const result: TooltipData = {
          definition: data.definition,
          source: data.source || "ai-fallback",
          hashKey: data.hashKey || hashKey,
        };

        CLIENT_MEMORY_CACHE.set(hashKey, result);

        if (activeRequestRef.current === hashKey) {
          setState({
            isLoading: false,
            definition: result.definition,
            source: result.source,
            hashKey,
            error: null,
          });
        }
        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to load definition";
        if (activeRequestRef.current === hashKey) {
          setState({
            isLoading: false,
            definition: null,
            source: null,
            hashKey,
            error: errorMsg,
          });
        }
        return null;
      }
    },
    [language, readingLevel]
  );

  return {
    ...state,
    fetchTooltip,
  };
}
