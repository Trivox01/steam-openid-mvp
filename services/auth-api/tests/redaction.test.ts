import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeLogCode } from "../src/security/redaction.ts";

test("log error codes allow only bounded non-sensitive identifiers", () => {
  assert.equal(sanitizeLogCode("wrong_return_to"), "wrong_return_to");
  assert.equal(
    sanitizeLogCode("bad?openid.sig=secret"),
    "internal_error"
  );
  assert.equal(sanitizeLogCode("x".repeat(65)), "internal_error");
});
