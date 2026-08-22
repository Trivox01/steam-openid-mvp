import assert from "node:assert/strict";
import fs from "node:fs";
import { validateNexusPlatformFoundation } from "../src/domain/nexus/validation.ts";

const assertions = validateNexusPlatformFoundation();
assert.ok(assertions >= 30, "the new domain contracts must be covered by focused assertions");

// Phase 1 boundary guards. The foundation stays design-only.
const rootPackage = fs.readFileSync("package.json", "utf8");
const backendPackage = fs.readFileSync("services/auth-api/package.json", "utf