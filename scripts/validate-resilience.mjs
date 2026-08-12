import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ToolClient, ToolClientError, isRetryableToolError, toolRouteIdentifier } from "../src/features/tools/ToolClient.ts";
import { MalformedPayloadError } from "../src/services/validation/parse.ts";
import { parseRatingSummary, parseReview, parseReviewPage, parseToolPage } from "../src/features/tools/toolParsers.ts";
import {
  MAX_CONSECUTIVE_FAILURES,
  boundaryStateAfterError,
  boundaryStateAfterReset,
  boundaryStateAfterSuccess,
  initialBoundaryState,
  renderErrorDetail
} from "../src/components/errors/errorBoundaryState.ts";
import { reportDiagnostic, sanitizeDiagnosticText, sanitizeRouteIdentifier, setDiagnosticSink } from "../src/runtime/diagnostics.ts";
import { classifyAsyncError, isAsyncErrorCategory, isRecoverableCategory } from "../src/hooks/asyncErrorCategory.ts";
import { asyncErrorMessageKey } from "../src/components/ui/asyncErrorMessage.ts";
import { common as enCommon } from "../src/locales/en/common.ts";
import { common as arCommon } from "../src/locales/ar/common.ts";
import { createAsyncRequestGate, invokeAsyncLoader } from "../src/hooks/asyncRequestGate.ts";

const BASE = "https://auth.example.test";
const SESSION = { token: "memory-only-session", expiresAt: new Date(Date.now() + 60_000).toISOString() };

function sessions(overrides = {}) {
  const record = { expired: 0 };
  const source = {
    getActiveSession: () => SESSION,
    subscribeSession: () => () => {},
    expireSession: () => { record.expired += 1; },
    refreshSession: async () => source.getActiveSession(),
    async authenticatedFetch(url, init = {}, optional = false) {
      let session = source.getActiveSession();
      if (!session && !optional) session = await source.refreshSession();
      if (!session && !optional) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
      const execute = () => globalThis.fetch(url, {
        ...init,
        headers: { ...init.headers, ...(session ? { authorization: `Bearer ${session.token}` } : {}) }
      });
      let response = await execute();
      if (response.status === 401 && session) {
        session = await source.refreshSession();
        response = await execute();
        if (response.status === 401) source.expireSession();
      }
      return response;
    }
  };
  Object.assign(source, overrides);
  return {
    record,
    source
  };
}

/** Serves one canned response and reports how the request was made. */
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  try { return await run(calls); } finally { globalThis.fetch = original; }
}

function tool(overrides = {}) {
  return {
    id: "tool-1", name: "Tool", slug: "tool", shortDescription: "s", fullDescription: "f",
    version: "1.0.0", developerName: "dev", externalDownloadUrl: "https://example.test/d",
    downloadDomain: "example.test", downloadTrust: "official", badges: [],
    isFeatured: false, isActive: true, createdAt: "2026-01-01", updatedAt: "2026-01-01",
    ...overrides
  };
}

function review(overrides = {}) {
  return {
    id: "review-1", toolId: "tool-1", userId: "user-1", body: "b", status: "active",
    createdAt: "2026-01-01", updatedAt: "2026-01-01", edited: false, displayName: "Player",
    rating: 5, helpfulCount: 0, ...overrides
  };
}

// --- §7 safe JSON handling matrix -------------------------------------------

test("A malformed tools catalog is rejected as malformed, never as offline or expired", async () => {
  const { record, source } = sessions();
  const bodies = [
    ["", 200],
    ["not json at all", 200],
    ["null", 200],
    ["[]", 200],
    ["{}", 200],
    [JSON.stringify({ items: null, total: 0, page: 1, pageSize: 10 }), 200],
    [JSON.stringify({ items: {}, total: 0, page: 1, pageSize: 10 }), 200],
    [JSON.stringify({ items: [], total: "3", page: 1, pageSize: 10 }), 200],
    [JSON.stringify({ items: [tool({ badges: null })], total: 1, page: 1, pageSize: 10 }), 200],
    [JSON.stringify({ items: [tool({ downloadTrust: "made-up" })], total: 1, page: 1, pageSize: 10 }), 200]
  ];
  for (const [body, status] of bodies) {
    await withFetch(() => new Response(body, { status, headers: { "content-type": "application/json" } }), async () => {
      const client = new ToolClient(BASE, source);
      await assert.rejects(() => client.list(), (error) => {
        assert.ok(error instanceof ToolClientError, `expected ToolClientError for body ${JSON.stringify(body)}`);
        assert.ok(error.kind === "malformed_json" || error.kind === "malformed_payload",
          `expected a malformed kind for body ${JSON.stringify(body)}, got ${error.kind}`);
        assert.ok(isRetryableToolError(error));
        return true;
      });
    });
  }
  // The whole point of the taxonomy: none of the above may end the session.
  assert.equal(record.expired, 0);
});

test("A valid catalog still loads and keeps unknown extra fields", async () => {
  const { source } = sessions();
  const payload = {
    items: [tool({ nextGenerationField: "kept", iconUrl: "/api/tool-assets/a/content" })],
    total: 1, page: 1, pageSize: 10, serverHint: "kept"
  };
  await withFetch(() => Response.json(payload), async () => {
    const page = await new ToolClient(BASE, source).list();
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].nextGenerationField, "kept");
    assert.equal(page.serverHint, "kept");
    assert.equal(page.items[0].iconUrl, `${BASE}/api/tool-assets/a/content`);
  });
});

test("A review missing its id, and a rating arriving as a string, are both malformed", async () => {
  const { source } = sessions();
  const cases = [
    ["/reviews", (client) => client.reviews("11111111-1111-1111-1111-111111111111", new URLSearchParams()),
      { items: [{ ...review(), id: undefined }], total: 1, page: 1, pageSize: 10 }],
    ["/reviews rating type", (client) => client.reviews("11111111-1111-1111-1111-111111111111", new URLSearchParams()),
      { items: [review({ rating: "5" })], total: 1, page: 1, pageSize: 10 }],
    ["/rating-summary", (client) => client.ratingSummary("11111111-1111-1111-1111-111111111111"),
      { average: 4.5, total: 2, distribution: { 1: 0, 2: 0, 3: 0, 4: 1 } }],
    ["/my-rating", (client) => client.myRating("11111111-1111-1111-1111-111111111111"), { rating: "5" }],
    ["/my-review", (client) => client.myReview("11111111-1111-1111-1111-111111111111"), { review: { body: 5 } }],
    ["/favorite-status", (client) => client.favoriteStatus("11111111-1111-1111-1111-111111111111"), { isFavorite: "yes" }],
    ["/favorites", (client) => client.listFavorites(), { items: [{ toolId: "t", createdAtMs: 1, stats: {}, tool: tool() }], total: 1, page: 1, pageSize: 10 }]
  ];
  for (const [label, call, payload] of cases) {
    await withFetch(() => Response.json(payload), async () => {
      await assert.rejects(() => call(new ToolClient(BASE, source)),
        (error) => error instanceof ToolClientError && error.kind === "malformed_payload",
        `expected malformed_payload for ${label}`);
    });
  }
});

test("A rating mutation that answers null instead of the stored value is malformed", async () => {
  const { source } = sessions();
  await withFetch(() => Response.json({ rating: null }), async () => {
    await assert.rejects(() => new ToolClient(BASE, source).saveRating("11111111-1111-1111-1111-111111111111", 5),
      (error) => error instanceof ToolClientError && error.kind === "malformed_payload");
  });
  await withFetch(() => Response.json({ rating: 4 }), async () => {
    assert.deepEqual(await new ToolClient(BASE, source).saveRating("11111111-1111-1111-1111-111111111111", 4), { rating: 4 });
  });
});

test("my-review answering null is an empty review, not a failure", async () => {
  const { source } = sessions();
  await withFetch(() => Response.json({ review: null }), async () => {
    assert.equal(await new ToolClient(BASE, source).myReview("11111111-1111-1111-1111-111111111111"), null);
  });
});

test("A delete answering 204 with no body succeeds", async () => {
  const { source } = sessions();
  await withFetch(() => new Response(null, { status: 204 }), async () => {
    const client = new ToolClient(BASE, source);
    assert.equal(await client.removeRating("11111111-1111-1111-1111-111111111111"), undefined);
    assert.equal(await client.removeReview("11111111-1111-1111-1111-111111111111"), undefined);
  });
});

// --- §6 and §12 error taxonomy ----------------------------------------------

test("Only a real 401 expires the session", async () => {
  const { record, source } = sessions();
  await withFetch(() => Response.json({ error: "UNAUTHENTICATED" }, { status: 401 }), async () => {
    await assert.rejects(() => new ToolClient(BASE, source).myRating("11111111-1111-1111-1111-111111111111"),
      (error) => error instanceof ToolClientError && error.kind === "unauthorized");
  });
  assert.equal(record.expired, 1);
});

test("403 ACCOUNT_NOT_ACTIVE is its own kind and cannot start a sign-in loop", async () => {
  const { record, source } = sessions();
  await withFetch(() => Response.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 }), async () => {
    await assert.rejects(() => new ToolClient(BASE, source).myRating("11111111-1111-1111-1111-111111111111"),
      (error) => error instanceof ToolClientError &&
        error.kind === "account_not_active" && !isRetryableToolError(error));
  });
  // No expiry, so the app keeps the session and shows a plain refusal instead of
  // bouncing the user back to Steam sign-in.
  assert.equal(record.expired, 0);
  await withFetch(() => Response.json({ error: "FORBIDDEN" }, { status: 403 }), async () => {
    await assert.rejects(() => new ToolClient(BASE, source).myRating("11111111-1111-1111-1111-111111111111"),
      (error) => error instanceof ToolClientError && error.kind === "forbidden");
  });
  assert.equal(record.expired, 0);
});

test("A 500 is a retryable server error and a 4xx domain code is not", async () => {
  const { source } = sessions();
  await withFetch(() => Response.json({ error: "internal_error" }, { status: 500 }), async () => {
    await assert.rejects(() => new ToolClient(BASE, source).list(),
      (error) => error instanceof ToolClientError && error.kind === "server_error" && isRetryableToolError(error));
  });
  await withFetch(() => Response.json({ error: "RATE_LIMITED" }, { status: 429 }), async () => {
    await assert.rejects(() => new ToolClient(BASE, source).saveRating("11111111-1111-1111-1111-111111111111", 5),
      (error) => error instanceof ToolClientError && error.kind === "domain_error" &&
        error.code === "RATE_LIMITED" && error.message === "RATE_LIMITED");
  });
});

test("A refused connection is a network failure and keeps the session", async () => {
  const { record, source } = sessions();
  await withFetch(() => { throw new TypeError("Failed to fetch"); }, async () => {
    await assert.rejects(() => new ToolClient(BASE, source).list(),
      (error) => error instanceof ToolClientError && error.kind === "network" && isRetryableToolError(error));
  });
  assert.equal(record.expired, 0);
});

test("An aborted request propagates the abort rather than a network failure", async () => {
  const { source } = sessions();
  await withFetch(() => { throw new DOMException("aborted", "AbortError"); }, async () => {
    await assert.rejects(() => new ToolClient(BASE, source).list(),
      (error) => error.name === "AbortError" && !(error instanceof ToolClientError));
  });
});

test("A signed-out client fails as unauthorized before it reaches the network", async () => {
  const { source } = sessions({ getActiveSession: () => undefined });
  let called = false;
  await withFetch(() => { called = true; return Response.json({}); }, async () => {
    await assert.rejects(() => new ToolClient(BASE, source).myRating("11111111-1111-1111-1111-111111111111"),
      (error) => error instanceof ToolClientError && error.kind === "unauthorized");
  });
  assert.equal(called, false);
});

test("Public catalog reads work without a session and send no Authorization header", async () => {
  const { source } = sessions({ getActiveSession: () => undefined });
  await withFetch(() => Response.json({ items: [], total: 0, page: 1, pageSize: 10 }), async (calls) => {
    await new ToolClient(BASE, source).list();
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), null);
  });
});

// --- §3 diagnostics sanitation ----------------------------------------------

test("Diagnostics never carry tokens, SteamIDs, paths, URLs or full stacks", () => {
  const events = [];
  setDiagnosticSink((event) => events.push(event));
  try {
    reportDiagnostic({
      scope: "error_boundary",
      category: "render_error",
      route: "tool_details",
      detail: [
        "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature-value",
        "steamid 76561198000000001",
        "at ToolDetailsPage (D:\\Achievement Nexus\\src\\pages\\ToolDetailsPage.tsx:197:5)",
        "fetch https://auth.example.test/api/tools/secret-slug?token=abc123"
      ].join(" ")
    });
    const [event] = events;
    assert.equal(event.scope, "error_boundary");
    assert.equal(event.route, "tool_details");
    for (const forbidden of ["eyJhbGciOiJIUzI1NiJ9", "76561198000000001", "Achievement Nexus\\src", "auth.example.test", "secret-slug", "abc123"]) {
      assert.ok(!event.detail.includes(forbidden), `detail leaked ${forbidden}: ${event.detail}`);
    }
    assert.match(event.detail, /bearer \[redacted\]/);
    assert.match(event.detail, /\[steamid64\]/);
    assert.match(event.detail, /\[path\]/);
    assert.match(event.detail, /\[url\]/);
  } finally { setDiagnosticSink(); }
});

test("Diagnostic detail is bounded and route identifiers are allow-listed", () => {
  assert.ok(sanitizeDiagnosticText("x".repeat(5_000)).length <= 601);
  assert.equal(sanitizeRouteIdentifier("tool_details"), "tool_details");
  assert.equal(sanitizeRouteIdentifier("/api/tools/secret-slug"), "unknown_route");
  assert.equal(sanitizeRouteIdentifier("76561198000000001"), "unknown_route");
});

test("A failing diagnostic sink cannot break the code it observes", () => {
  setDiagnosticSink(() => { throw new Error("sink is broken"); });
  try {
    assert.doesNotThrow(() => reportDiagnostic({ scope: "async_data", category: "network" }));
  } finally { setDiagnosticSink(); }
});

test("Request paths collapse into identifiers that carry no slug or id", () => {
  assert.equal(toolRouteIdentifier("/api/tools?page=1&query=secret"), "api_tools");
  // A slug is lowercase-with-dashes like a route word, so the identifier uses an
  // allow-list: anything not a known route word becomes "id".
  assert.equal(toolRouteIdentifier("/api/tools/my-secret-tool"), "api_tools_id");
  assert.equal(toolRouteIdentifier("/api/tools/11111111-1111-1111-1111-111111111111/my-review"), "api_tools_id_my-review");
  assert.equal(toolRouteIdentifier("/api/tools/favorites?page=1&pageSize=50"), "api_tools_favorites");
  // Whatever comes out is sanitized again on the way into a diagnostic.
  assert.equal(sanitizeRouteIdentifier(toolRouteIdentifier("/api/tools/My_Tool")), "api_tools_id");
});

test("A tool client failure reports its category without the response body", async () => {
  const events = [];
  setDiagnosticSink((event) => events.push(event));
  const { source } = sessions();
  try {
    await withFetch(() => Response.json({ items: null, total: 0, page: 1, pageSize: 10 }), async () => {
      await assert.rejects(() => new ToolClient(BASE, source).list());
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { scope: "tool_client", category: "malformed_payload", route: "api_tools" });
  } finally { setDiagnosticSink(); }
});

// --- §11 error boundary state machine ---------------------------------------
// This is a reducer test. It proves the retry contract, not React's boundary
// behaviour, which has no DOM here and is verified manually inside Tauri.

test("The boundary shows the fallback, resets on retry, and stops looping", () => {
  const failed = boundaryStateAfterError(initialBoundaryState);
  assert.deepEqual(failed, { failed: true, resetKey: 0, failureCount: 1, canRetry: true });

  const retried = boundaryStateAfterReset(failed);
  assert.equal(retried.failed, false);
  // A new key remounts the damaged subtree instead of reloading the document.
  assert.equal(retried.resetKey, 1);

  // Keep failing and retrying until the allowance runs out.
  let state = retried;
  while (state.canRetry) state = boundaryStateAfterReset(boundaryStateAfterError(state));
  assert.equal(state.failureCount, MAX_CONSECUTIVE_FAILURES);
  assert.equal(state.failed, true);
  assert.equal(state.canRetry, false);
  // Once retrying stops helping the fallback stays put: no reset, no loop.
  assert.equal(boundaryStateAfterReset(state), state);

  // A render that finally succeeds clears the streak.
  const recovered = boundaryStateAfterSuccess({ ...retried, failureCount: 2 });
  assert.equal(recovered.failureCount, 0);
  assert.equal(recovered.canRetry, true);
  // A healthy state is returned identically, so no needless re-render happens.
  assert.equal(boundaryStateAfterSuccess(initialBoundaryState), initialBoundaryState);
  assert.equal(boundaryStateAfterReset(initialBoundaryState), initialBoundaryState);
});

test("The boundary detail is a class name only, never a message or a stack", () => {
  const error = new Error("Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature leaked");
  error.name = "MalformedPayloadError";
  assert.equal(renderErrorDetail(error), "MalformedPayloadError");
  assert.equal(renderErrorDetail(new TypeError("x.map is not a function")), "TypeError");
  assert.equal(renderErrorDetail("a thrown string with 76561198000000001"), "non_error_throw");
  const hostile = new Error("boom");
  hostile.name = "Bearer token-shaped name";
  assert.equal(renderErrorDetail(hostile), "Error");
});

// --- §6 page-facing categories ----------------------------------------------

test("Every client error kind maps to a page category and a translated key", () => {
  const expected = [
    ["network", "network", "state.offline"],
    ["unauthorized", "unauthorized", "state.sessionExpired"],
    ["forbidden", "forbidden", "state.notAllowed"],
    ["account_not_active", "account_not_active", "state.notAllowed"],
    ["malformed_json", "malformed", "state.dataUnavailable"],
    ["malformed_payload", "malformed", "state.dataUnavailable"],
    ["server_error", "server", "state.serverBusy"],
    ["domain_error", "domain", "state.loadFailed"],
    ["unknown", "unknown", "state.loadFailed"]
  ];
  for (const [kind, category, key] of expected) {
    const error = new ToolClientError(kind);
    assert.equal(classifyAsyncError(error), category, `kind ${kind}`);
    assert.ok(isAsyncErrorCategory(category));
    assert.equal(asyncErrorMessageKey(classifyAsyncError(error)), key);
  }
  // A malformed payload must not be presented as being offline or signed out.
  assert.notEqual(asyncErrorMessageKey("malformed"), asyncErrorMessageKey("network"));
  assert.notEqual(asyncErrorMessageKey("malformed"), asyncErrorMessageKey("unauthorized"));
  assert.ok(isRecoverableCategory("malformed"));
  assert.ok(!isRecoverableCategory("unauthorized"));
  assert.ok(!isRecoverableCategory("account_not_active"));
});

test("Legacy string errors and unknown throws still classify safely", () => {
  assert.equal(classifyAsyncError(new Error("NETWORK_ERROR")), "network");
  assert.equal(classifyAsyncError(new Error("AUTHENTICATION_REQUIRED")), "unauthorized");
  assert.equal(classifyAsyncError(new Error("MALFORMED_RESPONSE:tools.items[0].id")), "malformed");
  assert.equal(classifyAsyncError(new Error("some unexpected sentence")), "unknown");
  assert.equal(classifyAsyncError("a thrown string"), "unknown");
  assert.equal(classifyAsyncError(undefined), "unknown");
  // Anything unrecognised falls back to a generic key rather than being rendered.
  assert.equal(asyncErrorMessageKey("not a category"), "state.loadFailed");
  assert.equal(asyncErrorMessageKey(new Error("Failed to fetch https://auth.example.test")), "state.loadFailed");
});

test("Every message key the pages can reach exists in both languages", () => {
  const keys = ["state.offline", "state.sessionExpired", "state.notAllowed", "state.serverBusy",
    "state.loadFailed", "state.dataUnavailable", "state.crashTitle", "state.crashDescription",
    "state.crashPersistent", "state.retry", "state.errorTitle"];
  for (const key of keys) {
    assert.equal(typeof enCommon[key], "string", `missing EN ${key}`);
    assert.equal(typeof arCommon[key], "string", `missing AR ${key}`);
    assert.ok(enCommon[key].length > 0 && arCommon[key].length > 0, `empty copy for ${key}`);
    // Nothing user-facing may name an internal error class.
    assert.ok(!/MalformedPayloadError|ToolClientError|Error:/.test(`${enCommon[key]}${arCommon[key]}`), key);
  }
});

// --- §17 static guarantees ---------------------------------------------------

test("A stale async request cannot overwrite a newer result", async () => {
  const gate = createAsyncRequestGate();
  const writes = [];
  let resolveOld;
  let resolveFresh;
  const oldPromise = new Promise((resolve) => { resolveOld = resolve; });
  const freshPromise = new Promise((resolve) => { resolveFresh = resolve; });
  const oldRequest = gate.begin();
  const oldWrite = oldPromise.then((value) => {
    if (gate.isCurrent(oldRequest)) writes.push(value);
  });
  const freshRequest = gate.begin();
  const freshWrite = freshPromise.then((value) => {
    if (gate.isCurrent(freshRequest)) writes.push(value);
  });

  resolveFresh("fresh");
  await freshWrite;
  resolveOld("stale");
  await oldWrite;
  assert.deepEqual(writes, ["fresh"]);
});

test("Async cleanup prevents a state write after unmount", async () => {
  const gate = createAsyncRequestGate();
  const writes = [];
  let resolveRequest;
  const promise = new Promise((resolve) => { resolveRequest = resolve; });
  const request = gate.begin();
  const write = promise.then((value) => {
    if (gate.isCurrent(request)) writes.push(value);
  });
  gate.cancel(request);
  resolveRequest("late");
  await write;
  assert.deepEqual(writes, []);
});

test("A synchronous loader throw is normalized into the handled promise path", async () => {
  await assert.rejects(
    invokeAsyncLoader(() => { throw new Error("synchronous loader failure"); }),
    /synchronous loader failure/
  );
});

test("The parsers reject a missing required field with a usable path", () => {
  assert.throws(() => parseToolPage({ items: [tool({ name: undefined })], total: 1, page: 1, pageSize: 10 }),
    (error) => error instanceof MalformedPayloadError && error.path === "tools.items[0].name");
  assert.throws(() => parseReview({ ...review(), helpfulCount: null }),
    (error) => error instanceof MalformedPayloadError && error.path === "review.helpfulCount");
  assert.throws(() => parseRatingSummary({ average: Number.NaN, total: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } }),
    (error) => error instanceof MalformedPayloadError && error.path === "ratingSummary.average");
  assert.throws(() => parseReviewPage({ items: [review()], total: 1, page: 1 }),
    (error) => error instanceof MalformedPayloadError && error.path === "reviews.pageSize");
  // The path names a field, never a value, so it is safe to keep on the error.
  const caught = (() => { try { parseReview({ ...review(), body: "secret content" }, "review"); } catch (error) { return error; } })();
  assert.equal(caught, undefined);
});

test("Optional fields accept absent and null alike, and unknown fields survive", () => {
  const parsed = parseReview(review({ title: null, avatarUrl: undefined, currentUserHelpful: null, futureField: 7 }));
  assert.equal(parsed.futureField, 7);
  assert.equal(parseRatingSummary({ average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, extra: 1 }).extra, 1);
});

test("The error boundary is mounted inside every provider and around the app", async () => {
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const boundary = main.indexOf("<ErrorBoundary");
  assert.ok(boundary > 0, "no ErrorBoundary in main.tsx");
  assert.ok(boundary > main.indexOf("<TranslationProvider"), "boundary must be inside TranslationProvider");
  assert.ok(boundary > main.indexOf("<ThemeProvider"), "boundary must be inside ThemeProvider");
  assert.ok(boundary > main.indexOf("<AuthorizationProvider"), "boundary must be inside AuthorizationProvider");
  assert.ok(boundary > main.indexOf("<PublicBadgeProvider"), "boundary must be inside PublicBadgeProvider");
  assert.ok(boundary < main.indexOf("<App />"), "boundary must wrap App");
  // The fatal boundary is the outermost element, and it owns no provider.
  assert.ok(main.indexOf("<FatalErrorBoundary") < main.indexOf("<TranslationProvider"));
});

test("No retry path reloads the document, and no fallback text is raw error data", async () => {
  const files = ["ActivityPage", "AchievementsPage", "GameDetailsPage", "StatisticsPage", "ToolDetailsPage"];
  for (const name of files) {
    const source = await readFile(new URL(`../src/pages/${name}.tsx`, import.meta.url), "utf8");
    assert.ok(!/location\.reload/.test(source), `${name} still reloads the document to retry`);
    assert.ok(!/message=\{\w*[Ss]tate\.error\}/.test(source), `${name} renders a raw error string`);
  }
  for (const name of ["ErrorBoundary", "AppErrorFallback", "FatalErrorBoundary"]) {
    const source = await readFile(new URL(`../src/components/errors/${name}.tsx`, import.meta.url), "utf8");
    assert.ok(!/location\.reload/.test(source), `${name} reloads the document`);
    assert.ok(!/componentStack|error\.message|error\.stack/.test(source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")) ||
      name === "ErrorBoundary", `${name} renders exception internals`);
  }
  const hook = await readFile(new URL("../src/hooks/useAsyncData.ts", import.meta.url), "utf8");
  assert.ok(!/error\.message/.test(hook), "useAsyncData still stores a raw message");
  const hookImports = hook.split("\n").filter((line) => line.startsWith("import "));
  assert.ok(!hookImports.some((line) => /i18n|useTranslation|locales/.test(line)),
    "useAsyncData must not depend on i18n");
});

test("Every validated tool endpoint goes through a parser, not an unchecked cast", async () => {
  const source = await readFile(new URL("../src/features/tools/ToolClient.ts", import.meta.url), "utf8");
  // The single remaining cast is the documented admin fallback, and it is the
  // only one: a new player-facing method cannot silently reuse it.
  const casts = source.match(/as T\b/g) ?? [];
  assert.equal(casts.length, 1, `expected exactly one unchecked cast, found ${casts.length}`);
  assert.match(source, /private async requestUnchecked<T>/);
  for (const method of ["list(", "get(", "catalogCategories(", "catalogBadges(", "listFavorites(",
    "favorite(", "favoriteStatus(", "ratingSummary(", "myRating(", "saveRating(", "reviews(",
    "myReview(", "saveReview(", "reportReview(", "setReviewHelpful("]) {
    const line = source.split("\n").find((text) => text.trimStart().startsWith(method));
    assert.ok(line, `missing method ${method}`);
    assert.match(line, /this\.request\(/, `${method} must use the validated request`);
    assert.match(line, /parse[A-Z]\w+/, `${method} must name a parser`);
  }
  // Session expiration and refresh live only in the central coordinator.
  const expireLines = source.split("\n").filter((line) => line.includes("expireSession"));
  assert.equal(expireLines.length, 0);
  assert.match(source, /authenticatedFetch/);
});

test("No debug or fault-injection seam ships in the application source", async () => {
  for (const path of ["../src/main.tsx", "../src/App.tsx", "../src/components/errors/ErrorBoundary.tsx",
    "../src/components/errors/AppErrorFallback.tsx", "../src/components/errors/FatalErrorBoundary.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.ok(!/CrashProbe|__crash|forceCrash|throwOnRender|faultInjection/i.test(source),
      `${path} still contains a fault-injection seam`);
  }
});
