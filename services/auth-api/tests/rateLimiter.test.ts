import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { PollingRateLimiter, PollingRateLimitError } from "../src/security/pollingRateLimiter.ts";
import { getClientAddress } from "../src/security/requestSecurity.ts";
import type { AuthApiConfig } from "../src/config.ts";

test("enforces a window without success resetting prior abuse", () => {
  let now = 1_000;
  const limiter = new PollingRateLimiter({ minimumIntervalMs: 0, windowMs: 1_000, maxRequests: 2, now: () => now });
  limiter.assertAllowed("client");
  limiter.assertAllowed("client");
  assert.throws(() => limiter.assertAllowed("client"), PollingRateLimitError);
  now += 1_000;
  limiter.assertAllowed("client");
});

test("separates clients and evicts old or excess entries", () => {
  let now = 0;
  const limiter = new PollingRateLimiter({ minimumIntervalMs: 0, ttlMs: 100, maxEntries: 2, now: () => now });
  limiter.assertAllowed("a"); limiter.assertAllowed("b"); limiter.assertAllowed("c");
  assert.equal(limiter.size, 2);
  now = 101;
  limiter.cleanup();
  assert.equal(limiter.size, 0);
});

test("uses Render's right-most forwarded address and rejects spoof bypass", () => {
  const request = {
    headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.9" },
    socket: { remoteAddress: "10.0.0.4" }
  } as unknown as IncomingMessage;
  const config = { trustProxy: true } as AuthApiConfig;
  assert.equal(getClientAddress(request, config), "203.0.113.9");
  assert.equal(getClientAddress(request, { trustProxy: false } as AuthApiConfig), "10.0.0.4");
});
