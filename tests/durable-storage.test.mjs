import assert from "node:assert/strict";
import test from "node:test";
import {
  ArtifactStorageError,
  buildArtifactStorageKey,
  createStorageDriver,
  ImageKitArtifactDriver,
  LocalFilesystemArtifactDriver,
  persistDurableArtifact,
  retrieveDurableArtifact,
} from "../lib/durable-storage.ts";
import { downloadArtifactService } from "../lib/computer-service.ts";

// ---------------------------------------------------------------------------
// In-Memory Driver for deterministic unit tests
// ---------------------------------------------------------------------------

function createInMemoryStorageDriver() {
  const store = new Map();
  return {
    driverName: "in-memory",
    async saveArtifact(key, data, mimeType) {
      if (!data || data.length === 0) {
        throw new ArtifactStorageError("Empty data", "EMPTY_DATA");
      }
      store.set(key, { data, mimeType });
      return {
        storageKey: key,
        sizeBytes: data.length,
        hash: "mock-hash-" + data.length,
      };
    },
    async getArtifact(key) {
      const item = store.get(key);
      return item ? item.data : null;
    },
    async hasArtifact(key) {
      return store.has(key);
    },
    async deleteArtifact(key) {
      return store.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: Durable Storage Driver & Key Resolution
// ---------------------------------------------------------------------------

test("buildArtifactStorageKey generates scoped, safe key without path traversal", () => {
  const key = buildArtifactStorageKey(101, 501, 901, "../../../etc/passwd");
  assert.equal(key, "campaign_101/task_501/art_901_passwd");
  assert.ok(!key.includes(".."));
});

test("LocalFilesystemArtifactDriver detects and blocks path traversal keys", async () => {
  const driver = new LocalFilesystemArtifactDriver();
  await assert.rejects(
    async () =>
      driver.saveArtifact("../../../root/sensitive.txt", new Uint8Array([1, 2, 3]), "text/plain"),
    ArtifactStorageError,
  );
});

test("persistDurableArtifact rejects empty (0-byte) content", async () => {
  const driver = createInMemoryStorageDriver();
  await assert.rejects(
    async () =>
      persistDurableArtifact(101, 501, 901, "empty.txt", "text/plain", new Uint8Array([]), driver),
    ArtifactStorageError,
  );
});

test("persistDurableArtifact stores file and retrieveDurableArtifact returns identical bytes", async () => {
  const driver = createInMemoryStorageDriver();
  const testBytes = new TextEncoder().encode("# Verified Competitor Analysis\nFindings: SOTO AI leads in computer control.");

  const persisted = await persistDurableArtifact(
    101,
    501,
    901,
    "analysis.md",
    "text/markdown",
    testBytes,
    driver,
  );

  assert.equal(persisted.isDurable, true);
  assert.equal(persisted.sizeBytes, testBytes.length);

  const retrieved = await retrieveDurableArtifact(
    101,
    501,
    901,
    "analysis.md",
    driver,
  );

  assert.ok(retrieved);
  assert.deepEqual(retrieved, testBytes);
});

// ---------------------------------------------------------------------------
// Tests: Surviving Sandbox Termination via Durable Storage
// ---------------------------------------------------------------------------

test("downloadArtifactService successfully serves file from durable storage when sandbox is stopped", async () => {
  const driver = createInMemoryStorageDriver();
  const fileContent = "Durable report content that survived microVM termination.";
  const fileBytes = new TextEncoder().encode(fileContent);

  // Pre-seed durable storage
  await persistDurableArtifact(
    101,
    501,
    901,
    "durable_report.txt",
    "text/plain",
    fileBytes,
    driver,
  );

  // Mock DB where computer sandbox is stopped
  const mockDb = {
    async findCampaign(authUserId, campaignId) {
      if (authUserId !== "user-alpha" || campaignId !== 101) return null;
      return { id: 101, authUserId: "user-alpha", name: "Campaign Q4", status: "active" };
    },
    async findArtifact(authUserId, campaignId, artifactId) {
      if (artifactId !== 901) return null;
      return {
        id: 901,
        taskId: 501,
        campaignId: 101,
        authUserId: "user-alpha",
        filename: "durable_report.txt",
        mimeType: "text/plain",
        sizeBytes: fileBytes.length,
        sandboxPath: "/home/user/output/durable_report.txt",
        isVerified: true,
      };
    },
    async findComputer() {
      // Sandbox is STOPPED
      return { id: 1, agentId: "seat-1", status: "stopped", sandboxId: null };
    },
  };

  // Calling downloadArtifactService with NO running sandbox
  const res = await downloadArtifactService("user-alpha", 901, 101, {
    db: mockDb,
    storageDriver: driver,
    getActiveSandbox: () => undefined, // Sandbox is gone
  });

  assert.equal(res.filename, "durable_report.txt");
  assert.equal(res.sizeBytes, fileBytes.length);
  assert.deepEqual(res.bytes, fileBytes);
});

// ---------------------------------------------------------------------------
// Tests: ImageKit Asset Storage Driver & Provider Selection
// ---------------------------------------------------------------------------

test("ImageKit driver: throws clear error when private key is missing", () => {
  assert.throws(
    () => new ImageKitArtifactDriver({ privateKey: "", urlEndpoint: "https://ik.imagekit.io/test" }),
    (err) => err instanceof ArtifactStorageError && err.code === "MISSING_PRIVATE_KEY",
  );
});

test("ImageKit driver: throws clear error when urlEndpoint is missing", () => {
  assert.throws(
    () => new ImageKitArtifactDriver({ privateKey: "priv_key_123", urlEndpoint: "" }),
    (err) => err instanceof ArtifactStorageError && err.code === "MISSING_URL_ENDPOINT",
  );
});

test("ImageKit driver: successfully uploads asset via REST API and returns publicUrl and fileId", async () => {
  let requestHeaders = null;
  let requestBody = null;

  const mockFetch = async (url, opts) => {
    requestHeaders = opts.headers;
    requestBody = opts.body;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          fileId: "ik_file_abc123",
          name: "banner.png",
          url: "https://ik.imagekit.io/test/campaign_101/task_501/banner.png",
          size: 1024,
        };
      },
    };
  };

  const driver = new ImageKitArtifactDriver({
    privateKey: "private_test_key_xyz",
    urlEndpoint: "https://ik.imagekit.io/test",
    fetchFn: mockFetch,
  });

  const testBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
  const res = await driver.saveArtifact("campaign_101/task_501/banner.png", testBytes, "image/png");

  assert.equal(res.publicUrl, "https://ik.imagekit.io/test/campaign_101/task_501/banner.png");
  assert.equal(res.fileId, "ik_file_abc123");
  assert.equal(res.sizeBytes, 1024);
  assert.ok(res.hash);

  // Verify auth header uses HTTP Basic with base64 encoded privateKey
  assert.ok(requestHeaders?.Authorization);
  assert.equal(
    requestHeaders.Authorization,
    `Basic ${Buffer.from("private_test_key_xyz:").toString("base64")}`,
  );
});

test("ImageKit driver: handles 401/403 authentication failures gracefully", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    async text() {
      return '{"message":"Your account cannot be authenticated"}';
    },
  });

  const driver = new ImageKitArtifactDriver({
    privateKey: "invalid_key",
    urlEndpoint: "https://ik.imagekit.io/test",
    fetchFn: mockFetch,
  });

  await assert.rejects(
    async () => driver.saveArtifact("test.png", new Uint8Array([1, 2, 3]), "image/png"),
    (err) => err instanceof ArtifactStorageError && err.code === "AUTH_ERROR",
  );
});

test("ImageKit driver: handles 500 server errors truthfully", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    async text() {
      return "Service unavailable";
    },
  });

  const driver = new ImageKitArtifactDriver({
    privateKey: "key_abc",
    urlEndpoint: "https://ik.imagekit.io/test",
    fetchFn: mockFetch,
  });

  await assert.rejects(
    async () => driver.saveArtifact("test.png", new Uint8Array([1, 2, 3]), "image/png"),
    (err) => err instanceof ArtifactStorageError && err.code === "UPLOAD_FAILED",
  );
});

test("ImageKit driver: detects and rejects invalid responses missing fileId or url", async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { status: "success" }; // missing url and fileId
    },
  });

  const driver = new ImageKitArtifactDriver({
    privateKey: "key_abc",
    urlEndpoint: "https://ik.imagekit.io/test",
    fetchFn: mockFetch,
  });

  await assert.rejects(
    async () => driver.saveArtifact("test.png", new Uint8Array([1, 2, 3]), "image/png"),
    (err) => err instanceof ArtifactStorageError && err.code === "INVALID_RESPONSE",
  );
});

test("ImageKit driver: secret private key is never leaked in error messages", async () => {
  const secretKey = "super_secret_private_token_shhh";
  const mockFetch = async () => {
    throw new Error("Network connection dropped");
  };

  const driver = new ImageKitArtifactDriver({
    privateKey: secretKey,
    urlEndpoint: "https://ik.imagekit.io/test",
    fetchFn: mockFetch,
  });

  try {
    await driver.saveArtifact("test.png", new Uint8Array([1, 2, 3]), "image/png");
    assert.fail("Should have thrown");
  } catch (err) {
    assert.ok(err instanceof ArtifactStorageError);
    assert.ok(!err.message.includes(secretKey), "Error message must not contain private key");
  }
});

test("Provider Selection: createStorageDriver selects local by default and supports imagekit", () => {
  // Default is local
  const localDriver = createStorageDriver("local");
  assert.equal(localDriver.driverName, "local-filesystem");

  // Explicit imagekit
  const ikDriver = createStorageDriver("imagekit", {
    imagekit: {
      privateKey: "dummy_key",
      urlEndpoint: "https://ik.imagekit.io/test",
    },
  });
  assert.equal(ikDriver.driverName, "imagekit");

  // Unsupported provider fails clearly without silent fallback
  assert.throws(
    () => createStorageDriver("aws-s3"),
    (err) => err instanceof ArtifactStorageError && err.code === "UNSUPPORTED_PROVIDER",
  );
});

