import type { RequestListener } from "node:http";
import { HEALTH_PATH, writeHealthResponse } from "./routes/health.ts";
import { READINESS_PATH, writeReadinessResponse } from "./routes/readiness.ts";
import {
  getSecureTransportDiagnostic,
  validatePublicAuthRequest
} from "./security/requestSecurity.ts";
import {
  createSteamAuthRouteHandler,
  type SteamAuthRouteDependencies
} from "./routes/steamAuth.ts";
import {
  applyCorsHeaders,
  handleCorsPreflight,
  safeCorsDiagnostic
} from "./security/cors.ts";

export function createRouter(
  steamAuthDependencies?: SteamAuthRouteDependencies
): RequestListener {
  const handleSteamAuth = steamAuthDependencies
    ? createSteamAuthRouteHandler(steamAuthDependencies)
    : undefined;
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === HEALTH_PATH) {
      writeHealthResponse(response);
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === READINESS_PATH &&
      steamAuthDependencies
    ) {
      await writeReadinessResponse(
        response,
        steamAuthDependencies.transactions.repository
      );
      return;
    }
    const isSteamAuthRoute =
      Boolean(handleSteamAuth) && url.pathname.startsWith("/v1/auth/steam/");
    if (isSteamAuthRoute) {
      const cors = applyCorsHeaders(
        request,
        response,
        steamAuthDependencies!.config.allowedOrigins
      );
      response.once("finish", () => {
        process.stdout.write(
          `${JSON.stringify(safeCorsDiagnostic(
            request,
            url.pathname,
            cors,
            response.statusCode
          ))}\n`
        );
      });
      if (handleCorsPreflight(request, response, cors)) return;
      try {
        validatePublicAuthRequest(request, steamAuthDependencies!.config);
      } catch {
        process.stdout.write(
          `${JSON.stringify(getSecureTransportDiagnostic(
            request,
            steamAuthDependencies!.config,
            url.pathname
          ))}\n`
        );
        const body = JSON.stringify({ error: "secure_transport_required" });
        response.writeHead(400, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(body)
        });
        response.end(body);
        return;
      }
    }
    if (handleSteamAuth && await handleSteamAuth(request, response, url)) return;
    const body = JSON.stringify({ error: "not_found" });
    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body)
    });
    response.end(body);
  };
}
