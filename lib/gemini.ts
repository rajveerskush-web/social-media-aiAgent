import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

/** Lazily create one server-side Gemini client for the running process. */
export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// Bound the provider retry budget: one retry for transient HTTP or connection
// failures, with the route's timeout still applying to each attempt.
export const GEMINI_REQUEST_TIMEOUT_MS = 25_000;
export const GEMINI_REQUEST_OPTIONS = {
  timeout_ms: GEMINI_REQUEST_TIMEOUT_MS,
  retries: { strategy: "attempt-count-backoff", maxRetries: 1, retryConnectionErrors: true },
} as const;

