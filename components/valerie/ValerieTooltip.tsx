"use client";

import { useState, useCallback } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useValerieTooltip } from "@/hooks/useValerieTooltip";
import {
  Sparkles,
  Zap,
  Loader2,
  AlertCircle,
  Hash,
  BookOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ValerieTooltipProps {
  word: string;
  children?: React.ReactNode;
  language?: string;
  readingLevel?: string;
  className?: string;
}

export function ValerieTooltip({
  word,
  children,
  language = "en",
  readingLevel = "general",
  className,
}: ValerieTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { isLoading, definition, source, hashKey, error, fetchTooltip } =
    useValerieTooltip({ language, readingLevel });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open && !definition && !isLoading) {
        fetchTooltip(word);
      }
    },
    [word, definition, isLoading, fetchTooltip]
  );

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className={cn(
          "inline-flex items-baseline gap-0.5 cursor-pointer font-medium",
          "text-cyan-400 hover:text-cyan-300 transition-colors duration-150",
          "underline decoration-dotted decoration-cyan-500/60 underline-offset-4 hover:decoration-cyan-400",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 rounded-xs",
          className
        )}
        aria-label={`Learn about ${word}`}
      >
        <span>{children || word}</span>
        <sup
          aria-hidden="true"
          className="text-[10px] font-bold text-cyan-400/80 select-none ml-0.5 px-1 py-0.2 rounded-full bg-cyan-950/60 border border-cyan-500/30"
        >
          ?
        </sup>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className={cn(
          "w-80 p-0 border border-cyan-500/30 bg-slate-950/95 text-slate-100",
          "shadow-[0_0_30px_rgba(6,182,212,0.18)] backdrop-blur-xl rounded-xl overflow-hidden"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cyan-500/20 px-3.5 py-2.5 bg-cyan-950/40">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-200 truncate">
              {word}
            </span>
          </div>
          {hashKey && (
            <div
              className="flex items-center gap-1 font-mono text-[10px] text-cyan-400/60 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-500/20 shrink-0"
              title={`SHA-256: ${hashKey}`}
            >
              <Hash className="h-2.5 w-2.5" />
              <span>{hashKey.slice(0, 8)}...</span>
            </div>
          )}
        </div>

        {/* Body Content */}
        <div className="p-4">
          <AnimatePresence mode="wait">
            {isLoading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2.5 text-slate-300 py-1"
              >
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400 shrink-0" />
                <span className="text-xs font-medium">Resolving AI cache hash...</span>
              </motion.div>
            )}

            {!isLoading && error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-2 text-rose-400"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold">Unable to fetch context</p>
                  <p className="text-slate-400 mt-0.5">{error}</p>
                </div>
              </motion.div>
            )}

            {!isLoading && definition && (
              <motion.div
                key="content"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <p className="text-xs text-slate-200 leading-relaxed">
                  {definition}
                </p>

                <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[10px]">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    {source === "cache" ? (
                      <>
                        <Zap className="h-3 w-3 text-cyan-400 shrink-0" />
                        <span className="text-cyan-300 font-medium">Cached Context (0ms)</span>
                      </>
                    ) : source === "gemini" ? (
                      <>
                        <Sparkles className="h-3 w-3 text-cyan-400 shrink-0" />
                        <span className="text-cyan-300 font-medium">Gemini AI • Non-partisan</span>
                      </>
                    ) : source === "openai" ? (
                      <>
                        <Sparkles className="h-3 w-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-300 font-medium">OpenAI • Verified</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3 text-cyan-400 shrink-0" />
                        <span className="text-cyan-300 font-medium">Empathetic Educator</span>
                      </>
                    )}
                  </div>
                  <span className="text-slate-500 capitalize">{readingLevel} Level</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </PopoverContent>
    </Popover>
  );
}
