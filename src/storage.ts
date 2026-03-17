import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EinkoPluginConfig } from "./config.js";
import type { UploadRequestFile } from "./multipart.js";

export interface StoreUploadInput {
  config: EinkoPluginConfig;
  workspaceRoot: string;
  description: string;
  files: UploadRequestFile[];
  clientIp: string | null;
  userAgent: string | null;
}

export interface StoredUploadSummary {
  uploadId: string;
  workspaceRelativeDir: string;
  description: string;
  storedAt: string;
  files: Array<{
    filename: string;
    originalFilename: string;
    contentType: string;
    bytes: number;
    workspaceRelativePath: string;
  }>;
}

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function sanitizeStem(input: string): string {
  const normalized = input.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
  const stem = normalized
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return stem || "screenshot";
}

function sanitizeExtension(input: string): string {
  const ext = path.extname(input).toLowerCase();
  if (!ext) return "";
  return /^[.][a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

function resolveExtension(file: UploadRequestFile): string {
  return sanitizeExtension(file.filename) || MIME_TYPE_TO_EXTENSION[file.contentType] || ".bin";
}

function resolveUploadId(): string {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${now}-${crypto.randomBytes(4).toString("hex")}`;
}

function resolveClientIp(headers: { clientIp: string | null }): string | null {
  if (!headers.clientIp) return null;
  return headers.clientIp.trim() || null;
}

export async function storeUpload(input: StoreUploadInput): Promise<StoredUploadSummary> {
  const uploadId = resolveUploadId();
  const storedAt = new Date().toISOString();
  const uploadRelativeDir = path.posix.join(input.config.destinationDir, uploadId);
  const uploadAbsoluteDir = path.join(input.workspaceRoot, input.config.destinationDir, uploadId);

  await fs.mkdir(uploadAbsoluteDir, { recursive: true });

  const storedFiles: StoredUploadSummary["files"] = [];

  for (const [index, file] of input.files.entries()) {
    const extension = resolveExtension(file);
    const stem = sanitizeStem(file.filename);
    const filename = `${String(index + 1).padStart(2, "0")}-${stem}${extension}`;
    const absolutePath = path.join(uploadAbsoluteDir, filename);
    const relativePath = path.posix.join(uploadRelativeDir, filename);

    await fs.writeFile(absolutePath, file.data);
    storedFiles.push({
      filename,
      originalFilename: file.filename,
      contentType: file.contentType,
      bytes: file.data.length,
      workspaceRelativePath: relativePath,
    });
  }

  await fs.writeFile(
    path.join(uploadAbsoluteDir, "upload.json"),
    `${JSON.stringify(
      {
        uploadId,
        storedAt,
        description: input.description,
        destinationDir: input.config.destinationDir,
        client: {
          ip: resolveClientIp({ clientIp: input.clientIp }),
          userAgent: input.userAgent,
        },
        files: storedFiles,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    uploadId,
    workspaceRelativeDir: uploadRelativeDir,
    description: input.description,
    storedAt,
    files: storedFiles,
  };
}
