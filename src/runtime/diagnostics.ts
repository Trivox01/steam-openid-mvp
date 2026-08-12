/**
 * Sanitized in-process diagnostics.
 *
 * There is deliberately no external telemetry service: events go to the
 * development console and nowhere else. Every string passes through
 * `sanitizeDiagnosticText` first, because component stacks and error messages
 * routinely carry bundle paths, and backend failures carry URLs, bearer tokens
 * and identifiers that must never be written to a log.
 */

export type DiagnosticCategory =
  | "render_error"
  | "network"
  | "malformed_payload"
  | "unauthorized"
  | "forbidden"
  | "account_not_active"
  | "server_error"
  | "domain_error"
  | "unhandled_rejection"
  | "unknown";

export interface DiagnosticEvent {
  /** Coarse origin, e.g. "error_boundary" or "tool_client". Never user data. */
  scope: string;
  category: DiagnosticCategory;
  /** Stable route or view identifier. Never a full URL and never query strings. */
  route?: string;
  /** Already-short text such as a component stack. Sanitized again on write. */
  detail?: string;
}

export type DiagnosticSink = (event: DiagnosticEvent) => void;

const MAX_DETAIL_LENGTH = 600;

// Order matters: the narrow secrets are removed before the broad path and URL
// rules, otherwise a token inside a URL would survive as part of "[url]".
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\bbearer\s+[\w\-._~+/]+=*/gi, "bearer [redacted]"],
  [/\b7656119\d{10}\b/g, "[steamid64]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]"],
  [/[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]+)?/g, "[token]"],
  [/\b[a-z]:\\[^\s)'\"]+/gi, "[path]"],
  [/\bfile:\/\/\/[^\s)'\"]+/gi, "[path]"],
  [/https?:\/\/[^\s)'\"]*/gi, "[url]"],
  [/\/(?:src|assets|node_modules|api)\/[^\s)'\"]*/g, "[path]"],
  [/\b\d{15,}\b/g, "[id]"]
];

export function sanitizeDiagnosticText(value: string): string {
  let text = value;
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

/** Route identifiers are allow-listed shapes only, so a slug can never leak. */
export function sanitizeRouteIdentifier(value: string): string {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : "unknown_route";
}

function defaultSink(event: DiagnosticEvent) {
  const development = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  if (!development) return;
  // eslint-disable-next-line no-console
  console.error("[nexus:diagnostic]", event);
}

let sink: DiagnosticSink = defaultSink;

/** Test seam. Passing undefined restores the development-only console sink. */
export function setDiagnosticSink(next?: DiagnosticSink) {
  sink = next ?? defaultSink;
}

export function reportDiagnostic(event: DiagnosticEvent) {
  const safe: DiagnosticEvent = {
    scope: sanitizeRouteIdentifier(event.scope),
    category: event.category,
    ...(event.route ? { route: sanitizeRouteIdentifier(event.route) } : {}),
    ...(event.detail ? { detail: sanitizeDiagnosticText(event.detail) } : {})
  };
  // Diagnostics must never be able to break the code they observe.
  try { sink(safe); } catch { /* ignore */ }
}

/**
 * Diagnostics-only safety net for failures that never reach a React boundary,
 * such as a rejected promise inside a service. It observes and never renders:
 * the user-facing story stays with the error boundary and the page states.
 */
export function installGlobalErrorDiagnostics(target: Pick<Window, "addEventListener" | "removeEventListener"> = window) {
  const onError = (event: ErrorEvent) => reportDiagnostic({
    scope: "global_error", category: "render_error", detail: event.message ?? "error"
  });
  const onRejection = (event: PromiseRejectionEvent) => reportDiagnostic({
    scope: "global_error",
    category: "unhandled_rejection",
    detail: event.reason instanceof Error ? event.reason.message : String(event.reason ?? "rejection")
  });
  target.addEventListener("error", onError as EventListener);
  target.addEventListener("unhandledrejection", onRejection as EventListener);
  return () => {
    target.removeEventListener("error", onError as EventListener);
    target.removeEventListener("unhandledrejection", onRejection as EventListener);
  };
}
