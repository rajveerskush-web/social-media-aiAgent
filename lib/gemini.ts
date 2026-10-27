import "server-only";
import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

/** Lazily create one server-side Gemini client for the running process. */
export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Keep one Gemini attempt within the route's response budget. The chat UI has
// an explicit retry action for transient failures, so the SDK must not hide
// several unbounded retries inside a single request.
export const GEMINI_REQUEST_TIMEOUT_MS = 25_000;

