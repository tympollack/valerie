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

/**
 * Generates a deterministic normalized 1536-D vector for text when an external
 * embedding model is not yet loaded on the client.
 */
export function generateDeterministicEmbedding(text: string): number[] {
  const dim = 1536;
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const idx = (i * 37 + code * 17) % dim;
    vec[idx] = (vec[idx] + code / 255) % 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

export function useValerieTooltip(options: UseValerieTooltipOptions = {}) {
  const { language = "en", readingLevel = "general", embedding } = options;

  const [state, setState] = useState<ValerieTooltipState>({
    isLoading: false,
    definition: null,
    source: null,
    hashKey: null,
    error: null,
  });

  const activeRequestRef = useRef<string | null>(null);

  const fetchTooltip = useCallback(
    async (word: string, customEmbedding?: number[]): Promise<TooltipData | null> => {
      const cleanWord = word.trim();
      if (!cleanWord) return null;

      // 1. Calculate client-side SHA-256 hash using WebCrypto
      const hashKey = await hashTerm(cleanWord, readingLevel, language);

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
      activeRequestRef.current = hashKey;

      const supabase = createClient();

      // 3. Exact match lookup in valerie.content_cache (original_text_hash = hashKey)
      try {
        const { data: dbRow } = await supabase
          .schema("valerie")
          .from("content_cache")
          .select("cached_translation, original_text_hash")
          .eq("original_text_hash", hashKey)
          .maybeSingle();

        if (dbRow?.cached_translation) {
          const result: TooltipData = {
            definition: dbRow.cached_translation,
            source: "cache",
            hashKey: dbRow.original_text_hash || hashKey,
          };
          tooltipCache.set(hashKey, result);

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
        // Fall through to semantic cache check
      }

      // 4. On exact cache miss, invoke RPC valerie.match_semantic_cache(p_embedding, p_threshold => 0.96)
      try {
        const queryVector =
          customEmbedding || embedding || generateDeterministicEmbedding(cleanWord);

        // Call RPC match_semantic_cache with threshold 0.96
        const rpcCall = (supabase as any).schema
          ? supabase.schema("valerie").rpc("match_semantic_cache", {
              p_embedding: queryVector,
              p_threshold: 0.96,
            })
          : supabase.rpc("match_semantic_cache", {
              p_embedding: queryVector,
              p_threshold: 0.96,
            });

        const { data: semanticRows, error: rpcError } = await rpcCall;

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
        }
      } catch {
        // Semantic RPC unavailable; fall through to Edge Function
      }

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

        const result: TooltipData = {
          definition: definition!,
          source,
          hashKey: returnedHash,
        };

        // Save to in-memory LRU cache
        tooltipCache.set(hashKey, result);

        // Attempt write-back to valerie.content_cache
        try {
          await supabase
            .schema("valerie")
            .from("content_cache")
            .upsert(
              {
                original_text_hash: hashKey,
                target_language: language,
                target_reading_level: String(readingLevel),
                cached_translation: definition!,
              },
              { onConflict: "original_text_hash,target_language,target_reading_level" }
            );
        } catch {
          // Ignore cache write error on client
        }

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
    [language, readingLevel, embedding]
  );

  return {
    ...state,
    fetchTooltip,
  };
}
