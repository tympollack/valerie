/**
 * Project Valerie: Type-Safe Localization (i18n) Engine
 * File: lib/i18n/index.ts
 * Work Item: [TASK-VAL-I18N-CORE]
 */

import enCommon from "./dictionaries/en/common.json";
import enDecree from "./dictionaries/en/decree.json";
import enLegal from "./dictionaries/en/legal.json";
import { NestedKeyOf, TranslationParams, LocaleCode } from "./types";

export * from "./types";
export * from "./formatters";

export const defaultDictionary = {
  common: enCommon,
  decree: enDecree,
  legal: enLegal,
} as const;

export type TranslationKey = NestedKeyOf<typeof defaultDictionary>;

/**
 * Registry of available locale dictionaries.
 * Expands as additional languages (e.g. Spanish) are onboarded.
 */
const localeRegistry: Record<string, typeof defaultDictionary> = {
  en: defaultDictionary,
  "en-US": defaultDictionary,
};

/**
 * Replaces {{param}} tokens inside a template string.
 */
function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, token) => {
    return token in params ? String(params[token]) : `{{${token}}}`;
  });
}

/**
 * Resolves a nested dot-notation key (e.g. "decree.pdf.documentHeader")
 * against a dictionary object.
 */
function resolveKey(obj: Record<string, unknown>, path: string): string | null {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }

  return typeof current === "string" ? current : null;
}

/**
 * Universal type-safe translation function.
 * Synchronously retrieves and interpolates localized strings across
 * Server Components, Client Components, Edge Functions, and pure services.
 */
export function t(
  key: TranslationKey,
  params?: TranslationParams,
  locale: LocaleCode | string = "en-US"
): string {
  const dict = localeRegistry[locale] || localeRegistry["en"] || defaultDictionary;
  const rawString = resolveKey(dict as unknown as Record<string, unknown>, key as string);

  if (rawString !== null) {
    return interpolate(rawString, params);
  }

  // Fallback to default dictionary if localized dictionary is missing key
  const fallbackString = resolveKey(defaultDictionary as unknown as Record<string, unknown>, key as string);
  if (fallbackString !== null) {
    return interpolate(fallbackString, params);
  }

  // Graceful degradation: return the key itself
  return String(key);
}

/**
 * Returns the full structured dictionary for a given locale.
 */
export function getDictionary(locale: LocaleCode | string = "en-US"): typeof defaultDictionary {
  return localeRegistry[locale] || defaultDictionary;
}
