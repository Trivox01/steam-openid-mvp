const SAFE_LOG_CODE = /^[a-z0-9_]{1,64}$/;

export function sanitizeLogCode(value: string | undefined) {
  if (!value || !SAFE_LOG_CODE.test(value)) return "internal_error";
  return value;
}
