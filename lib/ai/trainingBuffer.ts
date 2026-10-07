/**
 * Project Valerie: MLOps Teacher-Student Training Buffer Pipeline
 * Work Item: TASK-VAL-TRAIN-BUFFER / STORY-VAL-PH2-DISTILLATION
 * File: lib/ai/trainingBuffer.ts
 *
 * Provides production utilities for exporting and formatting buffered training pairs
 * from valerie.llm_training_pairs into standardized LoRA fine-tuning JSONL format.
 */

import { createClient } from "@/lib/supabase/server";

export type TrainingTaskType = "TOOLTIP_SIMPLIFY" | "SENTIMENT_CLASSIFY" | "CLUSTER_NAMING";

export interface LoRAPair {
  prompt: string;
  completion: string;
  task_type: TrainingTaskType;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ExportLoraOptions {
  limit?: number;
  taskType?: TrainingTaskType;
  supabaseClient?: any;
}

/**
 * Serializes raw prompt/completion pairs into newline-delimited JSONL format
 * compatible with Unsloth, HuggingFace TRL, and OpenAI fine-tuning specifications.
 */
export function formatLoraJsonl(
  pairs: Array<{ prompt_input: string; completion_output: string; task_type: string }>,
  limit?: number
): string {
  const slice = limit && limit > 0 ? pairs.slice(0, limit) : pairs;
  return slice
    .map((p) =>
      JSON.stringify({
        prompt: p.prompt_input,
        completion: p.completion_output,
        task_type: p.task_type,
        messages: [
          { role: "user", content: p.prompt_input },
          { role: "assistant", content: p.completion_output },
        ],
      })
    )
    .join("\n");
}

/**
 * Parses and validates newline-delimited JSONL formatted LoRA dataset records.
 */
export function parseLoraDatasetJsonl(jsonl: string): LoRAPair[] {
  if (!jsonl || jsonl.trim().length === 0) {
    return [];
  }

  const lines = jsonl.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: LoRAPair[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (
        typeof parsed.prompt === "string" &&
        typeof parsed.completion === "string" &&
        typeof parsed.task_type === "string" &&
        Array.isArray(parsed.messages)
      ) {
        results.push(parsed as LoRAPair);
      }
    } catch {
      // Ignore malformed line
    }
  }

  return results;
}

/**
 * Invokes valerie.export_lora_dataset RPC on Supabase with error handling.
 */
export async function exportLoraDataset(
  options: ExportLoraOptions = {}
): Promise<string> {
  const limit = options.limit ?? 1000;
  const taskType = options.taskType ?? null;

  let client = options.supabaseClient;
  if (!client) {
    try {
      client = await createClient();
    } catch {
      client = null;
    }
  }

  if (!client) {
    throw new Error("Supabase client is not available for exporting LoRA dataset.");
  }

  const { data, error } = await client.rpc("export_lora_dataset", {
    p_limit: limit,
    p_task_type: taskType,
  });

  if (error) {
    throw new Error(`Failed to export LoRA dataset: ${error.message}`);
  }

  return typeof data === "string" ? data : "";
}
