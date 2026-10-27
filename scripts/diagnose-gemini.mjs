import nextEnv from "@next/env";
import { GoogleGenAI } from "@google/genai";
import { performance } from "node:perf_hooks";

nextEnv.loadEnvConfig(process.cwd());

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const timeoutMs = 25_000;

if (!apiKey) {
  console.error(JSON.stringify({ outcome: "configuration_error", category: "missing_api_key", model }));
  process.exit(2);
}

const client = new GoogleGenAI({ apiKey });
const startedAt = performance.now();

try {
  const response = await client.interactions.create(
    { model, input: "Reply only with OK.", store: false },
    { timeout_ms: timeoutMs, retries: { strategy: "none" } },
  );
  console.log(JSON.stringify({
    outcome: "success",
    category: "ok",
    model,
    durationMs: Math.round(performance.now() - startedAt),
    generatedText: Boolean(response.output_text?.trim()),
  }));
} catch (error) {
  const value = error && typeof error === "object" ? error : {};
  const googleError = value.error && typeof value.error === "object" ? value.error : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause : {};
  const rawCode = googleError.status ?? googleError.reason;
  const googleApiCode = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{1,60}$/.test(rawCode) ? rawCode : undefined;
  const status = [value.status, value.statusCode, googleError.code].find((candidate) => Number.isInteger(candidate));
  const rawMessage = typeof googleError.message === "string"
    ? googleError.message
    : typeof value.message === "string" ? value.message : "";
  const quotaExceeded = status === 429 && (googleApiCode === "RESOURCE_EXHAUSTED" || /quota|per day|daily limit/i.test(rawMessage));
  const category = quotaExceeded ? "quota_exceeded"
    : status === 429 ? "rate_limited"
      : status === 401 || status === 403 ? "access_denied"
        : status === 404 ? "model_or_endpoint_not_found"
          : typeof status === "number" && status >= 500 ? "google_server_error"
            : /timeout/i.test(String(value.name)) ? "timeout"
              : "connection_or_upstream_error";
  // This diagnostic uses a fixed, non-user prompt. Only print a provider
  // message after stripping credentials and URLs; never print the SDK object.
  const safeMessage = rawMessage
    .replace(/AIza[\w-]{20,}/g, "[REDACTED]")
    .replace(/(x-goog-api-key|authorization)\s*[:=]\s*[^\s,;]+/ig, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/g, "[URL]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
  console.error(JSON.stringify({
    outcome: "failure",
    category,
    model,
    durationMs: Math.round(performance.now() - startedAt),
    name: typeof value.name === "string" ? value.name : "Error",
    ...(safeMessage ? { message: safeMessage } : {}),
    ...(status !== undefined ? { httpStatus: status } : {}),
    ...(googleApiCode ? { googleApiCode } : {}),
    ...(typeof cause.name === "string" ? { causeName: cause.name } : {}),
  }));
  process.exitCode = 1;
}
