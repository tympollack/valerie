/**
 * Project Valerie: Locale-Aware Intl Formatters
 * File: lib/i18n/formatters.ts
 * Work Item: [TASK-VAL-I18N-CORE]
 */

/**
 * Formats a number according to the specified locale.
 */
export function formatNumber(
  value: number,
  locale = "en-US",
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Formats a ratio as a percentage according to the specified locale.
 */
export function formatPercent(
  value: number,
  locale = "en-US",
  decimals = 1
): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Formats a timestamp or Date according to the specified locale.
 */
export function formatDate(
  date: string | number | Date,
  locale = "en-US",
  options?: Intl.DateTimeFormatOptions
): string {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat(locale, options || { dateStyle: "medium" }).format(d);
}
