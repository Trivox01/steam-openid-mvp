/**
 * Small hand-written runtime parsers.
 *
 * The project has no validation library and this batch deliberately does not add
 * one: these follow the guard style already used by `AuthorizationClient`.
 *
 * Two rules shape every parser here:
 * - Unknown extra fields are allowed. The backend must be able to add a field
 *   without breaking a shipped client, so parsers check what they need and
 *   return the payload rather than rebuilding it.
 * - A missing or wrongly typed required field is a hard failure. Letting it
 *   through is what turns a backend change into `.map of undefined` inside
 *   render, which no page can catch.
 */

export class MalformedPayloadError extends Error {
  /** Dotted path of the first field that failed, e.g. "items[0].id". */
  readonly path: string;

  constructor(path: string) {
    super(`malformed_payload:${path}`);
    this.name = "MalformedPayloadError";
    this.path = path;
  }
}

export type Parser<T> = (value: unknown, path?: string) => T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string): never {
  throw new MalformedPayloadError(path || "value");
}

export function expectRecord(value: unknown, path = "value"): Record<string, unknown> {
  if (!isRecord(value)) fail(path);
  return value;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path);
  return value;
}

export function expectNumber(value: unknown, path: string): number {
  // NaN and Infinity break every downstream format() and comparison, so they are
  // treated as malformed rather than passed along as "numbers".
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path);
  return value;
}

export function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path);
  return value;
}

export function expectNullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  return expectNumber(value, path);
}

/** Absent and explicitly null both mean "not provided" for optional fields. */
export function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return expectString(value, path);
}

export function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return expectBoolean(value, path);
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path);
  return value;
}

export function expectArrayOf<T>(value: unknown, path: string, item: Parser<T>): T[] {
  return expectArray(value, path).map((entry, index) => item(entry, `${path}[${index}]`));
}

export function expectOneOf<T extends string>(
  value: unknown, path: string, allowed: readonly T[]
): T {
  const text = expectString(value, path);
  if (!allowed.includes(text as T)) fail(path);
  return text as T;
}

/**
 * A paged envelope. Every list endpoint in the tools API returns this shape, and
 * `items: null` was the exact failure that reached React as a TypeError.
 *
 * The validated fields are written over the original record rather than replacing
 * it, so an unknown envelope field the backend adds later survives.
 */
export function expectPage<T>(value: unknown, path: string, item: Parser<T>): {
  items: T[]; total: number; page: number; pageSize: number;
} {
  const record = expectRecord(value, path);
  return {
    ...record,
    items: expectArrayOf(record.items, `${path}.items`, item),
    total: expectNumber(record.total, `${path}.total`),
    page: expectNumber(record.page, `${path}.page`),
    pageSize: expectNumber(record.pageSize, `${path}.pageSize`)
  };
}

/** A list envelope without paging, used by the catalog category and badge reads. */
export function expectCollection<T>(value: unknown, path: string, item: Parser<T>): {
  items: T[]; total: number;
} {
  const record = expectRecord(value, path);
  return {
    ...record,
    items: expectArrayOf(record.items, `${path}.items`, item),
    total: expectNumber(record.total, `${path}.total`)
  };
}
