import type { IncomingMessage } from "node:http";

export interface UploadRequestFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface ParsedUploadRequest {
  description: string;
  files: UploadRequestFile[];
}

const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");
const LINE_BREAK = Buffer.from("\r\n");

function findBuffer(haystack: Buffer, needle: Buffer, start = 0): number {
  for (let index = start; index <= haystack.length - needle.length; index += 1) {
    let match = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        match = false;
        break;
      }
    }
    if (match) return index;
  }
  return -1;
}

function splitBuffer(haystack: Buffer, needle: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let offset = 0;

  while (offset <= haystack.length) {
    const next = findBuffer(haystack, needle, offset);
    if (next === -1) {
      parts.push(haystack.subarray(offset));
      return parts;
    }

    parts.push(haystack.subarray(offset, next));
    offset = next + needle.length;
  }

  return parts;
}

function parseHeaders(rawHeaders: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of rawHeaders.split("\r\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
    headers[key] = value;
  }

  return headers;
}

function parseContentDisposition(value: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const segments = value.split(";");

  for (const segment of segments) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = segment.slice(0, separatorIndex).trim().toLowerCase();
    let rawValue = segment.slice(separatorIndex + 1).trim();
    if (rawValue.startsWith("\"") && rawValue.endsWith("\"")) {
      rawValue = rawValue.slice(1, -1);
    }
    parsed[key] = rawValue;
  }

  return parsed;
}

function coerceTextPart(value: Buffer): string {
  return value.toString("utf8").replace(/\0/g, "").trim();
}

function extractBoundary(contentType: string): string | null {
  for (const part of contentType.split(";")) {
    const [key, rawValue] = part.split("=", 2);
    if (key?.trim().toLowerCase() !== "boundary") continue;
    const value = rawValue?.trim();
    if (!value) return null;
    return value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value;
  }
  return null;
}

export async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;

    if (totalBytes > maxBytes) {
      throw new Error(`payload exceeds ${maxBytes} byte limit`);
    }

    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks);
}

export function parseMultipartRequest(body: Buffer, contentType: string): ParsedUploadRequest {
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    throw new Error("missing multipart boundary");
  }

  const boundaryMarker = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, boundaryMarker);
  const files: UploadRequestFile[] = [];
  let description = "";

  for (const rawPart of parts) {
    if (rawPart.length === 0) continue;

    let part = rawPart;
    if (part.subarray(0, 2).equals(LINE_BREAK)) {
      part = part.subarray(2);
    }

    if (part.subarray(0, 2).toString("utf8") === "--") {
      continue;
    }

    if (part.length >= 2 && part.subarray(part.length - 2).equals(LINE_BREAK)) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEndIndex = findBuffer(part, HEADER_SEPARATOR);
    if (headerEndIndex === -1) continue;

    const rawHeaders = part.subarray(0, headerEndIndex).toString("utf8");
    const data = part.subarray(headerEndIndex + HEADER_SEPARATOR.length);
    const headers = parseHeaders(rawHeaders);
    const disposition = parseContentDisposition(headers["content-disposition"] ?? "");
    const fieldName = disposition.name?.toLowerCase() ?? "";
    const filename = disposition.filename?.trim() ?? "";

    if (filename) {
      files.push({
        filename,
        contentType: (headers["content-type"] ?? "application/octet-stream").toLowerCase(),
        data,
      });
      continue;
    }

    if (fieldName === "description" || fieldName === "text" || fieldName === "caption") {
      description = coerceTextPart(data);
    }
  }

  return { description, files };
}

function decodeBase64Field(value: string): Buffer {
  const trimmed = value.trim();
  const payload = trimmed.startsWith("data:") && trimmed.includes(",") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  const normalized = payload.replace(/\s+/g, "");

  if (!/^[A-Za-z0-9+/=]*$/.test(normalized)) {
    throw new Error("invalid base64 payload");
  }

  return Buffer.from(normalized, "base64");
}

function normalizeJsonFile(value: unknown): UploadRequestFile | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const filename =
    typeof record.filename === "string" && record.filename.trim()
      ? record.filename.trim()
      : typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : "upload";
  const contentType =
    typeof record.contentType === "string" && record.contentType.trim()
      ? record.contentType.trim().toLowerCase()
      : "application/octet-stream";
  const base64Value =
    typeof record.dataBase64 === "string"
      ? record.dataBase64
      : typeof record.data === "string"
        ? record.data
        : typeof record.base64 === "string"
          ? record.base64
          : null;

  if (!base64Value) return null;

  return {
    filename,
    contentType,
    data: decodeBase64Field(base64Value),
  };
}

export function parseJsonRequest(body: Buffer): ParsedUploadRequest {
  const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  const description =
    typeof parsed.description === "string"
      ? parsed.description.trim()
      : typeof parsed.text === "string"
        ? parsed.text.trim()
        : typeof parsed.caption === "string"
          ? parsed.caption.trim()
          : "";

  const files: UploadRequestFile[] = [];

  if (Array.isArray(parsed.files)) {
    for (const item of parsed.files) {
      const file = normalizeJsonFile(item);
      if (file) files.push(file);
    }
  }

  if (files.length === 0) {
    const singleFile = normalizeJsonFile(parsed.file);
    if (singleFile) files.push(singleFile);
  }

  return { description, files };
}
