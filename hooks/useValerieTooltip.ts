"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  hashTerm,
  computeSha256,
  tooltipCache,
  LRUCache,
} from "@/lib/cache/hashLookup";

export type TooltipSource = "cache" | "gemini" | "openai" | "ai-fallback" | null;

export interface TooltipData {
  definition: string;
  source: TooltipSource;
  hashKey: string;
  similarity?: number;
}

export interface UseValerieTooltipOptions {
  language?: string;
  readingLevel?: string | number;
  embedding?: number[];
}

export interface ValerieTooltipState {
  isLoading: boolean;
  definition: string | null;
  source: TooltipSource;
  hashKey: string | null;
  error: string | null;
}

// Export calculateSha256 for backward compatibility with existing tests
export const calculateSha256 = computeSha256;

// In-memory client-side cache across component instances (backed by bounded LRU cache)
export const CLIENT_MEMORY_CACHE = tooltipCache;

export function useValerieTooltip(options: UseValerieTooltipOptions = {}) {
  const { language = "en", readingLevel = "general", embedding } = options;

  const [state, setState] = useState<ValerieTooltipState>({
    isLoading: false,
    definition: null,
    source: null,
    hashKey: null,
    error: null,
  });

  const requestIdRef = useRef<number>(0);
  const activeRequestRef = useRef<string | null>(null);

  const fetchTooltip = useCallback(
    async (word: string, customEmbedding?: number[]): Promise<TooltipData | null> => {
      const cleanWord = word.trim();
      if (!cleanWord) return null;

      // Synchronously increment request ID to immediately invalidate all older in-flight requests
      const currentRequestId = ++requestIdRef.current;

      // 1. Calculate client-side SHA-256 hash using WebCrypto
      const hashKey = await hashTerm(cleanWord, readingLevel, language);

      if (currentRequestId !== requestIdRef.current) return null;
      activeRequestRef.current = hashKey;

      // 2. Query in-memory LRU cache first (instant sub-10ms response)
      if (tooltipCache.has(hashKey)) {
        const cached = tooltipCache.get(hashKey)!;
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

      const supabase = createClient();

      // 3. Exact match lookup in valerie.content_cache (original_text_hash = hashKey)
      try {
        const { data: dbRow } = await supabase
          .schema("valerie")
          .from("content_cache")
          .select("cached_translation, original_text_hash")
          .eq("original_text_hash", hashKey)
          .maybeSingle();

        if (currentRequestId !== requestIdRef.current) return null;

        if (dbRow?.cached_translation) {
          const result: TooltipData = {
            definition: dbRow.cached_translation,
            source: "cache",
            hashKey: dbRow.original_text_hash || hashKey,
          };
          tooltipCache.set(hashKey, result);

          setState({
            isLoading: false,
            definition: result.definition,
            source: "cache",
            hashKey,
            error: null,
          });
          return result;
        }
      } catch {
        // Fall through to semantic cache check
      }

      if (currentRequestId !== requestIdRef.current) return null;

      // 4. On exact cache miss, invoke RPC valerie.match_semantic_cache if a semantic embedding is provided
      const queryVector = customEmbedding || embedding;
      if (queryVector) {
        try {
          const rpcParams = {
            p_embedding: queryVector,
            p_threshold: 0.96,
            p_target_language: language,
            p_target_reading_level: String(readingLevel),
          };

          const rpcCall = (supabase as any).schema
            ? supabase.schema("valerie").rpc("match_semantic_cache", rpcParams)
            : supabase.rpc("match_semantic_cache", rpcParams);

          const { data: semanticRows, error: rpcError } = await rpcCall;

          if (currentRequestId !== requestIdRef.current) return null;

          if (!rpcError && semanticRows) {
            const match = Array.isArray(semanticRows) ? semanticRows[0] : semanticRows;
            if (
              match?.cached_translation &&
              (match.similarity === undefined || match.similarity >= 0.96)
            ) {
              const result: TooltipData = {
                definition: match.cached_translation,
                source: "cache",
                hashKey: match.original_text_hash || hashKey,
                similarity: match.similarity,
              };
              tooltipCache.set(hashKey, result);

              setState({
                isLoading: false,
                definition: result.definition,
                source: "cache",
                hashKey,
                error: null,
              });
              return result;
            }
          }
        } catch {
          // Semantic RPC unavailable; fall through to Edge Function
        }
      }

      if (currentRequestId !== requestIdRef.current) return null;

      // 5. If both fail, trigger simplify-word Edge Function or API route
      try {
        let definition: string | null = null;
        let source: TooltipSource = "ai-fallback";
        let returnedHash: string = hashKey;

        // Try Supabase Functions client first if available
        if (supabase.functions?.invoke) {
          try {
            const { data: funcData, error: funcError } = await supabase.functions.invoke(
              "simplify-word",
              {
                body: {
                  word: cleanWord,
                  targetLanguage: language,
                  targetReadingLevel: String(readingLevel),
                },
              }
            );
            if (!funcError && funcData?.definition) {
              definition = funcData.definition;
              source = funcData.source || "ai-fallback";
              returnedHash = funcData.hashKey || hashKey;
            }
          } catch {
            // Fall through to Next.js API route
          }
        }

        if (currentRequestId !== requestIdRef.current) return null;

        // Fallback to Next.js API route /api/simplify-word
        if (!definition) {
          const res = await fetch("/api/simplify-word", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              word: cleanWord,
              targetLanguage: language,
              targetReadingLevel: String(readingLevel),
            }),
          });

          const data = await res.json();

          if (!res.ok || data.error) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }

          definition = data.definition;
          source = data.source || "ai-fallback";
          returnedHash = data.hashKey || hashKey;
        }

        if (currentRequestId !== requestIdRef.current) return null;

        const result: TooltipData = {
          definition: definition!,
          source,
          hashKey: returnedHash,
        };

        // Save to in-memory LRU cache (safe client-side caching)
        tooltipCache.set(hashKey, result);

        setState({
          isLoading: false,
          definition: result.definition,
          source: result.source,
          hashKey,
          error: null,
        });
        return result;
      } catch (err) {
        if (currentRequestId !== requestIdRef.current) return null;

        const errorMsg = err instanceof Error ? err.message : "Failed to load definition";
        setState({
          isLoading: false,
          definition: null,
          source: null,
          hashKey,
          error: errorMsg,
        });
        return null;
      }
    },
    [language, readingLevel, embedding]
  );

  return {
    ...state,
    fetchTooltip,
  };
}
