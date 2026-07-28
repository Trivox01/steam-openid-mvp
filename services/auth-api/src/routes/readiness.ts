import type { ServerResponse } from "node:http";
import type { AuthTransactionRepository } from "../storage/authRepository.ts";

export const READINESS_PATH = "/ready";

export async function writeReadinessResponse(
  response: ServerResponse,
  repository: AuthTransactionRepository
) {
  try {
    await repository.validateSchema();
    write(response, 200, { status: "ready" });
  } catch {
    write(response, 503, {
      status: "not_ready",
      error: "storage_unavailable"
    });
  }
}

function write(response: ServerResponse, status: number, payload: object) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}
