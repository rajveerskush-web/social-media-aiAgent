import path from "node:path";
import type {
  ComputerToolContext,
  E2BDesktopSandboxLike,
  ToolExecutionResult,
} from "./computer-types.ts";
import {
  InvalidPathAccessError,
  ProhibitedCommandError,
  UnsafeNavigationError,
} from "./computer-types.ts";

async function defaultVerifyContext(context: ComputerToolContext) {
  const { verifyComputerActionContext } = await import("./computer-lifecycle.ts");
  return verifyComputerActionContext(context);
}

const APPROVED_ROOT = "/home/user";
const APPROVED_SUBDIRECTORIES = [
  "/home/user/research",
  "/home/user/assets",
  "/home/user/output",
  "/home/user",
] as const;

const SENSITIVE_SYSTEM_PREFIXES = [
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/root",
  "/var/run",
  "/boot",
  "/bin",
  "/sbin",
  "/usr",
];

const PROHIBITED_SHELL_PATTERNS = [
  /\b(?:sudo|su)\b/i,
  /\bchmod\s+(?:-[a-z]*R[a-z]*\s+)?(?:777|a\+rwx)\b/i,
  /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\s+\/(?:\s|$)/i,
  /\b(?:mkfs|fdisk|dd\s+if=)\b/i,
  /\b(?:shutdown|reboot|init\s+0|halt|poweroff)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /\/dev\/tcp\//i,
  /\bnc(?:\.traditional)?\s+-[a-z]*e\b/i,
  /\bmkfifo\b/i,
  /\bbash\s+-i\b/i,
];

const ALLOWED_COMMAND_BINARIES = new Set([
  "ls",
  "dir",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "echo",
  "pwd",
  "date",
  "node",
  "python3",
  "python",
  "npm",
  "pip",
  "curl",
  "wget",
  "jq",
  "unzip",
  "tar",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "rm",
  "wc",
  "sort",
  "uniq",
  "sed",
  "awk",
]);

/**
 * Validates target URLs to block local, loopback, private RFC-1918,
 * link-local/cloud-metadata, and non-HTTP(S) schemes.
 */
export function validateNavigationUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new UnsafeNavigationError(`Invalid URL format: "${rawUrl}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeNavigationError(
      `Protocol "${parsed.protocol}" is forbidden. Only HTTP and HTTPS are permitted.`,
    );
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // Block localhost and common local domain conventions
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".corp")
  ) {
    throw new UnsafeNavigationError(
      `Navigation to local/internal host "${hostname}" is blocked.`,
    );
  }

  // Check numeric, octal, hex, or dotted IP representations
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);
    if (octets.some((o) => o < 0 || o > 255)) {
      throw new UnsafeNavigationError(`Malformed IP address: "${hostname}"`);
    }

    const [o1, o2] = octets;

    // 127.0.0.0/8 - Loopback
    if (o1 === 127) {
      throw new UnsafeNavigationError(`Loopback IP "${hostname}" is blocked.`);
    }
    // 0.0.0.0/8 - Unspecified
    if (o1 === 0) {
      throw new UnsafeNavigationError(`Unspecified address "${hostname}" is blocked.`);
    }
    // 10.0.0.0/8 - Private
    if (o1 === 10) {
      throw new UnsafeNavigationError(`Private RFC-1918 IP "${hostname}" is blocked.`);
    }
    // 172.16.0.0/12 - Private
    if (o1 === 172 && o2 >= 16 && o2 <= 31) {
      throw new UnsafeNavigationError(`Private RFC-1918 IP "${hostname}" is blocked.`);
    }
    // 192.168.0.0/16 - Private
    if (o1 === 192 && o2 === 168) {
      throw new UnsafeNavigationError(`Private RFC-1918 IP "${hostname}" is blocked.`);
    }
    // 169.254.0.0/16 - Link-local / Cloud Metadata
    if (o1 === 169 && o2 === 254) {
      throw new UnsafeNavigationError(
        `Link-local / cloud metadata IP "${hostname}" is blocked.`,
      );
    }
    // 100.64.0.0/10 - Carrier-grade NAT
    if (o1 === 100 && o2 >= 64 && o2 <= 127) {
      throw new UnsafeNavigationError(`Carrier-grade NAT IP "${hostname}" is blocked.`);
    }
  }

  // IPv6 checks
  if (
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "::" ||
    hostname === "[::]" ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("[fe80:") ||
    hostname.startsWith("fc00:") ||
    hostname.startsWith("[fc00:") ||
    hostname.startsWith("fd00:") ||
    hostname.startsWith("[fd00:")
  ) {
    throw new UnsafeNavigationError(
      `Private/local IPv6 address "${hostname}" is blocked.`,
    );
  }

  // Check for decimal, octal, or hex obfuscated IP integer
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(hostname)) {
    throw new UnsafeNavigationError(
      `Obfuscated numeric IP "${hostname}" is blocked.`,
    );
  }

  return parsed;
}

/**
 * Validates and normalizes POSIX file paths inside the sandbox microVM.
 * Restricts all filesystem access to `/home/user` and approved subdirectories.
 */
export function validateSandboxPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new InvalidPathAccessError("Path must be a non-empty string.");
  }

  const trimmed = rawPath.trim();
  // Reject null bytes
  if (trimmed.includes("\0")) {
    throw new InvalidPathAccessError("Null bytes in path are forbidden.");
  }

  // Convert Windows backslashes to POSIX slashes for Linux microVM
  const posixPath = trimmed.replace(/\\/g, "/");

  // Normalize path resolving '.' and '..'
  const resolved = posixPath.startsWith("/")
    ? path.posix.normalize(posixPath)
    : path.posix.normalize(path.posix.join(APPROVED_ROOT, posixPath));

  // Must strictly reside inside APPROVED_ROOT
  if (!resolved.startsWith(APPROVED_ROOT)) {
    throw new InvalidPathAccessError(
      `Access outside approved directory (${APPROVED_ROOT}) is blocked: "${rawPath}"`,
    );
  }

  // Block access to sensitive system directories even if mapped inside
  for (const prefix of SENSITIVE_SYSTEM_PREFIXES) {
    if (resolved.startsWith(prefix) || resolved.includes(prefix + "/")) {
      throw new InvalidPathAccessError(
        `Access to sensitive system path "${prefix}" is blocked.`,
      );
    }
  }

  return resolved;
}

/**
 * Validates shell command strings against policy and dangerous operations.
 */
export function validateShellCommand(cmd: string, cwd?: string): {
  sanitizedCmd: string;
  sanitizedCwd: string;
} {
  if (!cmd || typeof cmd !== "string" || !cmd.trim()) {
    throw new ProhibitedCommandError("Command must be a non-empty string.");
  }

  const trimmed = cmd.trim();

  // Enforce prohibited pattern rules
  for (const pattern of PROHIBITED_SHELL_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new ProhibitedCommandError(
        `Command contains dangerous or prohibited shell pattern: ${pattern.source}`,
      );
    }
  }

  // Verify first binary is on allowed list when parseable as a simple token
  const firstWord = trimmed.split(/[\s;|>&]/)[0]?.replace(/^[\/.\w-]*\//, "");
  if (firstWord && !ALLOWED_COMMAND_BINARIES.has(firstWord)) {
    throw new ProhibitedCommandError(
      `Command binary "${firstWord}" is not in the approved command policy.`,
    );
  }

  const sanitizedCwd = cwd ? validateSandboxPath(cwd) : APPROVED_ROOT;

  return { sanitizedCmd: trimmed, sanitizedCwd };
}

/**
 * Truncates and redacts sensitive tokens from command outputs or file previews.
 */
export function redactSensitiveOutput(
  raw: string,
  maxLength = 50_000,
): string {
  if (!raw) return "";
  let redacted = raw
    .replace(/\be2b_[a-zA-Z0-9_-]{16,}\b/g, "[REDACTED_E2B_KEY]")
    .replace(/\bAIza[0-9A-Za-z-_]{35}\b/g, "[REDACTED_API_KEY]")
    .replace(/(password|token|secret|key)=(?!\[REDACTED)[^\s&]+/gi, "$1=[REDACTED]");

  if (redacted.length > maxLength) {
    redacted =
      redacted.slice(0, maxLength) + "\n... [output truncated at 50KB limit]";
  }

  return redacted;
}

export type ComputerToolDeps = {
  verifyContext?: (context: ComputerToolContext) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Action Primitives
// ---------------------------------------------------------------------------

/**
 * 1. Screenshot primitive
 */
export async function takeScreenshot(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ width?: number; height?: number }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  try {
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");
    return {
      tool: "screenshot",
      params: {},
      attempted: true,
      verified: true,
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "screenshot",
      params: {},
      attempted: true,
      verified: false,
      error,
      failureReason: "Failed to capture desktop screenshot from sandbox.",
      timestamp,
    };
  }
}

/**
 * 2. Open browser primitive
 */
export async function openBrowser(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  initialUrl?: string,
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ url?: string }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  let targetUrl: string | undefined;
  if (initialUrl) {
    targetUrl = validateNavigationUrl(initialUrl).toString();
  }

  try {
    if (targetUrl) {
      await sandbox.open(targetUrl);
    } else {
      await sandbox.launch("google-chrome");
    }

    await sandbox.wait(1000);
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "openBrowser",
      params: { initialUrl: targetUrl ?? "google-chrome" },
      attempted: true,
      verified: true,
      data: { url: targetUrl },
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "openBrowser",
      params: { initialUrl },
      attempted: true,
      verified: false,
      error,
      failureReason: "Sandbox failed to launch or open browser.",
      timestamp,
    };
  }
}

/**
 * 3. Navigate to URL primitive
 */
export async function navigateTo(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  rawUrl: string,
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ targetUrl: string }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  const validated = validateNavigationUrl(rawUrl);
  const targetUrl = validated.toString();

  try {
    await sandbox.open(targetUrl);
    await sandbox.wait(1500); // Allow initial page load to paint
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "navigateTo",
      params: { url: targetUrl },
      attempted: true,
      verified: true,
      data: { targetUrl },
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "navigateTo",
      params: { url: rawUrl },
      attempted: true,
      verified: false,
      error,
      failureReason: "Navigation instruction failed in sandbox.",
      timestamp,
    };
  }
}

/**
 * 4. Mouse click primitive (supports left, right, double click at coordinates)
 */
export async function clickMouse(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  options: {
    x?: number;
    y?: number;
    button?: "left" | "right" | "double" | "middle";
  } = {},
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ x?: number; y?: number; button: string }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  const { x, y, button = "left" } = options;

  if (x !== undefined && (!Number.isFinite(x) || x < 0)) {
    throw new Error("Invalid x coordinate: must be a non-negative number.");
  }
  if (y !== undefined && (!Number.isFinite(y) || y < 0)) {
    throw new Error("Invalid y coordinate: must be a non-negative number.");
  }

  try {
    if (button === "right") {
      await sandbox.rightClick(x, y);
    } else if (button === "double") {
      await sandbox.doubleClick(x, y);
    } else if (button === "middle" && sandbox.middleClick) {
      await sandbox.middleClick(x, y);
    } else {
      await sandbox.leftClick(x, y);
    }

    await sandbox.wait(300);
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "click",
      params: { x, y, button },
      attempted: true,
      verified: true,
      data: { x, y, button },
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "click",
      params: { x, y, button },
      attempted: true,
      verified: false,
      error,
      failureReason: "Mouse click action failed in sandbox.",
      timestamp,
    };
  }
}

/**
 * 5. Type text or key combination primitive
 */
export async function typeInput(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  input: { text?: string; key?: string | string[] },
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ hasText: boolean; hasKey: boolean }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  if (!input.text && !input.key) {
    throw new Error("Must provide either 'text' or 'key' to type.");
  }

  try {
    if (input.text) {
      await sandbox.write(input.text);
    }
    if (input.key) {
      await sandbox.press(input.key);
    }

    await sandbox.wait(300);
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "type",
      params: {
        text: input.text ? `[${input.text.length} chars]` : undefined,
        key: input.key,
      },
      attempted: true,
      verified: true,
      data: { hasText: Boolean(input.text), hasKey: Boolean(input.key) },
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "type",
      params: { key: input.key },
      attempted: true,
      verified: false,
      error,
      failureReason: "Keyboard input action failed in sandbox.",
      timestamp,
    };
  }
}

/**
 * 6. Scroll primitive (direction: 'up' | 'down', amount: number of ticks)
 */
export async function scrollDisplay(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  direction: "up" | "down" = "down",
  amount = 5,
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ direction: "up" | "down"; amount: number }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  const safeAmount = Math.max(1, Math.min(amount, 50));

  try {
    await sandbox.scroll(direction, safeAmount);
    await sandbox.wait(300);
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "scroll",
      params: { direction, amount: safeAmount },
      attempted: true,
      verified: true,
      data: { direction, amount: safeAmount },
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "scroll",
      params: { direction, amount: safeAmount },
      attempted: true,
      verified: false,
      error,
      failureReason: "Display scroll action failed in sandbox.",
      timestamp,
    };
  }
}

/**
 * 7. Drag primitive
 */
export async function dragMouse(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  from: [number, number],
  to: [number, number],
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ from: [number, number]; to: [number, number] }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  if (
    !Array.isArray(from) ||
    from.length !== 2 ||
    !Array.isArray(to) ||
    to.length !== 2 ||
    from.some((n) => !Number.isFinite(n) || n < 0) ||
    to.some((n) => !Number.isFinite(n) || n < 0)
  ) {
    throw new Error("Invalid drag coordinates: 'from' and 'to' must be non-negative [x, y] tuples.");
  }

  try {
    await sandbox.drag(from, to);
    await sandbox.wait(300);
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "drag",
      params: { from, to },
      attempted: true,
      verified: true,
      data: { from, to },
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "drag",
      params: { from, to },
      attempted: true,
      verified: false,
      error,
      failureReason: "Mouse drag action failed in sandbox.",
      timestamp,
    };
  }
}

/**
 * 8. Wait primitive (bounded between 100ms and 10,000ms)
 */
export async function waitDuration(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  ms = 1000,
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ durationMs: number }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  const safeMs = Math.max(100, Math.min(ms, 10_000));

  try {
    await sandbox.wait(safeMs);
    const bytes = await sandbox.screenshot("bytes");
    const screenshotBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "wait",
      params: { ms: safeMs },
      attempted: true,
      verified: true,
      data: { durationMs: safeMs },
      screenshotBase64,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "wait",
      params: { ms: safeMs },
      attempted: true,
      verified: false,
      error,
      failureReason: "Wait action failed in sandbox.",
      timestamp,
    };
  }
}

/**
 * 9. Shell command primitive (policy checked, timeout capped, output redacted)
 */
export async function runShellCommand(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  command: string,
  options: { cwd?: string; timeoutMs?: number; deps?: ComputerToolDeps } = {},
): Promise<
  ToolExecutionResult<{
    stdout: string;
    stderr: string;
    exitCode: number;
    cwd: string;
  }>
> {
  const timestamp = new Date().toISOString();
  await (options.deps?.verifyContext ?? defaultVerifyContext)(context);

  const { sanitizedCmd, sanitizedCwd } = validateShellCommand(
    command,
    options.cwd,
  );
  const timeoutMs = Math.min(options.timeoutMs ?? 15_000, 30_000);

  try {
    const result = await sandbox.commands.run(sanitizedCmd, {
      cwd: sanitizedCwd,
      timeoutMs,
    });

    const stdout = redactSensitiveOutput(result.stdout);
    const stderr = redactSensitiveOutput(result.stderr);
    const verified = result.exitCode === 0;

    return {
      tool: "runShell",
      params: { command: sanitizedCmd, cwd: sanitizedCwd },
      attempted: true,
      verified,
      data: {
        stdout,
        stderr,
        exitCode: result.exitCode,
        cwd: sanitizedCwd,
      },
      failureReason: verified ? undefined : `Command exited with non-zero code ${result.exitCode}`,
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "runShell",
      params: { command: sanitizedCmd, cwd: sanitizedCwd },
      attempted: true,
      verified: false,
      error,
      failureReason: "Sandbox shell execution failed or timed out.",
      timestamp,
    };
  }
}

/**
 * 10. Read file primitive (scoped to approved directories)
 */
export async function readSandboxFile(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  filePath: string,
  format: "text" | "bytes" = "text",
  deps: ComputerToolDeps = {},
): Promise<
  ToolExecutionResult<{
    path: string;
    content: string | Uint8Array;
    sizeBytes: number;
  }>
> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  const validatedPath = validateSandboxPath(filePath);

  try {
    if (format === "bytes") {
      const bytes = await sandbox.files.read(validatedPath, { format: "bytes" });
      return {
        tool: "readFile",
        params: { path: validatedPath, format },
        attempted: true,
        verified: true,
        data: {
          path: validatedPath,
          content: bytes,
          sizeBytes: bytes.byteLength,
        },
        timestamp,
      };
    }

    const text = await sandbox.files.read(validatedPath, { format: "text" });
    const redacted = redactSensitiveOutput(text);

    return {
      tool: "readFile",
      params: { path: validatedPath, format },
      attempted: true,
      verified: true,
      data: {
        path: validatedPath,
        content: redacted,
        sizeBytes: Buffer.byteLength(text, "utf8"),
      },
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "readFile",
      params: { path: validatedPath, format },
      attempted: true,
      verified: false,
      error,
      failureReason: `Failed to read file at ${validatedPath}`,
      timestamp,
    };
  }
}

/**
 * 11. Write file primitive (scoped to approved directories)
 */
export async function writeSandboxFile(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  filePath: string,
  content: string | Uint8Array,
  deps: ComputerToolDeps = {},
): Promise<ToolExecutionResult<{ path: string; sizeBytes: number }>> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  const validatedPath = validateSandboxPath(filePath);
  const sizeBytes =
    typeof content === "string"
      ? Buffer.byteLength(content, "utf8")
      : content.byteLength;

  // Max individual write size limit: 10MB
  if (sizeBytes > 10 * 1024 * 1024) {
    throw new Error("File content exceeds 10MB write limit.");
  }

  try {
    await sandbox.files.write(validatedPath, content);

    return {
      tool: "writeFile",
      params: { path: validatedPath, sizeBytes },
      attempted: true,
      verified: true,
      data: { path: validatedPath, sizeBytes },
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "writeFile",
      params: { path: validatedPath, sizeBytes },
      attempted: true,
      verified: false,
      error,
      failureReason: `Failed to write file to ${validatedPath}`,
      timestamp,
    };
  }
}

/**
 * 12. Download file primitive (reads bytes from sandbox, verifies existence and size)
 */
export async function downloadSandboxFile(
  sandbox: E2BDesktopSandboxLike,
  context: ComputerToolContext,
  filePath: string,
  deps: ComputerToolDeps = {},
): Promise<
  ToolExecutionResult<{
    filename: string;
    sandboxPath: string;
    bytesBase64: string;
    sizeBytes: number;
    mimeType: string;
  }>
> {
  const timestamp = new Date().toISOString();
  await (deps.verifyContext ?? defaultVerifyContext)(context);

  const validatedPath = validateSandboxPath(filePath);
  const filename = path.posix.basename(validatedPath);

  // Simple mime detection
  const ext = path.posix.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
  };
  const mimeType = mimeMap[ext] ?? "application/octet-stream";

  try {
    const bytes = await sandbox.files.read(validatedPath, { format: "bytes" });
    if (!bytes || bytes.byteLength === 0) {
      return {
        tool: "downloadFile",
        params: { path: validatedPath },
        attempted: true,
        verified: false,
        failureReason: "File exists but is empty (0 bytes).",
        timestamp,
      };
    }

    // Verify image data integrity if downloading an image
    if (mimeType.startsWith("image/")) {
      const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const isWebp = bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
      const isGif = bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;

      if (!isPng && !isJpeg && !isWebp && !isGif) {
        return {
          tool: "downloadFile",
          params: { path: validatedPath },
          attempted: true,
          verified: false,
          failureReason: `Downloaded file "${filename}" is marked as ${mimeType} but does not contain valid image bytes.`,
          timestamp,
        };
      }
    }

    const bytesBase64 = Buffer.from(bytes).toString("base64");

    return {
      tool: "downloadFile",
      params: { path: validatedPath },
      attempted: true,
      verified: true,
      data: {
        filename,
        sandboxPath: validatedPath,
        bytesBase64,
        sizeBytes: bytes.byteLength,
        mimeType,
      },
      timestamp,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      tool: "downloadFile",
      params: { path: validatedPath },
      attempted: true,
      verified: false,
      error,
      failureReason: `Failed to download file from ${validatedPath}`,
      timestamp,
    };
  }
}
