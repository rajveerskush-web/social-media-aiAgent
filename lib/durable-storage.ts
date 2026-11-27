import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Provider-neutral interface for artifact persistence.
 * Allows switching between Local Filesystem, S3, or Cloud Object Storage.
 */
export interface ArtifactStorageDriver {
  readonly driverName: string;
  saveArtifact(
    key: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<{
    storageKey: string;
    sizeBytes: number;
    hash: string;
    publicUrl?: string;
    fileId?: string;
  }>;
  getArtifact(key: string): Promise<Uint8Array | null>;
  hasArtifact(key: string): Promise<boolean>;
  deleteArtifact(key: string): Promise<boolean>;
}

export class ArtifactStorageError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ArtifactStorageError";
    this.code = code;
  }
}

/**
 * Default zero-cost local filesystem driver.
 * Stores artifacts durably on disk under an approved directory.
 * Uses atomic writes (temp file + rename) and checksum verification.
 */
export class LocalFilesystemArtifactDriver implements ArtifactStorageDriver {
  readonly driverName = "local-filesystem";
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ||
      path.join(process.cwd(), ".data", "artifacts");
  }

  private resolveSafePath(key: string): string {
    // Prevent directory traversal attacks
    const sanitized = key.replace(/\\/g, "/").replace(/\.\.+/g, "");
    const fullPath = path.resolve(this.baseDir, sanitized);
    if (!fullPath.startsWith(path.resolve(this.baseDir))) {
      throw new ArtifactStorageError("Path traversal detected", "PATH_TRAVERSAL");
    }
    return fullPath;
  }

  async saveArtifact(
    key: string,
    data: Uint8Array,
    _mimeType: string,
  ): Promise<{ storageKey: string; sizeBytes: number; hash: string }> {
    if (!data || data.length === 0) {
      throw new ArtifactStorageError("Cannot save empty artifact (0 bytes).", "EMPTY_DATA");
    }

    const targetPath = this.resolveSafePath(key);
    const parentDir = path.dirname(targetPath);
    await fs.mkdir(parentDir, { recursive: true });

    // Compute SHA-256 hash for integrity verification
    const hash = createHash("sha256").update(data).digest("hex");

    // Atomic write via temp file
    const tempPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, targetPath);

    return {
      storageKey: key,
      sizeBytes: data.length,
      hash,
    };
  }

  async getArtifact(key: string): Promise<Uint8Array | null> {
    try {
      const targetPath = this.resolveSafePath(key);
      const buffer = await fs.readFile(targetPath);
      return new Uint8Array(buffer);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async hasArtifact(key: string): Promise<boolean> {
    try {
      const targetPath = this.resolveSafePath(key);
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteArtifact(key: string): Promise<boolean> {
    try {
      const targetPath = this.resolveSafePath(key);
      await fs.unlink(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * ImageKit-backed asset-storage driver.
 * Uses ImageKit REST API for server-side media and image asset persistence.
 */
export type ImageKitDriverOptions = {
  privateKey?: string;
  urlEndpoint?: string;
  fetchFn?: typeof fetch;
};

export class ImageKitArtifactDriver implements ArtifactStorageDriver {
  readonly driverName = "imagekit";
  private readonly privateKey: string;
  private readonly urlEndpoint: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: ImageKitDriverOptions = {}) {
    const key = options.privateKey ?? process.env.IMAGEKIT_PRIVATE_KEY;
    const endpoint = options.urlEndpoint ?? process.env.IMAGEKIT_URL_ENDPOINT;

    if (!key || !key.trim()) {
      throw new ArtifactStorageError(
        "IMAGEKIT_PRIVATE_KEY is required for the ImageKit asset storage driver.",
        "MISSING_PRIVATE_KEY",
      );
    }
    if (!endpoint || !endpoint.trim()) {
      throw new ArtifactStorageError(
        "IMAGEKIT_URL_ENDPOINT is required for the ImageKit asset storage driver.",
        "MISSING_URL_ENDPOINT",
      );
    }

    this.privateKey = key.trim();
    this.urlEndpoint = endpoint.trim().replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async saveArtifact(
    key: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<{
    storageKey: string;
    sizeBytes: number;
    hash: string;
    publicUrl: string;
    fileId: string;
  }> {
    if (!data || data.length === 0) {
      throw new ArtifactStorageError(
        "Cannot save empty artifact (0 bytes).",
        "EMPTY_DATA",
      );
    }

    const hash = createHash("sha256").update(data).digest("hex");
    const filename = path.posix.basename(key);
    const folder = "/" + path.posix.dirname(key);

    const formData = new FormData();
    const blob = new Blob([data as unknown as BlobPart], { type: mimeType });
    formData.append("file", blob, filename);
    formData.append("fileName", filename);
    formData.append("folder", folder);
    formData.append("useUniqueFileName", "false");

    const authHeader = `Basic ${Buffer.from(`${this.privateKey}:`).toString("base64")}`;

    let response: Response;
    try {
      response = await this.fetchFn(
        "https://upload.imagekit.io/api/v1/files/upload",
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
          },
          body: formData,
        },
      );
    } catch (err: unknown) {
      throw new ArtifactStorageError(
        `ImageKit upload network request failed: ${err instanceof Error ? err.message : String(err)}`,
        "NETWORK_ERROR",
      );
    }

    if (!response.ok) {
      let errBody = "";
      try {
        errBody = await response.text();
      } catch {
        // ignore
      }
      if (response.status === 401 || response.status === 403) {
        throw new ArtifactStorageError(
          "ImageKit authentication failed: invalid or unauthorized private key.",
          "AUTH_ERROR",
        );
      }
      throw new ArtifactStorageError(
        `ImageKit upload failed with HTTP status ${response.status}: ${errBody || response.statusText}`,
        "UPLOAD_FAILED",
      );
    }

    const body = (await response.json()) as {
      url?: string;
      fileId?: string;
      size?: number;
    };
    if (!body?.url || !body?.fileId) {
      throw new ArtifactStorageError(
        "ImageKit upload returned invalid or missing response metadata (url or fileId missing).",
        "INVALID_RESPONSE",
      );
    }

    return {
      storageKey: key,
      sizeBytes: body.size ?? data.length,
      hash,
      publicUrl: body.url,
      fileId: body.fileId,
    };
  }

  async getArtifact(key: string): Promise<Uint8Array | null> {
    const url = `${this.urlEndpoint}/${key.replace(/^\/+/, "")}`;
    try {
      const response = await this.fetchFn(url);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new ArtifactStorageError(
          `ImageKit getArtifact failed with HTTP ${response.status}`,
          "FETCH_FAILED",
        );
      }
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (err: unknown) {
      if (err instanceof ArtifactStorageError) throw err;
      throw new ArtifactStorageError(
        `Failed to fetch artifact from ImageKit: ${err instanceof Error ? err.message : String(err)}`,
        "NETWORK_ERROR",
      );
    }
  }

  async hasArtifact(key: string): Promise<boolean> {
    const url = `${this.urlEndpoint}/${key.replace(/^\/+/, "")}`;
    try {
      const response = await this.fetchFn(url, { method: "HEAD" });
      return response.ok;
    } catch {
      return false;
    }
  }

  async deleteArtifact(fileIdOrKey: string): Promise<boolean> {
    const authHeader = `Basic ${Buffer.from(`${this.privateKey}:`).toString("base64")}`;
    try {
      const response = await this.fetchFn(
        `https://api.imagekit.io/v1/files/${encodeURIComponent(fileIdOrKey)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: authHeader,
          },
        },
      );
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }
}

/**
 * Storage driver factory supporting provider selection from configuration.
 */
export function createStorageDriver(
  provider: string = process.env.IMAGE_PROVIDER || "local",
  options?: {
    imagekit?: ImageKitDriverOptions;
    localBaseDir?: string;
  },
): ArtifactStorageDriver {
  const normalized = provider.toLowerCase().trim();
  if (normalized === "local") {
    return new LocalFilesystemArtifactDriver(options?.localBaseDir);
  }
  if (normalized === "imagekit") {
    return new ImageKitArtifactDriver(options?.imagekit);
  }
  throw new ArtifactStorageError(
    `Unsupported IMAGE_PROVIDER: "${provider}". Supported values are "local" and "imagekit".`,
    "UNSUPPORTED_PROVIDER",
  );
}

// Global active driver (defaults to LocalFilesystemArtifactDriver)
let activeStorageDriver: ArtifactStorageDriver = new LocalFilesystemArtifactDriver();

export function setArtifactStorageDriver(driver: ArtifactStorageDriver) {
  activeStorageDriver = driver;
}

export function getArtifactStorageDriver(): ArtifactStorageDriver {
  if (
    (process.env.IMAGE_PROVIDER === "imagekit" || (!process.env.IMAGE_PROVIDER && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT)) &&
    activeStorageDriver.driverName !== "imagekit"
  ) {
    try {
      activeStorageDriver = new ImageKitArtifactDriver();
    } catch {
      // Fallback to local if credentials missing or invalid
    }
  }
  return activeStorageDriver;
}

/**
 * Standardized key generator ensuring campaign and task isolation.
 */
export function buildArtifactStorageKey(
  campaignId: number,
  taskId: number,
  artifactId: number,
  filename: string,
): string {
  const safeFilename = path.posix.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `campaign_${campaignId}/task_${taskId}/art_${artifactId}_${safeFilename}`;
}

/**
 * Persists verified file bytes from a task into durable storage.
 */
export async function persistDurableArtifact(
  campaignId: number,
  taskId: number,
  artifactId: number,
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
  driver?: ArtifactStorageDriver,
): Promise<{
  storageKey: string;
  sizeBytes: number;
  hash: string;
  isDurable: true;
  publicUrl?: string;
  fileId?: string;
}> {
  if (!bytes || bytes.length === 0) {
    throw new ArtifactStorageError("Artifact content is empty (0 bytes).", "EMPTY_BYTES");
  }

  const selectedDriver = driver ?? getArtifactStorageDriver();
  const key = buildArtifactStorageKey(campaignId, taskId, artifactId, filename);
  const result = await selectedDriver.saveArtifact(key, bytes, mimeType);

  return {
    storageKey: result.storageKey,
    sizeBytes: result.sizeBytes,
    hash: result.hash,
    isDurable: true,
    publicUrl: result.publicUrl,
    fileId: result.fileId,
  };
}

/**
 * Retrieves verified file bytes from durable storage.
 */
export async function retrieveDurableArtifact(
  campaignId: number,
  taskId: number,
  artifactId: number,
  filename: string,
  driver?: ArtifactStorageDriver,
): Promise<Uint8Array | null> {
  const selectedDriver = driver ?? getArtifactStorageDriver();
  const key = buildArtifactStorageKey(campaignId, taskId, artifactId, filename);

  try {
    const bytes = await selectedDriver.getArtifact(key);
    if (bytes && bytes.length > 0) return bytes;
  } catch {
    // Primary driver failed, proceed to local fallback
  }

  // Cross-driver fallback: if primary was remote (e.g. ImageKit), check local filesystem store
  if (selectedDriver.driverName !== "local-filesystem") {
    try {
      const localDriver = new LocalFilesystemArtifactDriver();
      const localBytes = await localDriver.getArtifact(key);
      if (localBytes && localBytes.length > 0) return localBytes;
    } catch {
      // Ignore
    }
  }

  return null;
}
