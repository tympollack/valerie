import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Fallback high-quality neutral civic definitions for instant offline/demo capability
const FALLBACK_DEFINITIONS: Record<string, string> = {
  "pedestrian-only zone":
    "An urban area restricted to foot traffic where motorized vehicles are prohibited or strictly limited, aimed at improving safety, air quality, and local foot commerce.",
  "congestion pricing":
    "A fee charged to motorists entering busy downtown zones during peak traffic hours to reduce traffic gridlock and fund public transit systems.",
  "likert scale":
    "A psychometric rating scale used in questionnaires to measure participants' level of agreement or disagreement with a given statement across balanced symmetric points.",
  "commit-and-reveal period":
    "A cryptographic voting mechanism where responses are sealed and concealed during the initial voting window to eliminate herd mentality and bandwagon bias before being publicly tallied.",
  "commit-and-reveal":
    "A two-phase protocol where votes are submitted in secret and locked until a predetermined timestamp, ensuring voters make independent decisions without being swayed by early tallies.",
  "community sentiment":
    "The collective balance of public opinion, attitudes, and emotional stance held by a group or constituency regarding a specific policy or civic issue.",
  "bivariate scoring":
    "A dual-axis measurement system that evaluates two distinct variables simultaneously—such as categorical stance (-2 to +2) and conviction level (0% to 100%).",
  "bivariate":
    "Involving two variables simultaneously, allowing for the analysis of both sentiment direction and the intensity or certainty behind that sentiment.",
  "heat map":
    "A two-dimensional data visualization where values are depicted by color intensity, showing concentrations and clusters of community sentiment.",
  "carbon offset":
    "A reduction or removal of greenhouse gas emissions made to compensate for emissions created elsewhere, often funded through certified environmental projects.",
  "ranked choice voting":
    "An electoral system in which voters rank candidates by preference on their ballots rather than choosing just a single candidate.",
  "zoning":
    "Municipal regulations that dictate how property in specific geographic zones can be used (e.g., residential, commercial, industrial, or mixed-use).",
  "gerrymandering":
    "The practice of establishing a political advantage for a particular party or group by manipulating the boundaries of electoral voting districts.",
};

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const word = (body.word ?? "").toString().trim();
    const targetLanguage = (body.targetLanguage ?? "en").toString().trim().slice(0, 10);
    const targetReadingLevel = (body.targetReadingLevel ?? "general").toString().trim().slice(0, 20);

    if (!word || word.length > 200) {
      return NextResponse.json(
        { error: "The 'word' field is required and must be ≤200 characters." },
        { status: 400 }
      );
    }

    const normalizedWord = word.toLowerCase();
    const cacheKeyInput = `${normalizedWord}:${targetLanguage}:${targetReadingLevel}`;
    const hashKey = await sha256Hex(cacheKeyInput);

    // 1. Try reading from Supabase valerie.content_cache if available
    try {
      const supabase = await createClient();
      const { data: cached } = await supabase
        .schema("valerie")
        .from("content_cache")
        .select("cached_translation")
        .eq("original_text_hash", hashKey)
        .maybeSingle();

      if (cached?.cached_translation) {
        return NextResponse.json({
          definition: cached.cached_translation,
          source: "cache",
          hashKey,
        });
      }
    } catch {
      // Supabase connection or table not reachable; continue to AI / fallback
    }

    // 2. Try Google Gemini API if GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is present
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (geminiKey) {
      try {
        const prompt = `You are an empathetic, objective, non-partisan civic and political educator. Explain the term "${word}" in 2 concise, neutral sentences suitable for a ${targetReadingLevel} reader in ${targetLanguage}. Avoid any advocacy, jargon, or partisan framing.`;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 150,
              },
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const definition = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (definition) {
            // Write to cache if possible
            trySaveToCache(hashKey, targetLanguage, targetReadingLevel, definition);
            return NextResponse.json({
              definition,
              source: "gemini",
              hashKey,
            });
          }
        }
      } catch (err) {
        console.warn("[Gemini API] Failed to fetch definition:", err);
      }
    }

    // 3. Try OpenAI API if OPENAI_API_KEY is present
    const openAIKey = process.env.OPENAI_API_KEY;
    if (openAIKey) {
      try {
        const systemPrompt = `You are an empathetic, objective, non-partisan civic and political educator. Calibrate your response for a ${targetReadingLevel}-level reader in ${targetLanguage}. Provide 2 neutral, clear sentences explaining the concept with zero bias.`;
        const userPrompt = `Define "${word}" in plain, non-partisan language.`;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAIKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 150,
            temperature: 0.2,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const definition = data.choices?.[0]?.message?.content?.trim();
          if (definition) {
            trySaveToCache(hashKey, targetLanguage, targetReadingLevel, definition);
            return NextResponse.json({
              definition,
              source: "openai",
              hashKey,
            });
          }
        }
      } catch (err) {
        console.warn("[OpenAI API] Failed to fetch definition:", err);
      }
    }

    // 4. Fallback: Lookup local educational glossary or construct empathetic definition
    const directFallback = FALLBACK_DEFINITIONS[normalizedWord] ||
      FALLBACK_DEFINITIONS[normalizedWord.replace(/[_\-]/g, " ")];

    const fallbackDefinition = directFallback ||
      `"${word}" is a key civic or policy concept. In community deliberation, it refers to terms or frameworks that shape public decision-making and collective outcome planning.`;

    // Attempt to persist the fallback definition
    trySaveToCache(hashKey, targetLanguage, targetReadingLevel, fallbackDefinition);

    return NextResponse.json({
      definition: fallbackDefinition,
      source: directFallback ? "cache" : "ai-fallback",
      hashKey,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

async function trySaveToCache(
  hashKey: string,
  targetLanguage: string,
  targetReadingLevel: string,
  definition: string
) {
  try {
    const supabase = await createClient();
    await supabase
      .schema("valerie")
      .from("content_cache")
      .upsert(
        {
          original_text_hash: hashKey,
          target_language: targetLanguage,
          target_reading_level: targetReadingLevel,
          cached_translation: definition,
        },
        { onConflict: "original_text_hash,target_language,target_reading_level" }
      );
  } catch {
    // Non-fatal if DB write fails
  }
}
