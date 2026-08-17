import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DesktopSessionDiagnostics } from "../src/services/platform/DesktopSessionDiagnostics.ts";
import { createAppInitializationLifecycle } from "../src/services/appInitializationLifecycle.ts";

const UUIDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004"
];

function diagnosticsHarness() {
  const events = [];
  let index = 0;
  const diagnostics = new DesktopSessionDiagnostics({
    enabled: true,
    sink: (event) => events.push(event),
    processId: async () => 4242,
    now: () => "2026-08-16T12:00:00.000Z",
    randomId: () => UUIDS[index++] ?? UUIDS.at(-1)
  });
  return { diagnostics, events };
}

test("session diagnostics contain identifiers and allow-listed metadata only", async () => {
  const h = diagnosticsHarness();
  const operationId = h.diagnostics.operationId();
  h.diagnostics.record("desktop_refresh_started", operationId, { trigger: "boot_restore" });
  h.diagnostics.record("desktop_logout_started", operationId, { logoutReason: "change_account" });
  await h.diagnostics.flush();
  assert.equal(h.events.length, 2);
  assert.deepEqual(Object.keys(h.events[0]).sort(), [
    "authOperationId", "bootId", "event", "processId", "timestamp", "trigger"
  ]);
  assert.deepEqual(Object.keys(h.events[1]).sort(), [
    "authOperationId", "bootId", "event", "logoutReason", "processId", "timestamp"
  ]);
  assert.doesNotMatch(JSON.stringify(h.events), /credential|token|authorization|cookie|database|secret|steamId/i);
});

test("automatic boot reports started once and repeated autoStart as skipped", async () => {
  const h = diagnosticsHarness();
  let runs = 0;
  const lifecycle = createAppInitializationLifecycle(async () => ++runs, h.diagnostics);
  await lifecycle.autoStart();
  await lifecycle.autoStart();
  await h.diagnostics.flush();
  assert.equal(runs, 1);
  assert.deepEqual(h.events.map((event) => event.event), [
    "boot_initialization_started",
    "boot_initialization_skipped_already_started"
  ]);
});

test("diagnostic implementation exposes every required event without a free-text field", async () => {
  const source = await readFile(new URL("../src/services/platform/DesktopSessionDiagnostics.ts", import.meta.url), "utf8");
  for (const event of [
    "boot_initialization_started", "boot_initialization_skipped_already_started",
    "desktop_restore_started", "desktop_health_preflight_started",
    "desktop_health_preflight_completed", "desktop_health_preflight_exhausted",
    "desktop_refresh_started", "desktop_refresh_completed",
    "desktop_refresh_failed", "desktop_credential_write_started",
    "desktop_credential_write_succeeded", "desktop_credential_write_failed",
    "desktop_logout_started", "desktop_logout_completed"
  ]) assert.match(source, new RegExp(`\\b${event}\\b`));
  assert.doesNotMatch(source, /\b(detail|message|stack|url|credential|tokenHash|accessToken|authorizationHeader)\s*\??:/i);
});

test("Rust transport diagnostics classify failures with safe metadata in development only", async () => {
  const source = await readFile(new URL("../src-tauri/src/secure_credential.rs", import.meta.url), "utf8");
  for (const event of [
    "desktop_credential_read_started", "desktop_credential_read_succeeded",
    "desktop_credential_read_absent", "desktop_credential_read_failed",
    "desktop_refresh_transport_started", "connect_timeout", "request_timeout",
    "dns_error", "tls_error", "connection_error", "http_status",
    "response_received", "response_decode_failed", "response_validation_failed"
  ]) assert.match(source, new RegExp(`\\b${event}\\b`));
  assert.match(source, /#\[cfg\(debug_assertions\)\][\s\S]*fn log_transport_event/);
  assert.match(source, /#\[cfg\(not\(debug_assertions\)\)\][\s\S]*fn log_transport_event/);
  const logger = source.slice(
    source.indexOf("fn log_transport_event("),
    source.indexOf("fn classify_transport_error(")
  );
  assert.match(logger, /elapsedMs/);
  assert.match(logger, /bootId/);
  assert.match(logger, /authOperationId/);
  assert.match(logger, /trigger/);
  assert.doesNotMatch(logger, /\b(base_url|database_url|session_secret|authorization|token_hash|stack)\b/i);
  assert.doesNotMatch(logger, /\{error:\?\}|error_chain\(|\.to_string\(\)/);
});

test("Change Account and Sign Out pass distinct safe reasons", async () => {
  const source = await readFile(new URL("../src/components/settings/SteamOpenIdAccountSettings.tsx", import.meta.url), "utf8");
  assert.match(source, /action === "changeAccount" \? "change_account" : "user_logout"/);
});

test("silent restore runbook invalidates any account action instead of calling it double restore", async () => {
  const runbook = await readFile(new URL("../docs/testing/DESKTOP_SILENT_RESTORE_E2E.md", import.meta.url), "utf8");
  assert.match(runbook, /TEST INVALIDATED BY USER ACCOUNT ACTION/);
  assert.match(runbook, /Steam Browser opened: NO/);
  assert.match(runbook, /Login required: NO/);
  assert.match(runbook, /generation 0 -> 1 ONLY/);
  assert.match(runbook, /Do not use Logout, Change Account, Sign In, or any authentication action/i);
});
