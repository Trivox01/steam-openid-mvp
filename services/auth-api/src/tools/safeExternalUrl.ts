import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { ToolError } from "./contracts.ts";

const blockedNames = new Set(["localhost", "localhost.localdomain"]);

export function normalizeSafeExternalUrl(value: string) {
  if (!/^[\x00-\x7F]*$/.test(value)) throw new ToolError("INVALID_TOOL_URL");
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new ToolError("INVALID_TOOL_URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new ToolError("INVALID_TOOL_URL");
  }
  const asciiHost = domainToASCII(parsed.hostname).toLowerCase();
  if (!asciiHost || asciiHost.split(".").some(label => label.startsWith("xn--")) || blockedNames.has(asciiHost) || asciiHost.endsWith(".localhost") || isPrivateHost(asciiHost)) {
    throw new ToolError("INVALID_TOOL_URL");
  }
  parsed.hostname = asciiHost;
  parsed.hash = "";
  return { url: parsed.toString(), domain: asciiHost };
}

function isPrivateHost(host: string) {
  const kind = isIP(host);
  if (kind === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
      a >= 224 || a === 100 && b >= 64 && b <= 127;
  }
  if (kind === 6) {
    const normalized = host.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:");
  }
  return host.endsWith(".local") || !host.includes(".");
}
