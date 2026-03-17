import os from "node:os";
import path from "node:path";

export const OPENCLAW_IOS_SCREENSHOT_PLUGIN_ID = "openclaw-ios-screenshot-plugin";
export const DEFAULT_ROUTE_PATH = "/plugins/openclaw-ios-screenshot-plugin/upload";
export const DEFAULT_DESTINATION_DIR = "screenshots/inbox";
export const DEFAULT_MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const openClawIosScreenshotPluginConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["authToken"],
  properties: {
    authToken: {
      type: "string",
      minLength: 16,
    },
    routePath: {
      type: "string",
      default: DEFAULT_ROUTE_PATH,
    },
    destinationDir: {
      type: "string",
      default: DEFAULT_DESTINATION_DIR,
    },
    maxPayloadBytes: {
      type: "number",
      minimum: 1_048_576,
      maximum: 104_857_600,
      default: DEFAULT_MAX_PAYLOAD_BYTES,
    },
    allowedMimeTypes: {
      type: "array",
      items: {
        type: "string",
      },
      default: [...DEFAULT_ALLOWED_MIME_TYPES],
    },
  },
};

export interface OpenClawIosScreenshotPluginConfig {
  authToken: string;
  routePath: string;
  destinationDir: string;
  maxPayloadBytes: number;
  allowedMimeTypes: string[];
}

type OpenClawRuntimeConfig = {
  agents?: {
    defaults?: {
      workspace?: unknown;
    };
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeRoutePath(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return DEFAULT_ROUTE_PATH;

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/{2,}/g, "/");
}

function normalizeDestinationDir(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return DEFAULT_DESTINATION_DIR;

  const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === "..") return DEFAULT_DESTINATION_DIR;
  if (normalized.startsWith("../") || normalized.startsWith("/")) return DEFAULT_DESTINATION_DIR;
  return normalized;
}

function normalizeMaxPayloadBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_PAYLOAD_BYTES;
  return Math.max(1_048_576, Math.min(104_857_600, Math.round(value)));
}

function normalizeAllowedMimeTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ALLOWED_MIME_TYPES];

  const next = Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  return next.length > 0 ? next : [...DEFAULT_ALLOWED_MIME_TYPES];
}

export function resolveOpenClawIosScreenshotPluginConfig(value: unknown): OpenClawIosScreenshotPluginConfig {
  const record = asRecord(value);

  return {
    authToken: typeof record.authToken === "string" ? record.authToken.trim() : "",
    routePath: normalizeRoutePath(record.routePath),
    destinationDir: normalizeDestinationDir(record.destinationDir),
    maxPayloadBytes: normalizeMaxPayloadBytes(record.maxPayloadBytes),
    allowedMimeTypes: normalizeAllowedMimeTypes(record.allowedMimeTypes),
  };
}

export function resolveWorkspaceRoot(config: OpenClawRuntimeConfig | undefined): string {
  const configuredWorkspace = config?.agents?.defaults?.workspace;
  if (typeof configuredWorkspace === "string" && configuredWorkspace.trim()) {
    const trimmed = configuredWorkspace.trim();
    if (trimmed.startsWith("~/")) {
      return path.resolve(path.join(os.homedir(), trimmed.slice(2)));
    }
    return path.resolve(trimmed);
  }

  return path.join(os.homedir(), ".openclaw", "workspace");
}
