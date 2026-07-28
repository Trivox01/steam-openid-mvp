import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createRouter } from "../src/router.ts";

test("health endpoint returns a non-cacheable service status", async () => {
  const server = createServer(createRouter());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      service: "achievement-nexus-auth-api",
      status: "ok",
      version: "0.2.0-beta.0"
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
});
