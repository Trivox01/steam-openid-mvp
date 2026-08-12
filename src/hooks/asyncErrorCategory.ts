/**
 * Failure categories shared by the async page loaders.
 *
 * A category is an internal identifier: it goes to diagnostics and it selects a
 * translation key at the page boundary. It is never rendered as text, which is
 * what keeps a backend message or an exception string out of the interface.
 */
export type AsyncErrorCategory =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "account_not_active"
  | "malformed"
  | "server"
  | "domain"
  | "unknown";

const CATEGORIES: readonly AsyncErrorCategory[] = [
  "network", "unauthorized", "forbidden", "account_not_active",
  "malformed", "server", "domain", "unknown"
];

/** Error kinds that clients raise, mapped onto the page-level categories. */
const KIND_CATEGORIES: Record<string, AsyncErrorCategory> = {
  network: "network",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  account_not_active: "account_not_active",
  malformed: "malformed",
  malformed_json: "malformed",
  malformed_payload: "malformed",
  server_error: "server",
  domain_error: "domain",
  unknown: "unknown"
};

/** Legacy string codes still thrown by services that predate the taxonomy. */
const CODE_CATEGORIES: Record<string, AsyncErrorCategory> = {
  NETWORK_ERROR: "network",
  AUTHENTICATION_REQUIRED: "unauthorized",
  UNAUTHENTICATED: "unauthorized",
  PERMISSION_DENIED: "forbidden",
  FORBIDDEN: "forbidden",
  ACCOUNT_NOT_ACTIVE: "account_not_active",
  MALFORMED_RESPONSE: "malformed",
  SERVER_ERROR: "server"
};

/**
 * Classifies a thrown value without reading its message into the result.
 *
 * The `kind` property is duck-typed on purpose: this stays a leaf module with no
 * import of any client, so every caller can use it and it can be tested alone.
 */
export function classifyAsyncError(error: unknown): AsyncErrorCategory {
  if (isKeyed(error, "kind") && typeof error.kind === "string") {
    const mapped = KIND_CATEGORIES[error.kind];
    if (mapped) return mapped;
  }
  if (error instanceof Error) {
    // Only the leading code word is inspected, so a message carrying detail
    // after the code cannot influence the category or leak into it.
    const [code = ""] = error.message.split(":");
    const mapped = CODE_CATEGORIES[code.trim()];
    if (mapped) return mapped;
  }
  return "unknown";
}

/** Guards a category coming back from state, so an unexpected value stays safe. */
export function isAsyncErrorCategory(value: unknown): value is AsyncErrorCategory {
  return typeof value === "string" && CATEGORIES.includes(value as AsyncErrorCategory);
}

/** A retry can only help when the failure was not about who the user is. */
export function isRecoverableCategory(category: AsyncErrorCategory) {
  return category === "network" || category === "server" ||
    category === "malformed" || category === "unknown";
}

function isKeyed<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}
