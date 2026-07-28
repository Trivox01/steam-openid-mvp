import type { ServerResponse } from "node:http";

export const HEALTH_PATH = "/health";

export function writeHealthResponse(response: ServerResponse) {
  const body = JSON.stringify({
    service: "achievement-nexus-auth-api",
    status: "ok",
    version: "0.2.0-beta.0"
  });
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}
