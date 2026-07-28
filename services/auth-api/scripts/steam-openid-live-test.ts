import { randomUUID } from "node:crypto";

if (process.env.CI) {
  throw new Error("live_test_disabled_in_ci");
}

const baseUrl = process.env.STEAM_OPENID_TEST_BASE_URL?.replace(/\/$/, "");
if (!baseUrl || new URL(baseUrl).protocol !== "https:") {
  throw new Error("STEAM_OPENID_TEST_BASE_URL_must_be_public_https");
}

const deviceId = `live-${randomUUID()}`;
const startedResponse = await fetch(`${baseUrl}/v1/auth/steam/start`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ deviceId })
});
if (!startedResponse.ok) {
  throw new Error(`auth_start_failed_${startedResponse.status}`);
}
const started = await startedResponse.json() as {
  authRequestId: string;
  pollSecret: string;
  steamLoginUrl: string;
  expiresAt: string;
  pollingInterval: number;
};

process.stdout.write(
  [
    `Auth request: ${started.authRequestId}`,
    `Polling interval: ${started.pollingInterval}ms`,
    `Open this URL in your external browser:\n${started.steamLoginUrl}`,
    "The poll secret is held in process memory and is not printed."
  ].join("\n") + "\n"
);

while (Date.now() < Date.parse(started.expiresAt)) {
  await delay(started.pollingInterval);
  const response = await fetch(`${baseUrl}/v1/auth/steam/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      authRequestId: started.authRequestId,
      pollSecret: started.pollSecret,
      deviceId
    })
  });
  if (response.status === 429) continue;
  const result = await response.json() as {
    status?: string;
    error?: string;
    errorCode?: string;
  };
  const status = result.status ?? result.error ?? "unknown";
  process.stdout.write(`Status: ${status}\n`);
  if (status !== "pending") process.exit(status === "verified" ? 0 : 1);
}

process.stdout.write("Status: expired\n");
process.exit(1);

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
