import fs from "node:fs";
import path from "node:path";
import { root } from "./release/versioning.mjs";

const forbiddenNames = [/\.key$/i, /\.pfx$/i, /\.p12$/i, /private.?key/i, /signing.?password/i];
const ignored = new Set(["node_modules", ".git", "dist", "target"]);
const findings = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (forbiddenNames.some((pattern) => pattern.test(entry.name))) findings.push(path.relative(root, full));
  }
}
walk(root);
if (findings.length) throw new Error(`Potential signing secrets committed: ${findings.join(", ")}`);
console.log("Release secret filename scan passed.");
