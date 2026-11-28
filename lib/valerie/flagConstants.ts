export type FlagReason =
  | "LOADED_FRAMING"
  | "FALSE_DICHOTOMY"
  | "DISPUTED_PREMISE"
  | "LOCALE_MISMATCH";

export const VALID_FLAG_REASONS: readonly FlagReason[] = [
  "LOADED_FRAMING",
  "FALSE_DICHOTOMY",
  "DISPUTED_PREMISE",
  "LOCALE_MISMATCH",
] as const;
