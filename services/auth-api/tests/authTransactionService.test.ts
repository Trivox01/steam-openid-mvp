import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthTransactionError,
  AuthTransactionService
} from "../src/auth/authTransactionService.ts";
import { InMemoryAuthTransactionRepository } from "../src/storage/authRepository.ts";

const RETURN_TO = "https://auth.achievement-nexus.test/v1/auth/steam/callback";
const START_INPUT = {
  returnToBase: RETURN_TO,
  deviceId: "desktop-device-01"
};

test("stores only a hash of the poll secret", async () => {
  const repository = new InMemoryAuthTransactionRepository();
  const service = new AuthTransactionService(repository);
  const started = await service.start(START_INPUT);
  const stored = await repository.find(started.authRequestId);
  assert.ok(stored);
  assert.notEqual(stored.pollSecretHash, started.pollSecret);
  assert.match(stored.pollSecretHash, /^[a-f0-9]{64}$/);
  assert.match(stored.deviceIdHash, /^[a-f0-9]{64}$/);
  assert.equal(stored.status, "pending");
});

test("rejects an incorrect poll secret", async () => {
  const service = new AuthTransactionService(new InMemoryAuthTransactionRepository());
  const started = await service.start(START_INPUT);
  await assert.rejects(
    service.status(started.authRequestId, "incorrect"),
    (error: unknown) => error instanceof AuthTransactionError && error.code === "invalid_poll_secret"
  );
});

test("expires transactions after the configured lifetime", async () => {
  let now = Date.parse("2026-07-28T00:00:00Z");
  const service = new AuthTransactionService(new InMemoryAuthTransactionRepository(), {
    transactionTtlMs: 5 * 60_000,
    now: () => now
  });
  const started = await service.start(START_INPUT);
  now += 5 * 60_000;
  assert.equal((await service.status(started.authRequestId, started.pollSecret)).status, "expired");
});

test("cancels a pending transaction", async () => {
  const service = new AuthTransactionService(new InMemoryAuthTransactionRepository());
  const started = await service.start(START_INPUT);
  await service.cancel(started.authRequestId, started.pollSecret);
  assert.equal((await service.status(started.authRequestId, started.pollSecret)).status, "cancelled");
});

test("consumes a verified transaction only once", async () => {
  const service = new AuthTransactionService(new InMemoryAuthTransactionRepository());
  const started = await service.start(START_INPUT);
  await service.markVerified(
    started.authRequestId,
    "76561198000000000",
    "2026-07-28T00:00:00Znonce"
  );
  assert.deepEqual(
    await service.consume(started.authRequestId, started.pollSecret),
    { steamId: "76561198000000000" }
  );
  await assert.rejects(
    service.consume(started.authRequestId, started.pollSecret),
    (error: unknown) =>
      error instanceof AuthTransactionError && error.code === "auth_request_not_verified"
  );
});

test("accepts only HTTPS return URLs without credentials", async () => {
  const service = new AuthTransactionService(new InMemoryAuthTransactionRepository());
  await assert.rejects(service.start({
    ...START_INPUT,
    returnToBase: "http://auth.example.test/callback"
  }));
  await assert.rejects(service.start({
    ...START_INPUT,
    returnToBase: "https://user:pass@auth.example.test/callback"
  }));
});
