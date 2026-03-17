import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import type { EinkoPluginConfig } from "./config.js";
import { parseJsonRequest, parseMultipartRequest, readRequestBody, type ParsedUploadRequest } from "./multipart.js";
import { storeUpload } from "./storage.js";

interface LoggerLike {
  warn: (message: string) => void;
  info?: (message: string) => void;
}

interface CreateScreenshotUploadHandlerParams {
  config: EinkoPluginConfig;
  workspaceRoot: string;
  logger: LoggerLike;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(body)}\n`);
}

function timingSafeMatch(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function extractAuthToken(req: IncomingMessage): string {
  const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  const headerToken = typeof req.headers["x-openclaw-token"] === "string" ? req.headers["x-openclaw-token"].trim() : "";
  return headerToken;
}

function resolveClientIp(req: IncomingMessage): string | null {
  const forwardedFor = typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : "";
  const realIp = typeof req.headers["x-real-ip"] === "string" ? req.headers["x-real-ip"] : "";

  if (forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  if (realIp.trim()) return realIp.trim();
  return req.socket.remoteAddress ?? null;
}

function ensureAllowedMimeTypes(payload: ParsedUploadRequest, allowedMimeTypes: string[]): string | null {
  for (const file of payload.files) {
    if (!allowedMimeTypes.includes(file.contentType)) {
      return file.contentType;
    }
  }
  return null;
}

export function createScreenshotUploadHandler({ config, workspaceRoot, logger }: CreateScreenshotUploadHandlerParams) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed", allow: ["POST"] });
      return true;
    }

    if (!config.authToken) {
      sendJson(res, 503, { ok: false, error: "auth_token_not_configured" });
      return true;
    }

    const token = extractAuthToken(req);
    if (!token || !timingSafeMatch(config.authToken, token)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return true;
    }

    const rawContentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "";
    const normalizedContentType = rawContentType.toLowerCase();

    let payload: ParsedUploadRequest;
    try {
      const body = await readRequestBody(req, config.maxPayloadBytes);

      if (normalizedContentType.startsWith("multipart/form-data")) {
        payload = parseMultipartRequest(body, rawContentType);
      } else if (normalizedContentType.startsWith("application/json")) {
        payload = parseJsonRequest(body);
      } else {
        sendJson(res, 415, {
          ok: false,
          error: "unsupported_media_type",
          accepted: ["multipart/form-data", "application/json"],
        });
        return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid request body";
      const status = message.includes("byte limit") ? 413 : 400;
      sendJson(res, status, { ok: false, error: "invalid_request", message });
      return true;
    }

    if (payload.files.length === 0) {
      sendJson(res, 400, { ok: false, error: "missing_files" });
      return true;
    }

    const rejectedMimeType = ensureAllowedMimeTypes(payload, config.allowedMimeTypes);
    if (rejectedMimeType) {
      sendJson(res, 415, {
        ok: false,
        error: "unsupported_file_type",
        message: `Rejected file type: ${rejectedMimeType}`,
        allowedMimeTypes: config.allowedMimeTypes,
      });
      return true;
    }

    try {
      const stored = await storeUpload({
        config,
        workspaceRoot,
        description: payload.description,
        files: payload.files,
        clientIp: resolveClientIp(req),
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
      });

      logger.info?.(
        `stored screenshot upload ${stored.uploadId} (${stored.files.length} file${stored.files.length === 1 ? "" : "s"})`,
      );

      sendJson(res, 201, {
        ok: true,
        uploadId: stored.uploadId,
        storedAt: stored.storedAt,
        description: stored.description,
        workspaceRelativeDir: stored.workspaceRelativeDir,
        files: stored.files,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to store upload";
      logger.warn(`failed to store screenshot upload: ${message}`);
      sendJson(res, 500, { ok: false, error: "storage_failed", message });
      return true;
    }
  };
}
