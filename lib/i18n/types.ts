/**
 * Project Valerie: Type-Safe i18n Definitions
 * File: lib/i18n/types.ts
 * Work Item: [TASK-VAL-I18N-CORE]
 */

export type LocaleCode = "en" | "en-US" | "es" | "es-US";

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}.${P}`
    : never
  : never;

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, ...0[]];

export type NestedKeyOf<T, D extends number = 4> = [D] extends [never]
  ? never
  : T extends object
  ? {
      [K in keyof T]-?: K extends string | number
        ? T[K] extends string
          ? `${K}`
          : T[K] extends readonly unknown[]
          ? never
          : T[K] extends object
          ? Join<K, NestedKeyOf<T[K], Prev[D]>>
          : never
        : never;
    }[keyof T]
  : never;

export type TranslationParams = Record<string, string | number | boolean>;
